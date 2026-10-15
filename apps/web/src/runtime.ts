import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
	type AgentSession,
	type AgentSessionEvent,
	type AgentSessionRuntime,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createStepAgentSessionServices,
	createStepCapabilitiesExtensionInline,
	createStepCronExtension,
	createStepExtensionInline,
	createStepGoalExtension,
	createStepPlanExtension,
	createStepProviderConfig,
	createStepSessionManager,
	createStepSessionManagerFactory,
	createStepSettingsManager,
	createUltraloopOptInExtension,
	DefaultResourceLoader,
	type ExtensionUIContext,
	getStepAuthPath,
	getStepMcpStatuses,
	type InlineExtension,
	listAllStepSessions,
	ModelRuntime,
	NOOP_OBSERVABILITY_PROVIDER,
	normalizeFeedbackCategory,
	openStepSession,
	readFeedbackUsername,
	readGlobalStepDefaults,
	resolveFeedbackEndpoint,
	resolveStepAgentDir,
	resolveStepConfigDir,
	resolveStepConfigRoot,
	resolveStepStorageRoot,
	type SessionEntry,
	type SessionInfo,
	STEP_PERMISSION_PRESETS,
	STEP_PROVIDER_ID,
	type StepMcpStatus,
	type StepPermissionPresetId,
	type StepSettingsManager,
	submitFeedback as submitKernelFeedback,
	syncStepLoginProfileEndpoint,
	THINKING_LEVEL_OPTIONS,
} from "@step-harness/coding-agent";
import { ApprovalBroker, type ApprovalRequest } from "./approval.ts";
import { type WebAttachment, withTextAttachments } from "./attachments.ts";
import { ClarificationBroker, type ClarificationEvent } from "./clarification.ts";
import { feedbackCategoryFor } from "./feedback.ts";
import { type WebSkill, webSkills } from "./skills.ts";
import {
	revertedTurnIds,
	type SkippedChange,
	TURN_REVERT_TYPE,
	TurnRevertError,
	TurnReverter,
	turnRevertNotice,
} from "./turn-changes.ts";
import { claimWebSessionWriter } from "./writer-lease.ts";

// Re-exported so the server and tests have one import site for attachment types.
export { classifyAttachment, MAX_ATTACHMENT_BYTES, type WebAttachment, withTextAttachments } from "./attachments.ts";

/** How long a session may spend discovering the account's model catalog. */
const MODEL_CATALOG_REFRESH_TIMEOUT_MS = 10_000;

/**
 * Presets the Web host refuses to set.
 *
 * `full-access` is gated in the kernel behind an interactive risk acknowledgment:
 * `confirmFullAccessRisk` asks the user to choose between three options, and the
 * first one is "Yes, continue anyway". The Web host renders no such dialog — its
 * `webUiContext.select` returns `options[0]` — so routing the tier through the
 * normal path would grant it with no confirmation at all. Until a real browser
 * confirmation exists, the tier is not offered and cannot be set.
 *
 * This is a host-side guard, not a kernel change: the kernel's gate is correct
 * for a host that can actually ask. `approve-for-me` needs no gate and is
 * unaffected.
 */
const WEB_BLOCKED_POLICIES: ReadonlySet<StepPermissionPresetId> = new Set<StepPermissionPresetId>(["full-access"]);

/**
 * Pull the signed-in account's real model catalog from `{base}/v1/models`.
 *
 * `models.json` is only an offline baseline, and neither `getAvailableSnapshot()`
 * nor `Models.getAvailable()` touches the network, so a host that wants the real
 * list has to refresh explicitly. Must run after the agent services are built:
 * each provider registration schedules a cache-only refresh that rebuilds the
 * catalog from models.json and would otherwise undo this one.
 *
 * Failures are swallowed on purpose — `fetchStepModels` already falls back to the
 * baseline, and a session must stay usable offline.
 */
async function refreshStepModelCatalog(modelRuntime: ModelRuntime): Promise<void> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), MODEL_CATALOG_REFRESH_TIMEOUT_MS);
	try {
		await modelRuntime.refresh({ allowNetwork: true, signal: controller.signal });
	} catch {
		// Catalog discovery is best-effort; the baseline models remain selectable.
	} finally {
		clearTimeout(timeout);
	}
}

export type WebEvent =
	| ClarificationEvent
	| { type: "agent"; event: AgentSessionEvent }
	| { type: "approval_required"; approval: ApprovalRequest }
	| { type: "status"; status: WebSessionStatus; unread: boolean }
	| { type: "error"; message: string };

export type WebSessionStatus = "idle" | "running" | "waiting" | "completed" | "failed";

/**
 * MCP servers of the host process. The kernel keeps one status list, written
 * by the session that started last; the Web host renders no `/mcp` notify text.
 */
export function mcpStatuses(): StepMcpStatus[] {
	return getStepMcpStatuses();
}

/** The session modes the composer can toggle. Each is independent of the others. */
export type WebMode = "goal" | "plan" | "ultraloop";

/**
 * The official StepCode CLI currently persists sessions through Pi's native
 * SessionManager (JSONL v3). This registry prevents two Web sessions in the
 * same host process from appending to one file at once. It is intentionally
 * not presented as a cross-process lock: older CLI builds do not participate
 * in a shared lease protocol and must be closed before Web takes ownership.
 */
function webUiContext(broker: ApprovalBroker, clarifications: ClarificationBroker): ExtensionUIContext {
	const unsupported = async <T>(fallback: T): Promise<T> => fallback;
	return {
		clarify: (questions, signal) => clarifications.ask(questions, signal),
		select: async (_title, options) => options[0],
		confirm: (title, message, options) =>
			broker.confirm(title.replace(/^Approve |^Dangerous /u, ""), message, options?.signal),
		input: async () => undefined,
		notify: () => {},
		onTerminalInput: () => () => {},
		setStatus: () => {},
		setWorkingMessage: () => {},
		setWorkingVisible: () => {},
		setWorkingIndicator: () => {},
		setHiddenThinkingLabel: () => {},
		setWidget: () => {},
		setFooter: () => {},
		setHeader: () => {},
		setTitle: () => {},
		custom: async <T>() => unsupported<T>(undefined as T),
		pasteToEditor: () => {},
		setEditorText: () => {},
		getEditorText: () => "",
		editor: async () => undefined,
		addAutocompleteProvider: () => {},
		setEditorComponent: () => {},
		getEditorComponent: () => undefined,
		get theme() {
			return undefined as never;
		},
		getAllThemes: () => [],
		getTheme: () => undefined,
		setTheme: () => ({ success: false, error: "Theme switching is not available on Web" }),
		getToolsExpanded: () => false,
		setToolsExpanded: () => {},
	};
}

function makeExtensions(settingsManager: StepSettingsManager, broker: ApprovalBroker): InlineExtension[] {
	const telemetry = NOOP_OBSERVABILITY_PROVIDER.createReporter();
	const persisted = settingsManager.getStepSettings();
	const permission = {
		initialPreset: (persisted.permissionPreset ?? "ask") as StepPermissionPresetId,
		nonInteractiveApproval: persisted.nonInteractiveApproval ?? "deny",
	};
	const webHostExtension: InlineExtension = {
		name: "StepCode Web host",
		hidden: true,
		factory: (pi) => {
			pi.on("tool_call", (event) => {
				broker.captureToolCall(event.toolCallId, event.toolName, event.input);
			});
			pi.on("session_start", (_event, context) => {
				context.ui.notify("StepCode Web session ready");
			});
		},
	};
	return [
		webHostExtension,
		createStepExtensionInline({
			telemetry,
			permission,
			stepSettings: () => settingsManager,
			traceHeaderPolicy: NOOP_OBSERVABILITY_PROVIDER.traceHeaderPolicy(),
		}),
		createStepCapabilitiesExtensionInline({ telemetry }),
		createStepCronExtension({ telemetry }),
		createStepGoalExtension({ telemetry }),
		createStepPlanExtension({ telemetry }),
		// Ultracode/Ultraloop takes no telemetry option of its own.
		createUltraloopOptInExtension(),
	];
}

/** Same provider and model id, which is all a resolved model needs to match. */
function modelsMatch(left: { provider: string; id: string }, right: { provider: string; id: string }): boolean {
	return left.provider === right.provider && left.id === right.id;
}

function projectEntry(entry: SessionEntry): Record<string, unknown> {
	// Only assistant turns carry usage; other message kinds have none to report.
	const usage = entry.type === "message" && entry.message.role === "assistant" ? entry.message.usage : undefined;
	return {
		id: entry.id,
		type: entry.type,
		timestamp: entry.timestamp,
		...(entry.type === "message" ? { message: entry.message } : {}),
		...(usage ? { usage } : {}),
		...(entry.type === "custom_message" ? { content: entry.content, customType: entry.customType } : {}),
		...(entry.type === "compaction" ? { summary: entry.summary } : {}),
		...(entry.type === "branch_summary" ? { summary: entry.summary } : {}),
	};
}

export class WebSession {
	readonly broker: ApprovalBroker;
	readonly clarifications: ClarificationBroker;
	private readonly listeners = new Set<(event: WebEvent) => void>();
	private runtime!: AgentSessionRuntime;
	private session!: AgentSession;
	private status: WebSessionStatus = "idle";
	private unread = false;
	private unsubscribeSession?: () => void;
	private unsubscribeRuntimeSessionChange?: () => void;
	private releaseWriterLease?: () => void;
	private writerLeasePath?: string;
	private archived = false;
	private readonly reverter = new TurnReverter();

	private constructor(
		id: string,
		cwd: string,
		agentDir: string,
		modelRuntime: ModelRuntime,
		sessionManager: ReturnType<typeof createStepSessionManager>,
		writerOwnerId: string,
	) {
		this.id = id;
		this.cwd = cwd;
		this.agentDir = agentDir;
		this.modelRuntime = modelRuntime;
		this.sessionManager = sessionManager;
		this.writerOwnerId = writerOwnerId;
		this.clarifications = new ClarificationBroker(
			() => this.id,
			(event) => {
				if (event.type === "clarification_required") this.setStatus("waiting", false);
				this.emit(event);
				if (
					event.type === "clarification_resolved" &&
					!this.clarifications.pendingRequests().length &&
					!this.broker.pendingRequests().length
				)
					this.setStatus("running", false);
			},
		);
		this.broker = new ApprovalBroker(id, (event) => {
			if (event.type === "approval_required") this.setStatus("waiting", false);
			this.emit(event);
		});
	}

	/** Follows the live session: a fork or /new swaps the manager underneath. */
	id: string;
	readonly cwd: string;
	private readonly agentDir: string;
	private readonly modelRuntime: ModelRuntime;
	private readonly sessionManager: ReturnType<typeof createStepSessionManager>;
	private readonly writerOwnerId: string;

	static async create(options: { cwd: string; sessionId?: string; sessionPath?: string }): Promise<WebSession> {
		const agentDir = resolveStepAgentDir();
		const cwd = options.cwd;
		const authPath = getStepAuthPath();
		// The stored credential names a login region, and the provider reads that
		// region's endpoints from the environment. The CLI does this before it
		// builds a session; without it a `step_plan` credential is sent to the
		// default endpoint, discovery fails, and the session has no model at all.
		syncStepLoginProfileEndpoint(authPath);
		const modelRuntime = await ModelRuntime.create({
			authPath,
			modelsPath: join(resolveStepConfigRoot(), "models.json"),
		});
		modelRuntime.registerProvider(STEP_PROVIDER_ID, createStepProviderConfig());
		const writerOwnerId = randomUUID();
		const releaseWriterLease = options.sessionPath
			? claimWebSessionWriter(options.sessionPath, writerOwnerId)
			: undefined;
		try {
			const sessionManager = options.sessionPath
				? openStepSession(options.sessionPath, { agentDir, cwd, cwdOverride: cwd })
				: createStepSessionManager(cwd, {
						agentDir,
						newSession: options.sessionId ? { id: options.sessionId } : undefined,
					});
			const instance = new WebSession(
				sessionManager.getSessionId(),
				cwd,
				agentDir,
				modelRuntime,
				sessionManager,
				writerOwnerId,
			);
			instance.releaseWriterLease = releaseWriterLease;
			instance.writerLeasePath = options.sessionPath ? resolve(options.sessionPath) : undefined;
			await instance.start();
			// After start(): building the services re-registers the Step provider,
			// and each registration resets the catalog to the models.json baseline.
			await refreshStepModelCatalog(modelRuntime);
			await instance.enforceBlockedPolicies();
			return instance;
		} catch (error) {
			releaseWriterLease?.();
			throw error;
		}
	}

	private async start(): Promise<void> {
		const initialSessionFile = this.sessionManager.getSessionFile();
		const resolvedInitialSessionFile = initialSessionFile ? resolve(initialSessionFile) : undefined;
		if (resolvedInitialSessionFile && resolvedInitialSessionFile !== this.writerLeasePath) {
			const claim = claimWebSessionWriter(resolvedInitialSessionFile, this.writerOwnerId);
			this.releaseWriterLease?.();
			this.releaseWriterLease = claim;
			this.writerLeasePath = resolvedInitialSessionFile;
		}
		const createRuntime = async (options: {
			cwd: string;
			agentDir: string;
			sessionManager: ReturnType<typeof createStepSessionManager>;
			sessionStartEvent?: {
				type: "session_start";
				reason: "startup" | "reload" | "new" | "resume" | "fork";
				previousSessionFile?: string;
			};
		}) => {
			const settingsManager = createStepSettingsManager(options.cwd, options.agentDir, {
				configDirName: resolveStepConfigDir(),
			});
			// Read per session: config.toml can change while the host runs, and the
			// CLI re-reads it at every launch.
			const defaults = readGlobalStepDefaults();
			const services = await createStepAgentSessionServices({
				cwd: options.cwd,
				agentDir: options.agentDir,
				authPath: getStepAuthPath(),
				configDirName: resolveStepConfigDir(),
				settingsManager,
				modelRuntime: this.modelRuntime,
				resourceLoaderOptions: { extensionFactories: makeExtensions(settingsManager, this.broker) },
			});
			// Resolve the model against a populated catalog. `models.json` is only an
			// offline baseline and Step ships none, so an unrefreshed runtime offers
			// zero models and the session is left on the `unknown` placeholder.
			await refreshStepModelCatalog(this.modelRuntime);
			const created = await createAgentSessionFromServices({
				services,
				sessionManager: options.sessionManager,
				sessionStartEvent: options.sessionStartEvent,
				// Same defaults the CLI injects into argv (`withStepDefaults`): the
				// persisted provider/model from config.toml, with the product provider
				// as the fallback. The settings manager already carries the persisted
				// thinking level, so it is not repeated here.
				defaultProvider: defaults.provider ?? STEP_PROVIDER_ID,
				...(defaults.model ? { defaultModelId: defaults.model } : {}),
				systemPromptProduct: {
					name: "StepCode",
					role: "a local coding agent",
					introduction: "You are StepCode Web. Work in the selected workspace and explain what you do.",
					includeDocumentation: false,
				},
			});
			return { ...created, services, diagnostics: services.diagnostics };
		};
		try {
			this.runtime = await createAgentSessionRuntime(createRuntime, {
				cwd: this.cwd,
				agentDir: this.agentDir,
				sessionManager: this.sessionManager,
				sessionManagerFactory: createStepSessionManagerFactory(this.agentDir),
			});
			this.bindSession(this.runtime.session);
			this.unsubscribeRuntimeSessionChange = this.runtime.onSessionChange((session) => this.bindSession(session));
		} catch (error) {
			this.releaseWriterLease?.();
			this.releaseWriterLease = undefined;
			this.writerLeasePath = undefined;
			throw error;
		}
	}

	/**
	 * Drop a blocked preset that a session was already persisted with.
	 *
	 * Blocking the setter only stops the tier being *chosen*. A config written by
	 * the CLI (`~/.stepcode/config.toml`) can still carry `full-access`, and the
	 * kernel's own migration only retires the pre-rename names, not this one — so
	 * without this a Web session would boot straight into unrestricted operation
	 * with nothing in the UI to explain it.
	 */
	private async enforceBlockedPolicies(): Promise<void> {
		const active = (this.session.settingsManager as StepSettingsManager).getStepPermissionPreset();
		if (!active || !WEB_BLOCKED_POLICIES.has(active)) return;
		await this.setPolicy("ask");
		this.publishError(`This session was set to "${active}", which the Web host does not allow. Switched to "ask".`);
	}

	private bindSession(session: AgentSession): void {
		this.clarifications.clear();
		// Keep the advertised id in step with the session actually bound, so a
		// fork or /new does not leave the UI pointing at the previous session.
		this.id = session.sessionManager.getSessionId();
		const sessionFile = session.sessionManager.getSessionFile();
		const resolvedSessionFile = sessionFile ? resolve(sessionFile) : undefined;
		if (resolvedSessionFile !== this.writerLeasePath) {
			let claim: (() => void) | undefined;
			try {
				claim = resolvedSessionFile ? claimWebSessionWriter(resolvedSessionFile, this.writerOwnerId) : undefined;
			} catch (error) {
				this.publishError(error instanceof Error ? error.message : String(error));
				return;
			}
			this.releaseWriterLease?.();
			this.releaseWriterLease = claim;
			this.writerLeasePath = resolvedSessionFile;
		}
		this.unsubscribeSession?.();
		this.session = session;
		void this.adoptFallbackModel(session);
		this.unsubscribeSession = session.subscribe((event) => {
			if (event.type === "agent_start") this.setStatus("running");
			if (event.type === "agent_settled") this.setStatus("completed", true);
			if (
				event.type === "agent_end" &&
				event.messages.some(
					(message: { role: string; stopReason?: string }) =>
						message.role === "assistant" && message.stopReason === "error",
				)
			)
				this.setStatus("failed", true);
			this.emit({ type: "agent", event });
		});
		void session.bindExtensions({
			mode: "rpc",
			uiContext: webUiContext(this.broker, this.clarifications),
			commandContextActions: {
				waitForIdle: () => session.waitForIdle(),
				newSession: (options) => this.runtime.newSession(options),
				fork: (entryId, options) => this.runtime.fork(entryId, options),
				navigateTree: (targetId, options) => session.navigateTree(targetId, options),
				switchSession: (path, options) => this.runtime.switchSession(path, options),
				reload: () => session.reload(),
			},
			onError: (error) => this.emit({ type: "error", message: error.error }),
		});
	}

	private setStatus(status: WebSessionStatus, unread = this.unread): void {
		this.status = status;
		this.unread = unread;
		this.emit({ type: "status", status, unread });
	}

	private emit(event: WebEvent): void {
		for (const listener of this.listeners) listener(event);
	}

	publishError(message: string): void {
		this.emit({ type: "error", message });
		this.setStatus("failed", true);
	}

	subscribe(listener: (event: WebEvent) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/**
	 * Give a session a real model when resolution produced none.
	 *
	 * Discovery is a network call with no built-in baseline, so a credential that
	 * is valid but momentarily unusable leaves the session on the `unknown`
	 * placeholder. Sending then fails with "No API key found for the selected
	 * model", which names no provider and hides the real problem. Any model the
	 * runtime lists is a better answer, and the picker already showed it.
	 */
	private async adoptFallbackModel(session: AgentSession): Promise<void> {
		const available = this.modelRuntime.getAvailableSnapshot();
		// A model the runtime does not list is one agent-core could not resolve,
		// including the `unknown` placeholder it falls back to.
		const current = session.model;
		if (current && available.some((model) => modelsMatch(model, current))) return;
		const fallback = available[0];
		if (!fallback) return;
		try {
			await session.setModel(fallback);
		} catch (error) {
			// A model that fails to apply is not worth failing the session over:
			// the user still has the picker, and the error would otherwise be lost.
			this.publishError(error instanceof Error ? error.message : String(error));
		}
	}

	/** A revert is writing files right now; prompts wait for it. */
	isReverting(): boolean {
		return this.reverter.isBusy();
	}

	async send(text: string, attachments: readonly WebAttachment[] = []): Promise<void> {
		if (this.isReverting()) throw new Error("Wait for the revert to finish");
		this.unread = false;
		const images = attachments
			.filter((attachment) => attachment.kind === "image")
			.map((attachment) => ({ type: "image" as const, data: attachment.data, mimeType: attachment.mimeType }));
		await this.session.prompt(withTextAttachments(text, attachments), {
			source: "rpc",
			...(images.length ? { images } : {}),
		});
	}

	async steer(text: string): Promise<void> {
		await this.session.steer(text);
	}

	async rename(name: string): Promise<void> {
		const trimmed = name.trim().slice(0, 20);
		if (!trimmed) throw new Error("Session name cannot be empty");
		this.session.setSessionName(trimmed);
	}

	async setPolicy(preset: StepPermissionPresetId): Promise<void> {
		if (WEB_BLOCKED_POLICIES.has(preset)) {
			throw new Error(`Permission preset "${preset}" is not available on the Web host.`);
		}
		if (!STEP_PERMISSION_PRESETS.some((candidate) => candidate.id === preset)) {
			throw new Error(`Unknown permission preset: ${preset}`);
		}
		// Use the official Step command path so the live permission controller,
		// autopilot state, and persistence stay in sync. Reloading the whole
		// extension tree would invalidate long-lived cron callbacks.
		await this.session.prompt(`/permissions ${preset}`, { source: "rpc" });
	}

	/**
	 * Submit feedback about this conversation.
	 *
	 * The kernel accepts five coarse categories and rejects anything else, while
	 * the UI offers finer topics. The topic is therefore folded into the comment
	 * and the kernel category is derived from the sentiment plus the topic, so no
	 * detail is lost on the way through.
	 */
	async submitFeedback(input: { sentiment: "up" | "down"; topic?: string; comment: string }): Promise<{
		readonly ok: boolean;
		readonly message: string;
		readonly feedbackId?: string;
	}> {
		const endpoint = resolveFeedbackEndpoint();
		if (!endpoint) {
			return { ok: false, message: "Feedback is not configured for this build." };
		}
		const category = feedbackCategoryFor(input.sentiment, input.topic);
		// The topic table is a copy of a kernel contract; fail loudly if it drifts
		// rather than letting the kernel reject the submission downstream.
		const normalized = normalizeFeedbackCategory(category);
		if (!normalized) {
			return { ok: false, message: `Unknown feedback category: ${category}` };
		}
		const topic = input.topic?.trim();
		const comment = topic ? `[${topic}] ${input.comment.trim()}` : input.comment.trim();
		const result = await submitKernelFeedback({
			category: normalized,
			comment,
			sessionId: this.id,
			storageRootDir: resolveStepStorageRoot(),
			endpoint,
			username: readFeedbackUsername(),
			surface: "cli",
			env: process.env,
		});
		if (result.status === "invalid") return { ok: false, message: result.error };
		if (result.status === "cancelled") return { ok: false, message: "Feedback submission was cancelled." };
		return {
			ok: true,
			message: `Submitted. Feedback ID: ${result.submission.feedbackId}`,
			feedbackId: result.submission.feedbackId,
		};
	}

	/**
	 * Fork the conversation at an entry, or from the current turn when omitted.
	 * Returns the session id now bound, which differs after a successful fork.
	 */
	async fork(entryId?: string): Promise<{ cancelled: boolean; sessionId: string }> {
		if (entryId) {
			// Forking at a named turn keeps that turn in the new branch; the default
			// "before" position only accepts a user message.
			const result = await this.runtime.fork(entryId, { position: "at" });
			return { cancelled: result.cancelled, sessionId: this.id };
		}
		// No target: fork from the last thing the user said.
		const branch = this.session.sessionManager.getBranch();
		const lastUserEntry = [...branch]
			.reverse()
			.find((entry) => entry.type === "message" && entry.message.role === "user");
		const result = lastUserEntry ? await this.runtime.fork(lastUserEntry.id) : { cancelled: true };
		return { cancelled: result.cancelled, sessionId: this.id };
	}

	async decideApproval(id: string, verdict: "approve" | "approve_for_session" | "deny"): Promise<boolean> {
		const decided = this.broker.decide(id, verdict);
		if (decided) this.setStatus("running", false);
		return decided;
	}

	async interrupt(): Promise<void> {
		this.clarifications.clear();
		await this.session.abort();
		this.setStatus("idle");
	}

	async setModel(provider: string, modelId: string): Promise<void> {
		const model = this.modelRuntime.getModel(provider, modelId);
		if (!model) throw new Error(`Model not found: ${provider}/${modelId}`);
		await this.session.setModel(model, { persist: true });
	}

	/**
	 * Set the reasoning effort for the current model. The kernel clamps an
	 * unsupported level internally, so the caller only has to reject values that
	 * are not thinking levels at all.
	 */
	setThinkingLevel(level: string): void {
		if (!THINKING_LEVEL_OPTIONS.includes(level as (typeof THINKING_LEVEL_OPTIONS)[number])) {
			throw new Error(`Unknown thinking level: ${level}`);
		}
		this.session.setThinkingLevel(level as (typeof THINKING_LEVEL_OPTIONS)[number], { persist: true });
	}

	/**
	 * Toggle one of the composer's session modes.
	 *
	 * Each mode is a slash command the owning extension registers, so this only
	 * routes the right one. Goal is the exception: enabling it needs the goal
	 * text, because `/goal` with no argument means "show status".
	 *
	 * `streamingBehavior` is required: a slash command is still a prompt, and a
	 * session that is mid-turn rejects a bare one instead of queueing it.
	 */
	async setMode(mode: WebMode, enabled: boolean, goal?: string): Promise<void> {
		const prompt =
			mode === "plan"
				? "/plan"
				: mode === "ultraloop"
					? enabled
						? "/ultraloop on"
						: "/ultraloop off"
					: enabled
						? `/goal ${(goal ?? "").trim()}`
						: "/goal clear";
		await this.session.prompt(prompt, { source: "rpc", streamingBehavior: "followUp" });
	}

	snapshot(): Record<string, unknown> {
		const manager = this.session.sessionManager;
		return {
			id: this.id,
			cwd: this.cwd,
			name: this.session.sessionName,
			status: this.status,
			unread: this.unread,
			sessionFile: manager.getSessionFile(),
			archived: this.archived,
			revertedTurns: revertedTurnIds(manager.getBranch()),
			entries: manager.getBranch().map(projectEntry),
			pendingApprovals: this.broker.pendingRequests(),
			pendingClarifications: this.clarifications.pendingRequests(),
			model: this.session.model ? { provider: this.session.model.provider, id: this.session.model.id } : undefined,
			permissionPreset: (this.session.settingsManager as StepSettingsManager).getStepPermissionPreset() ?? "ask",
			// Labelled straight from the kernel so the UI never invents its own copy.
			// Blocked tiers are withheld rather than shown-and-rejected: offering one
			// the host will refuse is a dead end in the UI.
			policies: STEP_PERMISSION_PRESETS.filter((preset) => !WEB_BLOCKED_POLICIES.has(preset.id)).map((preset) => ({
				id: preset.id,
				label: preset.label,
				description: preset.description,
			})),
			thinkingLevel: this.session.thinkingLevel,
			availableThinkingLevels: this.session.getAvailableThinkingLevels(),
			models: this.modelRuntime.getAvailableSnapshot().map((model) => ({
				provider: model.provider,
				id: model.id,
				name: model.name,
				api: model.api,
				reasoning: model.reasoning ?? false,
				contextWindow: model.contextWindow,
				maxTokens: model.maxTokens,
				input: model.input,
				cost: model.cost,
			})),
		};
	}

	sessionFile(): string | undefined {
		return this.session.sessionManager.getSessionFile();
	}

	/** Skills of this session's resource loader (plugin skills included), unless skill commands are off. */
	skills(): WebSkill[] {
		if (!this.session.settingsManager.getEnableSkillCommands()) return [];
		return webSkills(this.session.resourceLoader.getSkills().skills);
	}

	setArchived(archived: boolean): void {
		this.archived = archived;
	}

	/**
	 * Undo the file changes of the turn that starts at user entry `turnId`.
	 * Refused while a turn runs: the agent could be writing the same files.
	 *
	 * The model is told through a custom message (in its context, not a new
	 * turn): otherwise it still believes its edits are on disk. The same entry
	 * marks the turn as reverted, so the state follows the session branch.
	 */
	async revertTurn(turnId: string): Promise<{ paths: string[]; skipped: readonly SkippedChange[] }> {
		if (this.status === "running" || this.status === "waiting")
			throw new TurnRevertError("busy", "Stop the running turn first");
		const branch = this.session.sessionManager.getBranch();
		return this.reverter.revert(turnId, branch, this.cwd, (turn, changes, paths) =>
			this.session.sendCustomMessage(
				{
					customType: TURN_REVERT_TYPE,
					content: turnRevertNotice(branch, turn, changes),
					display: false,
					details: { turnId: turn, paths },
				},
				{ triggerTurn: false },
			),
		);
	}

	async close(): Promise<void> {
		this.clarifications.clear();
		this.broker.clear();
		this.unsubscribeSession?.();
		await this.runtime.dispose();
		this.unsubscribeRuntimeSessionChange?.();
		this.releaseWriterLease?.();
		this.releaseWriterLease = undefined;
		this.writerLeasePath = undefined;
		this.listeners.clear();
	}
}

interface WebSessionMetadata {
	archived?: boolean;
}

class WebSessionMetadataStore {
	private readonly path: string;
	private readonly values = new Map<string, WebSessionMetadata>();
	private loaded = false;

	constructor(agentDir: string) {
		this.path = join(agentDir, "web-sessions.json");
	}

	async load(): Promise<void> {
		if (this.loaded) return;
		this.loaded = true;
		try {
			const parsed = JSON.parse(await readFile(this.path, "utf8")) as Record<string, WebSessionMetadata>;
			for (const [id, value] of Object.entries(parsed)) {
				if (value && typeof value === "object") this.values.set(id, value);
			}
		} catch {
			// Missing or malformed Web metadata must not block the canonical v3 session store.
		}
	}

	isArchived(id: string): boolean {
		return this.values.get(id)?.archived === true;
	}

	async setArchived(id: string, archived: boolean): Promise<void> {
		await this.load();
		this.values.set(id, { archived });
		const serialized = JSON.stringify(Object.fromEntries(this.values), null, 2);
		await mkdir(dirname(this.path), { recursive: true });
		const temporary = `${this.path}.${process.pid}.tmp`;
		await writeFile(temporary, `${serialized}\n`, "utf8");
		await rename(temporary, this.path);
	}

	async remove(id: string): Promise<void> {
		await this.load();
		this.values.delete(id);
		const serialized = JSON.stringify(Object.fromEntries(this.values), null, 2);
		await mkdir(dirname(this.path), { recursive: true });
		const temporary = `${this.path}.${process.pid}.tmp`;
		await writeFile(temporary, `${serialized}\n`, "utf8");
		await rename(temporary, this.path);
	}
}

export class WebSessionStore {
	private readonly sessions = new Map<string, WebSession>();
	private readonly openings = new Map<string, Promise<WebSession>>();
	private readonly metadata = new WebSessionMetadataStore(resolveStepAgentDir());

	async create(cwd: string): Promise<WebSession> {
		await this.metadata.load();
		const session = await WebSession.create({ cwd });
		this.sessions.set(session.id, session);
		return session;
	}

	async getOrOpen(id: string): Promise<WebSession> {
		await this.metadata.load();
		const session = this.sessions.get(id);
		if (session) return session;
		const opening = this.openings.get(id);
		if (opening) return opening;
		const pending = (async () => {
			const info = (await this.list()).find((candidate) => candidate.id === id);
			if (!info) throw new Error(`Session not found: ${id}`);
			const opened = await WebSession.create({
				cwd: info.cwdAvailable ? info.cwd : defaultWorkspace(),
				sessionPath: info.path,
				sessionId: info.id,
			});
			opened.setArchived(this.metadata.isArchived(opened.id));
			this.sessions.set(opened.id, opened);
			return opened;
		})();
		this.openings.set(id, pending);
		try {
			return await pending;
		} finally {
			this.openings.delete(id);
		}
	}

	async list(): Promise<Array<SessionInfo & { archived: boolean; cwdAvailable: boolean }>> {
		await this.metadata.load();
		const sessions = await listAllStepSessions({ agentDir: resolveStepAgentDir(), recursive: true });
		return Promise.all(
			sessions.map(async (session) => {
				let cwdAvailable = false;
				try {
					cwdAvailable = session.cwd ? (await stat(session.cwd)).isDirectory() : false;
				} catch {
					// A session with a removed cwd remains readable and appears under Recent.
				}
				return { ...session, archived: this.metadata.isArchived(session.id), cwdAvailable };
			}),
		);
	}

	/**
	 * Skills for a workspace without a session yet (a draft). An open session in
	 * the same folder answers exactly (plugin skills included). Otherwise the
	 * folder's resources are resolved as a session would (settings, user and
	 * project skill folders, packages) without extensions and without starting
	 * anything; only plugin skills, added by an extension, are missing.
	 */
	async skillsFor(cwd: string): Promise<WebSkill[]> {
		const open = [...this.sessions.values()].find((session) => session.cwd === cwd);
		if (open) return open.skills();
		const agentDir = resolveStepAgentDir();
		const configDirName = resolveStepConfigDir();
		const settingsManager = createStepSettingsManager(cwd, agentDir, { configDirName });
		if (!settingsManager.getEnableSkillCommands()) return [];
		const loader = new DefaultResourceLoader({ cwd, agentDir, configDirName, settingsManager, noExtensions: true });
		await loader.reload();
		return webSkills(loader.getSkills().skills);
	}

	async archive(id: string, archived: boolean): Promise<WebSession> {
		const session = await this.getOrOpen(id);
		await this.metadata.setArchived(id, archived);
		session.setArchived(archived);
		return session;
	}

	async delete(id: string): Promise<void> {
		const session = await this.getOrOpen(id);
		const sessionFile = session.sessionFile();
		await session.close();
		this.sessions.delete(id);
		await this.metadata.remove(id);
		if (sessionFile) {
			try {
				await unlink(sessionFile);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			}
		}
	}

	async close(): Promise<void> {
		await Promise.allSettled(this.openings.values());
		await Promise.all([...this.sessions.values()].map((session) => session.close()));
		this.openings.clear();
		this.sessions.clear();
	}
}

export function defaultWorkspace(): string {
	return process.env.STEPCODE_WEB_CWD?.trim() || process.cwd();
}
