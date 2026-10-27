import { isAbsolute } from "node:path";
import type { AgentMessage } from "@step-harness/agent-core";
import type { ImageContent } from "@step-harness/providers";
import type { AgentSessionEvent } from "../../core/agent-session.ts";
import type {
	AcpProtocolVersion,
	CloseSessionParams,
	ContentBlock,
	JsonRpcError,
	JsonRpcId,
	JsonRpcRequest,
	JsonRpcResponse,
	JsonRpcResponseObject,
	PromptParams,
	RequestPermissionResult,
	ResumeParams,
	SessionListParams,
	SessionNotificationParams,
	SessionNotificationParamsV2,
	SessionUpdate,
	SessionUpdateV2,
} from "./acp-types.ts";
import { ACP_JSON_RPC_ERRORS } from "./acp-types.ts";

export function serializeJsonLine(value: unknown): string {
	return `${JSON.stringify(value)}\n`;
}

export function createResponse(id: JsonRpcId | null, result: unknown): JsonRpcResponse {
	return { jsonrpc: "2.0", id, result };
}

export function createErrorResponse(
	id: JsonRpcId | null,
	code: number,
	message: string,
	data?: unknown,
): JsonRpcResponse {
	const error: JsonRpcError = { code, message };
	if (data !== undefined) {
		error.data = data;
	}
	return { jsonrpc: "2.0", id, error };
}

export function createNotification(
	method: string,
	params: unknown,
): { jsonrpc: "2.0"; method: string; params: unknown } {
	return { jsonrpc: "2.0", method, params };
}

export function parseJsonRpcLine(line: string): {
	request?: JsonRpcRequest;
	response?: JsonRpcResponseObject;
	error?: JsonRpcError;
} {
	let value: unknown;
	try {
		value = JSON.parse(line);
	} catch {
		return { error: { code: ACP_JSON_RPC_ERRORS.parse, message: "Invalid JSON" } };
	}
	if (!isRecord(value)) {
		return { error: { code: ACP_JSON_RPC_ERRORS.invalidRequest, message: "Not a JSON-RPC message" } };
	}
	const id = value.id;
	if (id !== undefined && typeof id !== "string" && typeof id !== "number") {
		return { error: { code: ACP_JSON_RPC_ERRORS.invalidRequest, message: "Invalid id" } };
	}
	if (value.jsonrpc !== undefined && value.jsonrpc !== "2.0") {
		return { error: { code: ACP_JSON_RPC_ERRORS.invalidRequest, message: "Unsupported JSON-RPC version" } };
	}

	if (typeof value.method === "string" && value.method.length > 0) {
		const request: JsonRpcRequest = { method: value.method, params: value.params };
		if (id !== undefined) request.id = id;
		if (value.jsonrpc !== undefined) request.jsonrpc = "2.0";
		return { request };
	}

	if (id !== undefined && ("result" in value || "error" in value)) {
		const response: JsonRpcResponseObject = { id };
		if ("result" in value) response.result = value.result;
		if ("error" in value) response.error = value.error as JsonRpcError;
		if (value.jsonrpc !== undefined) response.jsonrpc = "2.0";
		return { response };
	}

	return { error: { code: ACP_JSON_RPC_ERRORS.invalidRequest, message: "Not a JSON-RPC request or response" } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateInitializeParams(params: unknown): { ok: true } | { ok: false; message: string } {
	if (!isRecord(params)) {
		return { ok: false, message: "Initialize params must be an object" };
	}
	if (typeof params.protocolVersion !== "number") {
		return { ok: false, message: "protocolVersion must be a number" };
	}
	return { ok: true };
}

/**
 * Parse initialize for dual-version negotiation.
 *
 * v1 keeps the historical shape. v2 requires `info`; capabilities stay optional
 * so a minimal client can still negotiate the stable baseline.
 */
export function parseInitializeParams(
	params: unknown,
): { ok: true; requestedVersion: number } | { ok: false; message: string } {
	if (!isRecord(params)) {
		return { ok: false, message: "Initialize params must be an object" };
	}
	if (typeof params.protocolVersion !== "number" || !Number.isInteger(params.protocolVersion)) {
		return { ok: false, message: "protocolVersion must be an integer" };
	}
	const requestedVersion = params.protocolVersion;
	if (requestedVersion >= 2) {
		const info = params.info;
		if (!isRecord(info) || typeof info.name !== "string" || typeof info.version !== "string") {
			return { ok: false, message: "v2 initialize requires info.name and info.version" };
		}
	}
	return { ok: true, requestedVersion };
}

export function negotiateProtocolVersion(requestedVersion: number): AcpProtocolVersion {
	return requestedVersion >= 2 ? 2 : 1;
}

export function validateNewSessionParams(params: unknown): { ok: true; cwd: string } | { ok: false; message: string } {
	if (!isRecord(params)) {
		return { ok: false, message: "Session params must be an object" };
	}
	if (typeof params.cwd !== "string" || !params.cwd) {
		return { ok: false, message: "cwd is required" };
	}
	if (!isAbsolute(params.cwd)) {
		return { ok: false, message: "cwd must be an absolute path" };
	}
	return { ok: true, cwd: params.cwd };
}

export function validateLoadSessionParams(
	params: unknown,
): { ok: true; sessionId: string; cwd: string } | { ok: false; message: string } {
	if (!isRecord(params)) {
		return { ok: false, message: "Session params must be an object" };
	}
	if (typeof params.sessionId !== "string" || !params.sessionId) {
		return { ok: false, message: "sessionId is required" };
	}
	if (typeof params.cwd !== "string" || !params.cwd) {
		return { ok: false, message: "cwd is required" };
	}
	if (!isAbsolute(params.cwd)) {
		return { ok: false, message: "cwd must be an absolute path" };
	}
	return { ok: true, sessionId: params.sessionId, cwd: params.cwd };
}

export function validateResumeParams(
	params: unknown,
): { ok: true; value: ResumeParams } | { ok: false; message: string } {
	if (!isRecord(params)) {
		return { ok: false, message: "Resume params must be an object" };
	}
	if (typeof params.sessionId !== "string" || !params.sessionId) {
		return { ok: false, message: "sessionId is required" };
	}
	if (typeof params.cwd !== "string" || !params.cwd) {
		return { ok: false, message: "cwd is required" };
	}
	if (!isAbsolute(params.cwd)) {
		return { ok: false, message: "cwd must be an absolute path" };
	}
	if (params.mcpServers !== undefined && !Array.isArray(params.mcpServers)) {
		return { ok: false, message: "mcpServers must be an array" };
	}
	if (params.replayFrom !== undefined && params.replayFrom !== null) {
		if (!isRecord(params.replayFrom) || typeof params.replayFrom.type !== "string") {
			return { ok: false, message: "replayFrom must be an object with a type string" };
		}
	}
	if (params.additionalDirectories !== undefined) {
		if (
			!Array.isArray(params.additionalDirectories) ||
			params.additionalDirectories.some((entry) => typeof entry !== "string")
		) {
			return { ok: false, message: "additionalDirectories must be an array of strings" };
		}
	}
	return {
		ok: true,
		value: {
			sessionId: params.sessionId,
			cwd: params.cwd,
			...(params.mcpServers === undefined ? {} : { mcpServers: params.mcpServers }),
			...(params.replayFrom === undefined ? {} : { replayFrom: params.replayFrom as { type: string } | null }),
			...(params.additionalDirectories === undefined
				? {}
				: { additionalDirectories: params.additionalDirectories as string[] }),
		},
	};
}

export function validateCloseSessionParams(
	params: unknown,
): { ok: true; value: CloseSessionParams } | { ok: false; message: string } {
	if (!isRecord(params)) {
		return { ok: false, message: "Close params must be an object" };
	}
	if (typeof params.sessionId !== "string" || !params.sessionId) {
		return { ok: false, message: "sessionId is required" };
	}
	return { ok: true, value: { sessionId: params.sessionId } };
}

export function validateSessionListParams(
	params: unknown,
): { ok: true; value: SessionListParams } | { ok: false; message: string } {
	if (params === undefined) {
		return { ok: true, value: {} };
	}
	if (!isRecord(params)) {
		return { ok: false, message: "Session list params must be an object" };
	}
	if (params.cwd !== undefined && (typeof params.cwd !== "string" || !isAbsolute(params.cwd))) {
		return { ok: false, message: "cwd must be an absolute path" };
	}
	if (params.cursor !== undefined && typeof params.cursor !== "string") {
		return { ok: false, message: "cursor must be a string" };
	}
	return {
		ok: true,
		value: {
			...(params.cwd === undefined ? {} : { cwd: params.cwd as string }),
			...(params.cursor === undefined ? {} : { cursor: params.cursor as string }),
		},
	};
}

/** Non-empty MCP server lists are rejected until ACP MCP passthrough lands. */
export function hasUnsupportedMcpServers(params: unknown): boolean {
	return isRecord(params) && Array.isArray(params.mcpServers) && params.mcpServers.length > 0;
}

export function validatePromptParams(
	params: unknown,
): { ok: true; value: PromptParams } | { ok: false; message: string } {
	if (!isRecord(params)) {
		return { ok: false, message: "Prompt params must be an object" };
	}
	if (typeof params.sessionId !== "string" || !params.sessionId) {
		return { ok: false, message: "sessionId is required" };
	}
	if (!Array.isArray(params.prompt)) {
		return { ok: false, message: "prompt must be an array" };
	}
	const prompt: ContentBlock[] = [];
	for (const block of params.prompt) {
		if (!isRecord(block)) {
			return { ok: false, message: "prompt block must be an object" };
		}
		const type = block.type;
		if (type === "text" && typeof block.text === "string") {
			prompt.push({ type: "text", text: block.text });
			continue;
		}
		if (type === "image" && typeof block.data === "string" && typeof block.mimeType === "string") {
			prompt.push({ type: "image", data: block.data, mimeType: block.mimeType });
			continue;
		}
		if (type === "resource_link" && typeof block.name === "string" && typeof block.uri === "string") {
			prompt.push({ type: "resource_link", name: block.name, uri: block.uri });
			continue;
		}
		return { ok: false, message: "Unsupported prompt content block" };
	}
	return { ok: true, value: { sessionId: params.sessionId, prompt } };
}

export function normalizePrompt(prompt: ContentBlock[]): { text: string; images: ImageContent[] } {
	const textParts: string[] = [];
	const images: ImageContent[] = [];
	for (const block of prompt) {
		if (block.type === "text") {
			textParts.push(block.text);
			continue;
		}
		if (block.type === "image") {
			images.push({ type: "image", data: block.data, mimeType: block.mimeType });
			continue;
		}
		textParts.push(`[[${block.name}]](${block.uri})`);
	}
	return { text: textParts.join("\n"), images };
}

export function parseRequestPermissionResult(value: unknown): RequestPermissionResult | null {
	if (!isRecord(value) || !isRecord(value.outcome)) return null;
	const outcome = value.outcome;
	if (outcome.outcome === "cancelled") {
		return { outcome: { outcome: "cancelled" } };
	}
	if (outcome.outcome === "selected" && typeof outcome.optionId === "string") {
		return { outcome: { outcome: "selected", optionId: outcome.optionId } };
	}
	return null;
}

export function mapAssistantEventToSessionUpdate(event: AgentSessionEvent): SessionUpdate | null {
	if (event.type === "message_update") {
		const assistantEvent = event.assistantMessageEvent;
		if (assistantEvent.type === "text_delta" && assistantEvent.delta.length > 0) {
			return {
				sessionUpdate: "agent_message_chunk",
				content: { type: "text", text: assistantEvent.delta },
			};
		}
		if (assistantEvent.type === "thinking_delta" && assistantEvent.delta.length > 0) {
			return {
				sessionUpdate: "agent_thought_chunk",
				content: { type: "text", text: assistantEvent.delta },
			};
		}
		return null;
	}
	if (event.type === "tool_execution_start") {
		return {
			sessionUpdate: "tool_call",
			toolCallId: event.toolCallId,
			title: buildToolTitle(event.toolName, event.args),
			name: event.toolName,
			kind: mapToolKind(event.toolName),
			status: "pending",
			content: [],
			rawInput: sanitizeToolInput(event.args),
		};
	}
	if (event.type === "tool_execution_end") {
		const update: SessionUpdate = {
			sessionUpdate: "tool_call_update",
			toolCallId: event.toolCallId,
			status: event.isError ? "failed" : "completed",
		};
		if (event.isError) {
			update.rawOutput = { error: stringifyToolOutput(event.result) };
		}
		return update;
	}
	return null;
}

export function toSessionNotification(sessionId: string, event: AgentSessionEvent): SessionNotificationParams | null {
	const update = mapAssistantEventToSessionUpdate(event);
	if (!update) return null;
	return { sessionId, update };
}

function ensureMessageId(
	message: AgentMessage,
	messageIds: WeakMap<AgentMessage, string>,
	createId: () => string,
): string {
	const existing = messageIds.get(message);
	if (existing) return existing;
	const id = createId();
	messageIds.set(message, id);
	return id;
}

export function mapSessionEventToSessionUpdateV2(
	event: AgentSessionEvent,
	messageIds: WeakMap<AgentMessage, string>,
	createId: () => string,
): SessionUpdateV2 | null {
	if (event.type === "message_update") {
		const message = event.message;
		if (message.role !== "assistant") return null;
		const messageId = ensureMessageId(message, messageIds, createId);
		const assistantEvent = event.assistantMessageEvent;
		if (assistantEvent.type === "text_delta" && assistantEvent.delta.length > 0) {
			return {
				sessionUpdate: "agent_message_chunk",
				messageId,
				content: { type: "text", text: assistantEvent.delta },
			};
		}
		if (assistantEvent.type === "thinking_delta" && assistantEvent.delta.length > 0) {
			return {
				sessionUpdate: "agent_thought_chunk",
				messageId,
				content: { type: "text", text: assistantEvent.delta },
			};
		}
		return null;
	}
	if (event.type === "tool_execution_start") {
		return {
			sessionUpdate: "tool_call_update",
			toolCallId: event.toolCallId,
			title: buildToolTitle(event.toolName, event.args),
			name: event.toolName,
			kind: mapToolKind(event.toolName),
			status: "pending",
			content: [],
			rawInput: sanitizeToolInput(event.args),
		};
	}
	if (event.type === "tool_execution_update") {
		return {
			sessionUpdate: "tool_call_update",
			toolCallId: event.toolCallId,
			status: "in_progress",
			rawOutput: sanitizeToolInput(event.partialResult),
		};
	}
	if (event.type === "tool_execution_end") {
		const update: SessionUpdateV2 = {
			sessionUpdate: "tool_call_update",
			toolCallId: event.toolCallId,
			status: event.isError ? "failed" : "completed",
			rawOutput: stringifyToolOutput(event.result),
		};
		return update;
	}
	return null;
}

export function toSessionNotificationV2(
	sessionId: string,
	event: AgentSessionEvent,
	messageIds: WeakMap<AgentMessage, string>,
	createId: () => string,
): SessionNotificationParamsV2 | null {
	const update = mapSessionEventToSessionUpdateV2(event, messageIds, createId);
	if (!update) return null;
	return { sessionId, update };
}

function stringifyToolOutput(value: unknown): unknown {
	if (value === undefined || value === null) return null;
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value) ?? String(value);
	} catch {
		return String(value);
	}
}

function buildToolTitle(name: string, input: unknown): string {
	if (!name) return "tool";
	if (!isRecord(input)) return name;
	const target = input.path ?? input.file ?? input.filePath ?? input.command ?? input.query ?? input.url;
	if (typeof target === "string" && target.length > 0 && target.length <= 120) {
		return `${name} ${target}`;
	}
	return name;
}

function sanitizeToolInput(input: unknown): unknown {
	if (!isRecord(input)) return input;
	const sanitized: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(input)) {
		const lowered = key.toLowerCase();
		if (lowered.includes("token") || lowered.includes("secret") || lowered.includes("password")) {
			sanitized[key] = "[redacted]";
			continue;
		}
		sanitized[key] = value;
	}
	return sanitized;
}

function mapToolKind(name: string): string {
	switch (name) {
		case "bash":
			return "execute";
		case "read":
			return "read";
		case "write":
			return "edit";
		case "edit":
			return "edit";
		case "glob":
			return "search";
		case "grep":
			return "search";
		case "web_search":
			return "fetch";
		case "web_fetch":
			return "fetch";
		default:
			return "other";
	}
}
