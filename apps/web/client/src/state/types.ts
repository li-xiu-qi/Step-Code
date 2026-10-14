/**
 * Client-side shapes of what the StepCode Web host returns. They mirror
 * apps/web/src (runtime.ts snapshot(), files.ts, workspaces.ts, login.ts,
 * approval.ts) loosely: the client tolerates missing optional fields exactly as
 * the legacy app.js did.
 */

import type { TagColor } from "../i18n/messages";

export type SessionStatus = "idle" | "running" | "waiting" | "completed" | "failed";

export interface ModelRef {
	readonly provider: string;
	readonly id: string;
}

export interface ModelInfo extends ModelRef {
	readonly name?: string;
	readonly api?: string;
	readonly reasoning?: boolean;
	readonly contextWindow?: number;
	readonly maxTokens?: number;
	readonly input?: readonly string[];
	readonly cost?: unknown;
}

export interface PolicyPreset {
	readonly id: string;
	readonly label: string;
	readonly description: string;
}

export interface Usage {
	readonly input: number;
	readonly output: number;
	readonly [key: string]: unknown;
}

/** One content part of an agent message. */
export interface ContentPart {
	readonly type: string;
	readonly text?: string;
	readonly id?: string;
	readonly name?: string;
	readonly arguments?: unknown;
	readonly [key: string]: unknown;
}

export interface AgentMessage {
	readonly role: string;
	readonly content?: string | readonly ContentPart[];
	readonly toolCallId?: string;
	readonly isError?: boolean;
	readonly usage?: Usage;
	readonly [key: string]: unknown;
}

/** A projected session entry (runtime.ts `projectEntry`). */
export interface SessionEntry {
	readonly id: string;
	readonly type: string;
	readonly timestamp?: string;
	readonly message?: AgentMessage;
	readonly usage?: Usage;
	readonly [key: string]: unknown;
}

/** A row of GET /api/v1/sessions. Snapshots are merged into these rows too. */
export interface SessionSummary {
	readonly id: string;
	readonly cwd?: string;
	readonly name?: string;
	readonly firstMessage?: string;
	readonly allMessagesText?: string;
	readonly created?: string;
	readonly modified?: string;
	readonly messageCount?: number;
	readonly archived?: boolean;
	readonly cwdAvailable?: boolean;
	readonly status?: SessionStatus;
	readonly unread?: boolean;
	readonly [key: string]: unknown;
}

/** GET /api/v1/sessions/:id and the SSE `snapshot` event (runtime.ts `snapshot()`). */
export interface SessionSnapshot extends SessionSummary {
	readonly cwd: string;
	readonly status: SessionStatus;
	readonly sessionFile?: string;
	readonly entries?: readonly SessionEntry[];
	readonly model?: ModelRef;
	readonly permissionPreset?: string;
	readonly policies?: readonly PolicyPreset[];
	readonly thinkingLevel?: string;
	readonly availableThinkingLevels?: readonly string[];
	readonly models?: readonly ModelInfo[];
	/** Tool calls still waiting for a verdict; the stream only announces each one once. */
	readonly pendingApprovals?: readonly ApprovalRequest[];
	readonly pendingClarifications?: readonly ClarificationRequest[];
}

export interface ClarificationQuestion {
	readonly id: string;
	readonly label: string;
	readonly question: string;
	readonly reason?: string;
	readonly options: readonly { readonly label: string; readonly value: string; readonly description?: string }[];
	readonly allowFreeform: boolean;
}

export interface ClarificationRequest {
	readonly id: string;
	readonly sessionId: string;
	readonly questions: readonly ClarificationQuestion[];
}

export type ClarificationReply = { readonly id: string } & (
	| { readonly optionIndex: number }
	| { readonly text: string }
	| { readonly skipped: true }
);

export interface ApprovalRequest {
	readonly id: string;
	readonly sessionId: string;
	readonly toolName: string;
	readonly message: string;
	readonly input?: Readonly<Record<string, unknown>>;
	readonly reason?: string;
	readonly createdAt: number;
	readonly preview?: {
		readonly path?: string;
		readonly before?: string;
		readonly after?: string;
	};
}

export interface MessageTimelineItem {
	readonly itemId: string;
	readonly kind: "message";
	readonly entryId?: string;
	readonly role: string;
	readonly content: string;
	readonly usage?: Usage;
	readonly timestamp?: string;
}

export type ToolState = "pending" | "completed" | "failed";

export interface ToolTimelineItem {
	readonly itemId: string;
	readonly kind: "tool";
	readonly state: ToolState;
	readonly toolName: string;
	readonly inputSummary: string;
	readonly outputSummary: string;
	/** Full arguments and result, shown when the row is expanded. */
	readonly inputDetail?: string;
	readonly outputDetail?: string;
}

export interface ApprovalTimelineItem {
	readonly itemId: string;
	readonly kind: "approval";
	readonly approval: ApprovalRequest;
}

export type TimelineItem = MessageTimelineItem | ToolTimelineItem | ApprovalTimelineItem;

export interface WebWorkspace {
	readonly path: string;
	readonly name: string;
	/** False when the directory has since been moved or deleted. */
	readonly available: boolean;
}

export interface LoginReport {
	readonly source: "environment" | "auth.json" | "none";
	readonly provider?: string;
	readonly profile?: string;
	readonly path?: string;
	readonly configured: boolean;
	readonly validity?: string;
	readonly loginCommand: string;
}

export interface BootstrapPayload {
	readonly cwd: string;
	readonly directoryPicker?: string;
	readonly login?: LoginReport | null;
}

export interface TreeEntry {
	readonly name: string;
	/** Path relative to the workspace root, with `/` separators. */
	readonly path: string;
	readonly kind: "directory" | "file";
}

export type WorkspaceFile =
	| { readonly kind: "text"; readonly path: string; readonly size: number; readonly content: string }
	| { readonly kind: "image"; readonly path: string; readonly size: number; readonly mimeType: string }
	| { readonly kind: "binary" | "too-large"; readonly path: string; readonly size: number };

/** GET /api/v1/directories (the in-page workspace browser). */
export interface DirectoryListing {
	readonly path: string;
	readonly parent: string;
	readonly directories: ReadonlyArray<{ readonly name: string; readonly path: string }>;
}

export interface TagGroup {
	readonly key: TagColor;
	readonly name: string;
}

/** A file staged for the next message. `data` is base64. */
export interface Attachment {
	readonly name: string;
	readonly mimeType: string;
	readonly data: string;
	readonly kind: "image" | "text";
}
