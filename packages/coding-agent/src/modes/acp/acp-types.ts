/** Minimal ACP v1 wire types used by the native stdio mode. */

export type JsonRpcId = string | number;

export interface JsonRpcRequest {
	jsonrpc?: "2.0";
	id?: JsonRpcId;
	method: string;
	params?: unknown;
}

export interface JsonRpcError {
	code: number;
	message: string;
	data?: unknown;
}

export interface JsonRpcResponse {
	jsonrpc: "2.0";
	id: JsonRpcId | null;
	result?: unknown;
	error?: JsonRpcError;
}

export interface JsonRpcResponseObject {
	jsonrpc?: "2.0";
	id: JsonRpcId | null;
	result?: unknown;
	error?: JsonRpcError;
}

export interface JsonRpcNotification {
	jsonrpc: "2.0";
	method: string;
	params?: unknown;
}

export interface TextContentBlock {
	type: "text";
	text: string;
}

export interface ImageContentBlock {
	type: "image";
	data: string;
	mimeType: string;
}

export interface ResourceLinkContentBlock {
	type: "resource_link";
	name: string;
	uri: string;
}

export type ContentBlock = TextContentBlock | ImageContentBlock | ResourceLinkContentBlock;

export interface InitializeParams {
	protocolVersion: number;
	clientCapabilities?: {
		fs?: { readTextFile?: boolean; writeTextFile?: boolean };
		terminal?: boolean;
		auth?: { terminal?: boolean };
	};
	clientInfo?: { name: string; version: string; title?: string };
}

export interface NewSessionParams {
	cwd: string;
	mcpServers: unknown[];
	additionalDirectories?: string[];
}

export interface LoadSessionParams {
	sessionId: string;
	cwd: string;
	mcpServers: unknown[];
	additionalDirectories?: string[];
}

export interface PromptParams {
	sessionId: string;
	prompt: ContentBlock[];
}

export interface SessionUpdateTextChunk {
	sessionUpdate: "agent_message_chunk" | "agent_thought_chunk";
	content: ContentBlock;
}

export interface SessionUpdateToolCall {
	sessionUpdate: "tool_call";
	toolCallId: string;
	title: string;
	name?: string | null;
	kind?: string;
	status?: "pending" | "in_progress" | "completed" | "failed";
	content?: unknown[];
	rawInput?: unknown;
}

export interface SessionUpdateToolCallUpdate {
	sessionUpdate: "tool_call_update";
	toolCallId: string;
	title?: string | null;
	status?: "pending" | "in_progress" | "completed" | "failed";
	content?: unknown[] | null;
	rawInput?: unknown;
	rawOutput?: unknown;
}

export type SessionUpdate = SessionUpdateTextChunk | SessionUpdateToolCall | SessionUpdateToolCallUpdate;

export interface SessionNotificationParams {
	sessionId: string;
	update: SessionUpdate;
}

export interface RequestPermissionParams {
	sessionId: string;
	toolCall: {
		toolCallId: string;
		title: string;
		status?: "pending" | "in_progress" | "completed" | "failed";
		content?: unknown[];
	};
	options: Array<{ optionId: string; name: string; kind: string }>;
}

export type RequestPermissionResult =
	| { outcome: { outcome: "cancelled" } }
	| { outcome: { outcome: "selected"; optionId: string } };

export const ACP_PROTOCOL_VERSION = 1;

export const ACP_JSON_RPC_ERRORS = {
	parse: -32700,
	invalidRequest: -32600,
	methodNotFound: -32601,
	invalidParams: -32602,
	internal: -32603,
	notInitialized: -32002,
	unavailable: -32003,
} as const;
