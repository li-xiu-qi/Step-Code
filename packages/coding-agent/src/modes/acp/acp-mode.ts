/**
 * ACP mode: native stdio JSON-RPC for Agent Client Protocol v1 and v2.
 *
 * This mode exposes the ACP client surface over newline-delimited JSON-RPC 2.0
 * on stdin/stdout. It reuses the same `AgentSessionRuntimeHost` as the
 * interactive TUI and RPC mode, so session persistence, extensions, compaction,
 * and tool execution behave identically. Only the wire format is different.
 *
 * v1 keeps the historical turn-pending prompt lifecycle. v2 negotiates the
 * stable baseline: `session/new`, `session/list`, `session/resume`,
 * `session/close`, `session/prompt`, `session/cancel`, and `session/update`,
 * with insertion-acknowledged prompts and foreground `state_update` reporting.
 *
 * Agent-to-client traffic uses `session/update` notifications and
 * `session/request_permission` requests for tool approval.
 *
 * Not part of this baseline: ACP `terminal/*`, session config options, session
 * modes, and client-provided MCP servers. Those need separate product decisions
 * and are documented as follow-up work.
 */

import * as crypto from "node:crypto";
import type { AgentMessage } from "@step-harness/agent-core";
import { VERSION } from "../../config.ts";
import type { AgentSessionEvent } from "../../core/agent-session.ts";
import type { AgentSessionRuntimeHost } from "../../core/agent-session-runtime.ts";
import type {
	ExtensionUIContext,
	ExtensionUIDialogOptions,
	ExtensionWidgetOptions,
	WorkingIndicatorOptions,
} from "../../core/extensions/index.ts";
import {
	flushRawStdout,
	takeOverStdout,
	waitForRawStdoutBackpressure,
	writeRawStdout,
} from "../../core/output-guard.ts";
import { loadEntriesFromFile, type SessionEntry, SessionManager } from "../../core/session-manager.ts";
import { type Theme, theme } from "../../theme/theme.ts";
import { resolvePath } from "../../utils/paths.ts";
import { killTrackedDetachedChildren } from "../../utils/shell.ts";
import { attachJsonlLineReader } from "../rpc/jsonl.ts";
import type {
	AcpProtocolVersion,
	ContentBlock,
	InitializeResultV2,
	JsonRpcId,
	JsonRpcRequest,
	JsonRpcResponseObject,
	PromptParams,
	PromptResultV2,
	RequestPermissionResult,
	ResumeParams,
	SessionListParams,
	SessionListResult,
	SessionNotificationParams,
	SessionNotificationParamsV2,
	SessionUpdateStateV2,
	SessionUpdateV2,
} from "./acp-types.ts";
import { ACP_JSON_RPC_ERRORS, ACP_PROTOCOL_VERSION } from "./acp-types.ts";
import {
	createErrorResponse,
	createNotification,
	createResponse,
	hasUnsupportedMcpServers,
	negotiateProtocolVersion,
	normalizePrompt,
	parseInitializeParams,
	parseJsonRpcLine,
	parseRequestPermissionResult,
	serializeJsonLine,
	toSessionNotification,
	toSessionNotificationV2,
	validateCloseSessionParams,
	validateLoadSessionParams,
	validateNewSessionParams,
	validatePromptParams,
	validateResumeParams,
	validateSessionListParams,
} from "./acp-wire.ts";

const PERMISSION_ALLOW_OPTION_ID = "allow_once";
const PERMISSION_REJECT_OPTION_ID = "reject_once";

export async function runAcpMode(runtimeHost: AgentSessionRuntimeHost): Promise<never> {
	takeOverStdout();
	let session = runtimeHost.session;
	let unsubscribe: (() => void) | undefined;
	let unsubscribeBackpressure: (() => void) | undefined;

	let initialized = false;
	let protocolVersion: AcpProtocolVersion = 1;
	let shuttingDown = false;
	let detachInput = () => {};
	const signalCleanupHandlers: Array<() => void> = [];

	const activePromptIds = new Set<JsonRpcId>();
	const cancelledPromptIds = new Set<JsonRpcId>();
	const pendingPermissionRequests = new Map<string, { resolve: (result: RequestPermissionResult) => void }>();
	const messageIds = new WeakMap<AgentMessage, string>();
	const foregroundPromptIds = new Set<JsonRpcId>();

	const output = (obj: unknown) => {
		writeRawStdout(serializeJsonLine(obj));
	};

	const sendNotification = (method: string, params: unknown) => {
		output(createNotification(method, params));
	};

	const sendResponse = (id: JsonRpcId | null, result: unknown) => {
		output(createResponse(id, result));
	};

	const sendError = (id: JsonRpcId | null, code: number, message: string, data?: unknown) => {
		output(createErrorResponse(id, code, message, data));
	};

	const sendSessionUpdateV2 = (update: SessionUpdateV2) => {
		const params: SessionNotificationParamsV2 = { sessionId: session.sessionId, update };
		sendNotification("session/update", params);
	};

	const sendStateUpdateV2 = (
		state: SessionUpdateStateV2["state"],
		stopReason?: string,
		error?: SessionUpdateStateV2["error"],
	) => {
		sendSessionUpdateV2({
			sessionUpdate: "state_update",
			state,
			...(stopReason === undefined ? {} : { stopReason }),
			...(error === undefined ? {} : { error }),
		});
	};

	const sendNoticeV2 = (message: string, type?: "info" | "warning" | "error") => {
		sendSessionUpdateV2({
			sessionUpdate: "notice",
			severity: type ?? "info",
			title: message,
		});
	};

	const sendPermissionRequest = (title: string, message: string): Promise<RequestPermissionResult> => {
		const requestId = crypto.randomUUID();
		return new Promise<RequestPermissionResult>((resolve) => {
			pendingPermissionRequests.set(requestId, { resolve });
			output({
				jsonrpc: "2.0",
				id: requestId,
				method: "session/request_permission",
				params: {
					sessionId: session.sessionId,
					toolCall: {
						toolCallId: requestId,
						title,
						status: "pending",
						content: [{ type: "content", content: { type: "text", text: message } }],
					},
					options: [
						{ optionId: PERMISSION_ALLOW_OPTION_ID, name: "Allow once", kind: "allow_once" },
						{ optionId: PERMISSION_REJECT_OPTION_ID, name: "Reject once", kind: "reject_once" },
					],
				},
			});
		});
	};

	const resolvePermissionRequest = (requestId: string, result: RequestPermissionResult) => {
		const pending = pendingPermissionRequests.get(requestId);
		if (!pending) return;
		pendingPermissionRequests.delete(requestId);
		pending.resolve(result);
	};

	const cancelPermissionRequest = (requestId: string) => {
		const pending = pendingPermissionRequests.get(requestId);
		if (!pending) return;
		pendingPermissionRequests.delete(requestId);
		pending.resolve({ outcome: { outcome: "cancelled" } });
	};

	const isPermissionAllowed = (result: RequestPermissionResult): boolean => {
		return result.outcome.outcome === "selected" && result.outcome.optionId === PERMISSION_ALLOW_OPTION_ID;
	};

	/** Create an extension UI context backed by ACP permission requests. */
	const createExtensionUIContext = (): ExtensionUIContext => {
		const requestApproval = async (
			opts: ExtensionUIDialogOptions | undefined,
			title: string,
			message: string,
		): Promise<boolean> => {
			if (opts?.signal?.aborted) return false;
			if (protocolVersion === 2 && foregroundPromptIds.size > 0) {
				sendStateUpdateV2("requires_action");
			}
			const result = await sendPermissionRequest(title, message);
			if (protocolVersion === 2 && foregroundPromptIds.size > 0 && result.outcome.outcome !== "cancelled") {
				sendStateUpdateV2("running");
			}
			return isPermissionAllowed(result);
		};

		return {
			select: (title, options, opts) =>
				requestApproval(opts, title, options.join("\n")).then((approved) => (approved ? options[0] : undefined)),

			confirm: (title, message, opts) => requestApproval(opts, title, message),

			// ACP has no free-form text input in the baseline permission surface.
			// Resolve undefined instead of pretending a permission answer is text.
			input: (): Promise<string | undefined> => Promise.resolve(undefined),

			notify(message: string, type?: "info" | "warning" | "error"): void {
				if (protocolVersion === 2) {
					sendNoticeV2(message, type);
					return;
				}
				process.stderr.write(`[acp ${type ?? "info"}] ${message}\n`);
			},

			onTerminalInput(): () => void {
				return () => {};
			},

			setStatus(_key: string, _text: string | undefined): void {},

			setWorkingMessage(_message?: string): void {},

			setWorkingVisible(_visible: boolean): void {},

			setWorkingIndicator(_options?: WorkingIndicatorOptions): void {},

			setHiddenThinkingLabel(_label?: string): void {},

			setWidget(_key: string, _content: unknown, _options?: ExtensionWidgetOptions): void {},

			setFooter(_factory: unknown): void {},

			setHeader(_factory: unknown): void {},

			setTitle(title: string): void {
				process.stderr.write(`[acp title] ${title}\n`);
			},

			async custom() {
				return undefined as never;
			},

			pasteToEditor(text: string): void {
				this.setEditorText(text);
			},

			setEditorText(_text: string): void {},

			getEditorText(): string {
				return "";
			},

			async editor(): Promise<string | undefined> {
				return undefined;
			},

			addAutocompleteProvider(): void {},

			setEditorComponent(): void {},

			getEditorComponent() {
				return undefined;
			},

			get theme() {
				return theme;
			},

			getAllThemes() {
				return [];
			},

			getTheme(_name: string) {
				return undefined;
			},

			setTheme(_theme: string | Theme) {
				return { success: false, error: "Theme switching not supported in ACP mode" };
			},

			getToolsExpanded() {
				return false;
			},

			setToolsExpanded(_expanded: boolean): void {},
		};
	};

	runtimeHost.setRebindSession(async () => {
		await rebindSession();
	});

	const rebindSession = async (): Promise<void> => {
		const nextSession = runtimeHost.session;
		unsubscribe?.();
		unsubscribeBackpressure?.();
		session = nextSession;
		unsubscribe = session.subscribe((event: AgentSessionEvent) => {
			if (!initialized) return;
			if (protocolVersion === 2) {
				const notification = toSessionNotificationV2(session.sessionId, event, messageIds, () =>
					crypto.randomUUID(),
				);
				if (notification) {
					sendNotification("session/update", notification);
				}
				return;
			}
			const notification: SessionNotificationParams | null = toSessionNotification(session.sessionId, event);
			if (notification) {
				sendNotification("session/update", notification);
			}
		});
		unsubscribeBackpressure = session.agent.subscribe(async () => {
			await waitForRawStdoutBackpressure();
		});
		await session.bindExtensions({
			uiContext: createExtensionUIContext(),
			mode: "acp",
			commandContextActions: {
				waitForIdle: () => session.waitForIdle(),
				newSession: async (options) => runtimeHost.newSession(options),
				fork: async (entryId, forkOptions) => {
					const result = await runtimeHost.fork(entryId, forkOptions);
					return { cancelled: result.cancelled };
				},
				navigateTree: async (targetId, options) => {
					const result = await session.navigateTree(targetId, {
						summarize: options?.summarize,
						customInstructions: options?.customInstructions,
						replaceInstructions: options?.replaceInstructions,
						label: options?.label,
					});
					return { cancelled: result.cancelled };
				},
				switchSession: async (sessionPath, options) => {
					return runtimeHost.switchSession(sessionPath, options);
				},
				reload: async () => {
					await session.reload();
				},
			},
			shutdownHandler: () => {
				void shutdown();
			},
			onError: (err) => {
				process.stderr.write(`[acp extension error] ${err.error}\n`);
			},
		});
	};

	const registerSignalHandlers = (): void => {
		const signals: NodeJS.Signals[] = ["SIGTERM", "SIGINT"];
		if (process.platform !== "win32") {
			signals.push("SIGHUP");
		}

		for (const signal of signals) {
			const handler = () => {
				killTrackedDetachedChildren();
				void shutdown(signal === "SIGHUP" ? 129 : signal === "SIGINT" ? 130 : 143, signal);
			};
			process.on(signal, handler);
			signalCleanupHandlers.push(() => process.off(signal, handler));
		}
	};

	await rebindSession();
	registerSignalHandlers();

	const handlePrompt = async (id: JsonRpcId, params: PromptParams): Promise<void> => {
		if (params.sessionId !== session.sessionId) {
			sendError(id, ACP_JSON_RPC_ERRORS.invalidParams, `Unknown sessionId: ${params.sessionId}`);
			return;
		}
		const { text, images } = normalizePrompt(params.prompt);
		activePromptIds.add(id);
		try {
			await session.prompt(text, { images, source: "acp" });
			sendResponse(id, { stopReason: cancelledPromptIds.has(id) ? "cancelled" : "end_turn" });
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			if (cancelledPromptIds.has(id)) {
				sendResponse(id, { stopReason: "cancelled" });
			} else {
				sendError(id, ACP_JSON_RPC_ERRORS.internal, message);
			}
		} finally {
			activePromptIds.delete(id);
			cancelledPromptIds.delete(id);
		}
	};

	const handlePromptV2 = async (id: JsonRpcId, params: PromptParams): Promise<void> => {
		if (params.sessionId !== session.sessionId) {
			sendError(id, ACP_JSON_RPC_ERRORS.invalidParams, `Unknown sessionId: ${params.sessionId}`);
			return;
		}
		const { text, images } = normalizePrompt(params.prompt);
		const messageId = crypto.randomUUID();
		let responded = false;
		activePromptIds.add(id);
		try {
			await session.prompt(text, {
				images,
				source: "acp",
				preflightResult: (success: boolean) => {
					if (!success) {
						if (!responded) {
							responded = true;
							sendError(id, ACP_JSON_RPC_ERRORS.internal, "Prompt rejected before insertion");
						}
						return;
					}
					if (!responded) {
						responded = true;
						const result: PromptResultV2 = { messageId };
						sendResponse(id, result);
					}
					sendSessionUpdateV2({
						sessionUpdate: "user_message",
						messageId,
						content: params.prompt,
					});
					foregroundPromptIds.add(id);
					sendStateUpdateV2("running");
				},
			});
			if (!responded) {
				responded = true;
				sendResponse(id, { messageId });
			}
			foregroundPromptIds.delete(id);
			sendStateUpdateV2("idle", cancelledPromptIds.has(id) ? "cancelled" : "end_turn");
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			if (!responded) {
				responded = true;
				if (cancelledPromptIds.has(id)) {
					sendError(id, ACP_JSON_RPC_ERRORS.requestCancelled, "Request cancelled");
				} else {
					sendError(id, ACP_JSON_RPC_ERRORS.internal, message);
				}
			}
			foregroundPromptIds.delete(id);
			sendStateUpdateV2(
				"idle",
				cancelledPromptIds.has(id) ? "cancelled" : "error",
				cancelledPromptIds.has(id) ? undefined : { code: ACP_JSON_RPC_ERRORS.internal, message },
			);
		} finally {
			activePromptIds.delete(id);
			cancelledPromptIds.delete(id);
		}
	};

	const handleNewSession = async (id: JsonRpcId, cwd: string): Promise<void> => {
		if (resolvePath(cwd) !== resolvePath(runtimeHost.cwd)) {
			sendError(
				id,
				ACP_JSON_RPC_ERRORS.invalidParams,
				`cwd must match the agent working directory: ${runtimeHost.cwd}`,
			);
			return;
		}
		const result = await runtimeHost.newSession();
		if (result.cancelled) {
			sendError(id, ACP_JSON_RPC_ERRORS.unavailable, "Session creation was cancelled");
			return;
		}
		if (protocolVersion === 2) {
			sendResponse(id, { sessionId: session.sessionId });
			return;
		}
		sendResponse(id, { sessionId: session.sessionId, modes: null, configOptions: null });
	};

	const handleLoadSession = async (id: JsonRpcId, params: { sessionId: string; cwd: string }): Promise<void> => {
		let info = (await SessionManager.list(params.cwd)).find((candidate) => candidate.id === params.sessionId);
		if (!info) {
			info = (await SessionManager.listAll()).find((candidate) => candidate.id === params.sessionId);
		}
		if (!info) {
			sendError(id, ACP_JSON_RPC_ERRORS.invalidParams, `Session not found: ${params.sessionId}`);
			return;
		}
		if (info.cwd && resolvePath(info.cwd) !== resolvePath(params.cwd)) {
			sendError(id, ACP_JSON_RPC_ERRORS.invalidParams, `Session cwd does not match: ${info.cwd}`);
			return;
		}
		await runtimeHost.switchSession(info.path, { cwdOverride: params.cwd });
		sendResponse(id, { modes: null, configOptions: null });
	};

	const toContentBlocks = (content: unknown): ContentBlock[] => {
		if (typeof content === "string") {
			return content.length > 0 ? [{ type: "text", text: content }] : [];
		}
		if (!Array.isArray(content)) return [];
		const blocks: ContentBlock[] = [];
		for (const part of content) {
			if (!part || typeof part !== "object") continue;
			const block = part as {
				type?: unknown;
				text?: unknown;
				thinking?: unknown;
				data?: unknown;
				mimeType?: unknown;
			};
			if (block.type === "text" && typeof block.text === "string") {
				blocks.push({ type: "text", text: block.text });
				continue;
			}
			if (block.type === "thinking" && typeof block.thinking === "string") {
				blocks.push({ type: "text", text: block.thinking });
				continue;
			}
			if (block.type === "image" && typeof block.data === "string" && typeof block.mimeType === "string") {
				blocks.push({ type: "image", data: block.data, mimeType: block.mimeType });
			}
		}
		return blocks;
	};

	const buildReplayUpdates = (entries: SessionEntry[]): SessionUpdateV2[] => {
		const updates: SessionUpdateV2[] = [];
		for (const entry of entries) {
			if (entry.type !== "message") continue;
			const message = entry.message;
			const messageId = entry.id;
			if (message.role === "user") {
				const content = toContentBlocks(message.content);
				if (content.length > 0) {
					updates.push({ sessionUpdate: "user_message", messageId, content });
				}
				continue;
			}
			if (message.role !== "assistant") continue;
			const thought: ContentBlock[] = [];
			const text: ContentBlock[] = [];
			for (const part of message.content) {
				if (part.type === "thinking") {
					thought.push({ type: "text", text: part.thinking });
					continue;
				}
				if (part.type === "text") {
					text.push({ type: "text", text: part.text });
				}
			}
			if (thought.length > 0) {
				updates.push({ sessionUpdate: "agent_thought", messageId, content: thought });
			}
			if (text.length > 0) {
				updates.push({ sessionUpdate: "agent_message", messageId, content: text });
			}
		}
		return updates;
	};

	const handleSessionList = async (id: JsonRpcId, params: SessionListParams): Promise<void> => {
		if (params.cursor !== undefined) {
			sendError(id, ACP_JSON_RPC_ERRORS.invalidParams, "cursor pagination is not supported");
			return;
		}
		const sessions =
			params.cwd === undefined ? await SessionManager.listAll() : await SessionManager.list(params.cwd);
		const result: SessionListResult = {
			sessions: sessions.map((session) => ({
				sessionId: session.id,
				cwd: session.cwd,
				...(session.name === undefined ? {} : { title: session.name }),
				...(session.name === undefined && session.firstMessage ? { title: session.firstMessage } : {}),
				updatedAt: session.modified.toISOString(),
				_meta: { messageCount: session.messageCount },
			})),
		};
		sendResponse(id, result);
	};

	const handleResume = async (id: JsonRpcId, params: ResumeParams): Promise<void> => {
		if (hasUnsupportedMcpServers(params)) {
			sendError(id, ACP_JSON_RPC_ERRORS.invalidParams, "MCP servers are not supported in ACP mode");
			return;
		}
		if (params.additionalDirectories && params.additionalDirectories.length > 0) {
			sendError(id, ACP_JSON_RPC_ERRORS.invalidParams, "additionalDirectories are not supported in ACP mode");
			return;
		}
		if (params.replayFrom !== undefined && params.replayFrom !== null && params.replayFrom.type !== "start") {
			sendError(id, ACP_JSON_RPC_ERRORS.invalidParams, `Unsupported replayFrom type: ${params.replayFrom.type}`);
			return;
		}
		let info = (await SessionManager.list(params.cwd)).find((candidate) => candidate.id === params.sessionId);
		if (!info) {
			info = (await SessionManager.listAll()).find((candidate) => candidate.id === params.sessionId);
		}
		if (!info) {
			sendError(id, ACP_JSON_RPC_ERRORS.invalidParams, `Session not found: ${params.sessionId}`);
			return;
		}
		if (info.cwd && resolvePath(info.cwd) !== resolvePath(params.cwd)) {
			sendError(id, ACP_JSON_RPC_ERRORS.invalidParams, `Session cwd does not match: ${info.cwd}`);
			return;
		}
		await runtimeHost.switchSession(info.path, { cwdOverride: params.cwd });
		if (params.replayFrom?.type === "start") {
			const entries = loadEntriesFromFile(info.path).filter(
				(entry): entry is SessionEntry => entry.type !== "session",
			);
			for (const update of buildReplayUpdates(entries)) {
				sendSessionUpdateV2(update);
			}
		}
		sendStateUpdateV2("idle");
		sendResponse(id, {});
	};

	const handleCloseSession = async (id: JsonRpcId, sessionId: string): Promise<void> => {
		if (sessionId !== session.sessionId) {
			sendError(id, ACP_JSON_RPC_ERRORS.invalidParams, `Unknown sessionId: ${sessionId}`);
			return;
		}
		const wasForegroundActive = foregroundPromptIds.size > 0;
		for (const promptId of activePromptIds) {
			cancelledPromptIds.add(promptId);
		}
		for (const requestId of [...pendingPermissionRequests.keys()]) {
			cancelPermissionRequest(requestId);
		}
		await session.abort();
		if (wasForegroundActive) {
			sendStateUpdateV2("idle", "cancelled");
		}
		sendResponse(id, {});
	};

	const handleRequest = async (request: JsonRpcRequest): Promise<void> => {
		const id = request.id;
		const isRequest = id !== undefined;
		const params = request.params;

		if (request.method !== "initialize" && !initialized) {
			if (isRequest) {
				sendError(id, ACP_JSON_RPC_ERRORS.notInitialized, "Client must call initialize first");
			}
			return;
		}

		switch (request.method) {
			case "initialize": {
				const validation = parseInitializeParams(params);
				if (!validation.ok) {
					if (isRequest) {
						sendError(id, ACP_JSON_RPC_ERRORS.invalidParams, validation.message);
					}
					return;
				}
				initialized = true;
				protocolVersion = negotiateProtocolVersion(validation.requestedVersion);
				if (!isRequest) return;
				if (protocolVersion === 2) {
					const result: InitializeResultV2 = {
						protocolVersion: 2,
						info: { name: "Step Code", version: VERSION },
						capabilities: {
							session: {
								prompt: { image: {} },
							},
						},
						authMethods: [],
					};
					sendResponse(id, result);
					return;
				}
				sendResponse(id, {
					agentCapabilities: {
						loadSession: true,
						promptCapabilities: {
							image: true,
							audio: false,
							embeddedContext: false,
						},
						mcpCapabilities: {
							http: false,
							sse: false,
						},
						sessionCapabilities: {},
					},
					agentInfo: {
						name: "Step Code",
						version: VERSION,
					},
					authMethods: [],
					protocolVersion: ACP_PROTOCOL_VERSION,
				});
				return;
			}

			case "session/new": {
				if (!isRequest) return;
				if (protocolVersion === 2 && hasUnsupportedMcpServers(params)) {
					sendError(id, ACP_JSON_RPC_ERRORS.invalidParams, "MCP servers are not supported in ACP mode");
					return;
				}
				const validation = validateNewSessionParams(params);
				if (!validation.ok) {
					sendError(id, ACP_JSON_RPC_ERRORS.invalidParams, validation.message);
					return;
				}
				await handleNewSession(id, validation.cwd);
				return;
			}

			case "session/load": {
				if (protocolVersion === 2) {
					if (isRequest) {
						sendError(
							id,
							ACP_JSON_RPC_ERRORS.methodNotFound,
							"session/load was removed in ACP v2; use session/resume",
						);
					}
					return;
				}
				if (!isRequest) return;
				const validation = validateLoadSessionParams(params);
				if (!validation.ok) {
					sendError(id, ACP_JSON_RPC_ERRORS.invalidParams, validation.message);
					return;
				}
				await handleLoadSession(id, { sessionId: validation.sessionId, cwd: validation.cwd });
				return;
			}

			case "session/resume": {
				if (protocolVersion !== 2) {
					if (isRequest) {
						sendError(id, ACP_JSON_RPC_ERRORS.methodNotFound, "session/resume requires ACP v2");
					}
					return;
				}
				if (!isRequest) return;
				const validation = validateResumeParams(params);
				if (!validation.ok) {
					sendError(id, ACP_JSON_RPC_ERRORS.invalidParams, validation.message);
					return;
				}
				await handleResume(id, validation.value);
				return;
			}

			case "session/list": {
				if (protocolVersion !== 2) {
					if (isRequest) {
						sendError(id, ACP_JSON_RPC_ERRORS.methodNotFound, "session/list requires ACP v2");
					}
					return;
				}
				if (!isRequest) return;
				const validation = validateSessionListParams(params);
				if (!validation.ok) {
					sendError(id, ACP_JSON_RPC_ERRORS.invalidParams, validation.message);
					return;
				}
				await handleSessionList(id, validation.value);
				return;
			}

			case "session/close": {
				if (protocolVersion !== 2) {
					if (isRequest) {
						sendError(id, ACP_JSON_RPC_ERRORS.methodNotFound, "session/close requires ACP v2");
					}
					return;
				}
				if (!isRequest) return;
				const validation = validateCloseSessionParams(params);
				if (!validation.ok) {
					sendError(id, ACP_JSON_RPC_ERRORS.invalidParams, validation.message);
					return;
				}
				await handleCloseSession(id, validation.value.sessionId);
				return;
			}

			case "session/prompt": {
				if (!isRequest) return;
				const validation = validatePromptParams(params);
				if (!validation.ok) {
					sendError(id, ACP_JSON_RPC_ERRORS.invalidParams, validation.message);
					return;
				}
				// Do not await the turn here: stdin must stay readable so
				// session/cancel and session/request_permission responses arrive.
				void (protocolVersion === 2 ? handlePromptV2(id, validation.value) : handlePrompt(id, validation.value));
				return;
			}

			case "session/cancel": {
				if (isRequest) return;
				for (const promptId of activePromptIds) {
					cancelledPromptIds.add(promptId);
				}
				for (const requestId of [...pendingPermissionRequests.keys()]) {
					cancelPermissionRequest(requestId);
				}
				await session.abort();
				return;
			}

			default: {
				if (isRequest) {
					sendError(id, ACP_JSON_RPC_ERRORS.methodNotFound, `Unsupported method: ${request.method}`);
				}
			}
		}
	};

	const handleClientResponse = (response: JsonRpcResponseObject) => {
		if (response.error === undefined && response.result === undefined) return;
		const id = response.id;
		if (typeof id !== "string" && typeof id !== "number") return;
		const requestId = String(id);
		const pending = pendingPermissionRequests.get(requestId);
		if (!pending) return;
		if (response.error !== undefined) {
			cancelPermissionRequest(requestId);
			return;
		}
		const result = parseRequestPermissionResult(response.result);
		if (!result) {
			cancelPermissionRequest(requestId);
			return;
		}
		resolvePermissionRequest(requestId, result);
	};

	const handleCancelNotification = (params: unknown) => {
		if (typeof params !== "object" || params === null) return;
		const requestId = (params as { requestId?: unknown }).requestId;
		if (typeof requestId === "string" || typeof requestId === "number") {
			if (activePromptIds.has(requestId)) {
				cancelledPromptIds.add(requestId);
				void session.abort();
			}
			cancelPermissionRequest(String(requestId));
		}
	};

	const handleInputLine = async (line: string) => {
		const parsed = parseJsonRpcLine(line);
		if (parsed.error) {
			sendError(null, parsed.error.code, parsed.error.message);
			await waitForRawStdoutBackpressure();
			return;
		}
		if (parsed.response) {
			handleClientResponse(parsed.response);
			return;
		}
		if (!parsed.request) return;
		const request = parsed.request;

		if (request.method === "$/cancel_request") {
			handleCancelNotification(request.params);
			return;
		}

		if (request.id === undefined) {
			if (request.method === "session/cancel") {
				await handleRequest(request);
			}
			return;
		}

		await handleRequest(request);
		await waitForRawStdoutBackpressure();
	};

	async function shutdown(exitCode = 0, signal?: NodeJS.Signals): Promise<never> {
		if (shuttingDown) {
			process.exit(exitCode);
		}
		shuttingDown = true;
		killTrackedDetachedChildren();
		for (const cleanup of signalCleanupHandlers) {
			cleanup();
		}
		for (const requestId of [...pendingPermissionRequests.keys()]) {
			cancelPermissionRequest(requestId);
		}
		unsubscribe?.();
		unsubscribeBackpressure?.();
		await runtimeHost.dispose();
		detachInput();
		process.stdin.pause();
		if (signal !== "SIGTERM") {
			await flushRawStdout();
		}
		process.exit(exitCode);
	}

	const onInputEnd = () => {
		void shutdown();
	};
	process.stdin.on("end", onInputEnd);

	detachInput = (() => {
		const detachJsonl = attachJsonlLineReader(process.stdin, (line) => {
			void handleInputLine(line);
		});
		return () => {
			detachJsonl();
			process.stdin.off("end", onInputEnd);
		};
	})();

	// Keep process alive forever
	return new Promise(() => {});
}
