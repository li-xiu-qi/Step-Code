import type { Message } from "@step-harness/providers";
import { describe, expect, it } from "vitest";
import { serializeConversation } from "../src/core/compaction/utils.ts";

function history(swapped = false): Message[] {
	return [
		{ role: "user", content: "Identify which parser still fails.", timestamp: 1 },
		{
			role: "assistant",
			api: "openai-responses",
			provider: "test",
			model: "test-model",
			stopReason: "toolUse",
			timestamp: 2,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			content: [
				{ type: "toolCall", id: "call_a|fc_a", name: "run_command", arguments: { command: "check parser_a" } },
				{ type: "toolCall", id: "call_b|fc_b", name: "run_command", arguments: { command: "check parser_b" } },
			],
		},
		{
			role: "toolResult",
			toolCallId: swapped ? "call_b|fc_b" : "call_a|fc_a",
			toolName: "run_command",
			content: [{ type: "text", text: "PASS" }],
			isError: false,
			timestamp: 3,
		},
		{
			role: "toolResult",
			toolCallId: swapped ? "call_a|fc_a" : "call_b|fc_b",
			toolName: "run_command",
			content: [{ type: "text", text: "FAIL: invariant broken" }],
			isError: true,
			timestamp: 4,
		},
	];
}

describe("summary tool-result attribution", () => {
	it("distinguishes which command passed when results arrive out of order", () => {
		expect(serializeConversation(history())).not.toBe(serializeConversation(history(true)));
	});

	it("distinguishes success from failure with identical output text", () => {
		const original = history();
		const failed = structuredClone(original);
		const result = failed[2];
		if (result.role !== "toolResult") throw new Error("Expected tool result");
		result.isError = true;
		expect(serializeConversation(original)).not.toBe(serializeConversation(failed));
	});

	it("retains IDs on calls and their matching results without rewriting history", () => {
		const messages = history(true);
		const original = structuredClone(messages);
		const text = serializeConversation(messages);
		for (const id of ["call_a|fc_a", "call_b|fc_b"]) {
			expect(text.split(id)).toHaveLength(3);
		}
		expect(text).toContain('[Tool result call_id="call_b|fc_b" name="run_command" isError=false]: PASS');
		expect(text).toContain('[Tool result call_id="call_a|fc_a" name="run_command" isError=true]: FAIL');
		expect(messages).toEqual(original);
	});

	it.each([false, true])("retains an empty result with isError=%s", (isError) => {
		const result: Message = {
			role: "toolResult",
			toolCallId: "empty",
			toolName: "run_command",
			content: [],
			isError,
			timestamp: 1,
		};
		expect(serializeConversation([result])).toBe(
			`[Tool result call_id="empty" name="run_command" isError=${isError}]:`,
		);
	});

	it("escapes metadata separately from the truncated result body", () => {
		const id = 'call_"quoted"\nnext';
		const messages: Message[] = [
			{
				role: "toolResult",
				toolCallId: id,
				toolName: "read_file",
				content: [{ type: "text", text: "x".repeat(5000) }],
				isError: true,
				timestamp: 1,
			},
		];
		const text = serializeConversation(messages);
		expect(text).toContain(`call_id=${JSON.stringify(id)} name="read_file" isError=true`);
		expect(text).toContain("chars omitted");
		expect(text.endsWith("x".repeat(800))).toBe(true);
	});
});
