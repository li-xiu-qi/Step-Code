/**
 * ACP mode: native stdio JSON-RPC for Agent Client Protocol v1.
 *
 * This mode exposes the baseline ACP client surface over newline-delimited
 * JSON-RPC 2.0 on stdin/stdout. It reuses the same `AgentSessionRuntimeHost`
 * as the interactive TUI and RPC mode, so session persistence, extensions,
 * compaction, and tool execution behave identically. Only the wire format is
 * different.
 *
 * Supported methods:
 * - `initialize`
 * - `session/new`
 * - `session/load`
 * - `session/prompt`
 * - `session/cancel`
 *
 * Agent-to-client traffic uses `session/update` notifications and
 * `session/request_permission` requests for tool approval.
 *
 * Not part of this first baseline: ACP `terminal/*`, session config options,
 * session modes, and client-provided MCP servers. Those need separate product
 * decisions and are documented as follow-up work.
 */

import * as crypto from "node:crypto";
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
import { SessionManager } from "../../core/session-manager.ts";
import { type Theme, theme } from "../../theme/theme.ts";
import { resolvePath } from "../../utils/paths.ts";
import { killTrackedDetachedChildren } from "../../utils/shell.ts";
import { attachJsonlLineReader } from "../rpc/jsonl.ts";
import type {
	JsonRpcId,
	JsonRpcRequest,
	JsonRpcResponseObject,
	PromptParams,
	RequestPermissionResult,
	SessionNotificationParams,
} from "./acp-types.ts";
import { ACP_JSON_RPC_ERRORS, ACP_PROTOCOL_VERSION } from "./acp-types.ts";
import {
	createErrorResponse,
	createNotification,
	createResponse,
	normalizePrompt,
	parseJsonRpcLine,
	parseRequestPermissionResult,
	serializeJsonLine,
	toSessionNotification,
	validateInitializeParams,
	validateLoadSessionParams,
	validateNewSessionParams,
	validatePromptParams,
} from "./acp-wire.ts";

const PERMISSION_ALLOW_OPTION_ID = "allow_once";
const PERMISSION_REJECT_OPTION_ID = "reject_once";

export async function runAcpMode(runtimeHost: AgentSessionRuntimeHost): Promise<never> {
	takeOverStdout();
	let session = runtimeHost.session;
	let unsubscribe: (() => void) | undefined;
	let unsubscribeBackpressure: (() => void) | undefined;

	let initialized = false;
	let shuttingDown = false;
	let detachInput = () => {};
	const signalCleanupHandlers: Array<() => void> = [];

	const activePromptIds = new Set<JsonRpcId>();
	const cancelledPromptIds = new Set<JsonRpcId>();
	const pendingPermissionRequests = new Map<string, { resolve: (result: RequestPermissionResult) => void }>();

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
			return isPermissionAllowed(await sendPermissionRequest(title, message));
		};

		return {
			select: (title, options, opts) =>
				requestApproval(opts, title, options.join("\n")).then((approved) => (approved ? options[0] : undefined)),

			confirm: (title, message, opts) => requestApproval(opts, title, message),

			// ACP has no free-form text input in the baseline permission surface.
			// Resolve undefined instead of pretending a permission answer is text.
			input: (): Promise<string | undefined> => Promise.resolve(undefined),

			notify(message: string, type?: "info" | "warning" | "error"): void {
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
				const validation = validateInitializeParams(params);
				if (!validation.ok) {
					if (isRequest) {
						sendError(id, ACP_JSON_RPC_ERRORS.invalidParams, validation.message);
					}
					return;
				}
				initialized = true;
				if (isRequest) {
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
				}
				return;
			}

			case "session/new": {
				if (!isRequest) return;
				const validation = validateNewSessionParams(params);
				if (!validation.ok) {
					sendError(id, ACP_JSON_RPC_ERRORS.invalidParams, validation.message);
					return;
				}
				await handleNewSession(id, validation.cwd);
				return;
			}

			case "session/load": {
				if (!isRequest) return;
				const validation = validateLoadSessionParams(params);
				if (!validation.ok) {
					sendError(id, ACP_JSON_RPC_ERRORS.invalidParams, validation.message);
					return;
				}
				await handleLoadSession(id, { sessionId: validation.sessionId, cwd: validation.cwd });
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
				void handlePrompt(id, validation.value);
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
