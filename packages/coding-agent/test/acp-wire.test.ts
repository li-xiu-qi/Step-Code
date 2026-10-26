import { describe, expect, test } from "vitest";
import type { AgentSessionEvent } from "../src/core/agent-session.ts";
import {
	mapAssistantEventToSessionUpdate,
	normalizePrompt,
	parseJsonRpcLine,
	parseRequestPermissionResult,
	toSessionNotification,
	validateInitializeParams,
	validateLoadSessionParams,
	validateNewSessionParams,
	validatePromptParams,
} from "../src/modes/acp/acp-wire.ts";

describe("acp wire parsing", () => {
	test("parses a JSON-RPC request", () => {
		const parsed = parseJsonRpcLine('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1}}');
		expect(parsed.error).toBeUndefined();
		expect(parsed.request).toEqual({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: { protocolVersion: 1 },
		});
	});

	test("parses a JSON-RPC response without treating it as a request", () => {
		const parsed = parseJsonRpcLine('{"jsonrpc":"2.0","id":"abc","result":{"outcome":{"outcome":"cancelled"}}}');
		expect(parsed.error).toBeUndefined();
		expect(parsed.request).toBeUndefined();
		expect(parsed.response).toEqual({
			jsonrpc: "2.0",
			id: "abc",
			result: { outcome: { outcome: "cancelled" } },
		});
	});

	test("reports invalid JSON", () => {
		expect(parseJsonRpcLine("{").error).toMatchObject({ code: -32700 });
	});
});

describe("acp parameter validation", () => {
	test("accepts initialize params", () => {
		expect(validateInitializeParams({ protocolVersion: 1 }).ok).toBe(true);
		expect(validateInitializeParams({}).ok).toBe(false);
	});

	test("requires an absolute cwd for session lifecycle requests", () => {
		expect(validateNewSessionParams({ cwd: "/repo", mcpServers: [] }).ok).toBe(true);
		expect(validateNewSessionParams({ cwd: "repo", mcpServers: [] }).ok).toBe(false);
		expect(validateLoadSessionParams({ sessionId: "s1", cwd: "/repo", mcpServers: [] }).ok).toBe(true);
		expect(validateLoadSessionParams({ sessionId: "s1", cwd: "repo", mcpServers: [] }).ok).toBe(false);
	});

	test("accepts baseline prompt content and rejects unsupported blocks", () => {
		const valid = validatePromptParams({
			sessionId: "s1",
			prompt: [
				{ type: "text", text: "hello" },
				{ type: "resource_link", name: "file", uri: "file:///repo/file" },
				{ type: "image", data: "abc", mimeType: "image/png" },
			],
		});
		expect(valid.ok).toBe(true);
		expect(validatePromptParams({ sessionId: "s1", prompt: [{ type: "audio" }] }).ok).toBe(false);
	});
});

describe("acp prompt normalization", () => {
	test("joins text and resource links and keeps images", () => {
		const normalized = normalizePrompt([
			{ type: "text", text: "first" },
			{ type: "resource_link", name: "file", uri: "file:///repo/file" },
			{ type: "text", text: "second" },
			{ type: "image", data: "abc", mimeType: "image/png" },
		]);
		expect(normalized.text).toBe("first\n[[file]](file:///repo/file)\nsecond");
		expect(normalized.images).toEqual([{ type: "image", data: "abc", mimeType: "image/png" }]);
	});
});

describe("acp session updates", () => {
	test("maps streamed text and thinking deltas", () => {
		const textEvent = {
			type: "message_update",
			message: { role: "assistant", content: [] },
			assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "hello", partial: {} },
		} as unknown as AgentSessionEvent;
		expect(mapAssistantEventToSessionUpdate(textEvent)).toEqual({
			sessionUpdate: "agent_message_chunk",
			content: { type: "text", text: "hello" },
		});

		const thinkingEvent = {
			type: "message_update",
			message: { role: "assistant", content: [] },
			assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "think", partial: {} },
		} as unknown as AgentSessionEvent;
		expect(mapAssistantEventToSessionUpdate(thinkingEvent)).toEqual({
			sessionUpdate: "agent_thought_chunk",
			content: { type: "text", text: "think" },
		});
	});

	test("maps tool execution lifecycle and redacts obvious secrets", () => {
		const start = {
			type: "tool_execution_start",
			toolCallId: "call-1",
			toolName: "bash",
			args: { command: "echo hi", apiToken: "secret" },
		} as unknown as AgentSessionEvent;
		expect(mapAssistantEventToSessionUpdate(start)).toEqual({
			sessionUpdate: "tool_call",
			toolCallId: "call-1",
			title: "bash echo hi",
			name: "bash",
			kind: "execute",
			status: "pending",
			content: [],
			rawInput: { command: "echo hi", apiToken: "[redacted]" },
		});

		const end = {
			type: "tool_execution_end",
			toolCallId: "call-1",
			toolName: "bash",
			result: "boom",
			isError: true,
		} as unknown as AgentSessionEvent;
		expect(mapAssistantEventToSessionUpdate(end)).toEqual({
			sessionUpdate: "tool_call_update",
			toolCallId: "call-1",
			status: "failed",
			rawOutput: { error: "boom" },
		});
	});

	test("wraps updates in a session notification", () => {
		const event = {
			type: "tool_execution_start",
			toolCallId: "call-1",
			toolName: "read",
			args: { path: "/repo/file" },
		} as unknown as AgentSessionEvent;
		expect(toSessionNotification("session-1", event)).toEqual({
			sessionId: "session-1",
			update: {
				sessionUpdate: "tool_call",
				toolCallId: "call-1",
				title: "read /repo/file",
				name: "read",
				kind: "read",
				status: "pending",
				content: [],
				rawInput: { path: "/repo/file" },
			},
		});
	});
});

describe("acp permission results", () => {
	test("parses selected and cancelled outcomes", () => {
		expect(parseRequestPermissionResult({ outcome: { outcome: "cancelled" } })).toEqual({
			outcome: { outcome: "cancelled" },
		});
		expect(parseRequestPermissionResult({ outcome: { outcome: "selected", optionId: "allow_once" } })).toEqual({
			outcome: { outcome: "selected", optionId: "allow_once" },
		});
		expect(parseRequestPermissionResult({ outcome: {} })).toBeNull();
	});
});
