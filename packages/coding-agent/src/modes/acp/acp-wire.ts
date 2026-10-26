import { isAbsolute } from "node:path";
import type { ImageContent } from "@step-harness/providers";
import type { AgentSessionEvent } from "../../core/agent-session.ts";
import type {
	ContentBlock,
	JsonRpcError,
	JsonRpcId,
	JsonRpcRequest,
	JsonRpcResponse,
	JsonRpcResponseObject,
	PromptParams,
	RequestPermissionResult,
	SessionNotificationParams,
	SessionUpdate,
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
