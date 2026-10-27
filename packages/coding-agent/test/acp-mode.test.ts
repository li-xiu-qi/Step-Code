import { PassThrough } from "node:stream";
import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { AgentSessionEvent } from "../src/core/agent-session.ts";
import type { AgentSessionRuntimeHost } from "../src/core/agent-session-runtime.ts";
import type { ExtensionUIContext } from "../src/core/extensions/index.ts";
import { restoreStdout } from "../src/core/output-guard.ts";
import { runAcpMode } from "../src/modes/acp/acp-mode.ts";

type PromptOptions = {
	preflightResult?: (success: boolean) => void;
};

type FakeSession = {
	sessionId: string;
	agent: { subscribe: () => () => void };
	subscribe: (listener: (event: AgentSessionEvent) => void) => () => void;
	bindExtensions: (bindings: { uiContext?: ExtensionUIContext }) => Promise<void>;
	prompt: Mock<(text: string, options?: PromptOptions) => Promise<void>>;
	abort: Mock<() => Promise<void>>;
	waitForIdle: Mock<() => Promise<void>>;
	navigateTree: Mock<() => Promise<{ cancelled: boolean }>>;
	reload: Mock<() => Promise<void>>;
};

type InitializeResult = {
	protocolVersion: number;
	agentCapabilities: { promptCapabilities: { image: boolean } };
};

type InitializeResultV2 = {
	protocolVersion: number;
	info: { name: string; version: string };
	capabilities: { session: { prompt: { image: Record<string, never> } } };
};

type PermissionParams = {
	sessionId: string;
	toolCall: { title: string };
};

type PromptResultV2 = {
	messageId: string;
};

type SessionUpdate = Record<string, unknown>;

let stdin: PassThrough;
let captured: string[];
let stdoutSpy: Mock<(chunk: unknown, encodingOrCallback?: unknown, callback?: unknown) => boolean>;
let originalStdoutWrite: typeof process.stdout.write;
let originalStdin: typeof process.stdin;

function createSession() {
	let uiContext: ExtensionUIContext | undefined;
	const sessionListeners: Array<(event: AgentSessionEvent) => void> = [];
	const session: FakeSession = {
		sessionId: "session-1",
		agent: { subscribe: vi.fn(() => () => {}) },
		subscribe: vi.fn((listener: (event: AgentSessionEvent) => void) => {
			sessionListeners.push(listener);
			return () => {
				const index = sessionListeners.indexOf(listener);
				if (index >= 0) sessionListeners.splice(index, 1);
			};
		}),
		bindExtensions: vi.fn(async (bindings) => {
			uiContext = bindings.uiContext;
		}),
		prompt: vi.fn(async () => {}),
		abort: vi.fn(async () => {}),
		waitForIdle: vi.fn(async () => {}),
		navigateTree: vi.fn(async () => ({ cancelled: false })),
		reload: vi.fn(async () => {}),
	};
	return {
		session,
		getUIContext: () => uiContext,
		emitSession: (event: AgentSessionEvent) => {
			for (const listener of [...sessionListeners]) {
				listener(event);
			}
		},
	};
}

function createHost(session: FakeSession): AgentSessionRuntimeHost {
	return {
		session,
		cwd: process.cwd(),
		setRebindSession: vi.fn(),
		onSessionChange: vi.fn(() => () => {}),
		setBeforeSessionInvalidate: vi.fn(),
		switchSession: vi.fn(async () => ({ cancelled: false })),
		newSession: vi.fn(async () => ({ cancelled: false })),
		fork: vi.fn(async () => ({ cancelled: false })),
		importFromJsonl: vi.fn(async () => ({ cancelled: false })),
		dispose: vi.fn(async () => {}),
	} as unknown as AgentSessionRuntimeHost;
}

function send(value: unknown): void {
	stdin.write(`${JSON.stringify(value)}\n`);
}

function parsedLines(): Record<string, unknown>[] {
	const buffer = captured.join("");
	return buffer
		.split("\n")
		.slice(0, -1)
		.filter((line) => line.length > 0)
		.map((line) => {
			try {
				return JSON.parse(line) as Record<string, unknown>;
			} catch {
				return {};
			}
		});
}

async function waitForLine(predicate: (line: Record<string, unknown>) => boolean): Promise<Record<string, unknown>> {
	return vi.waitFor(
		() => {
			const line = parsedLines().find(predicate);
			if (!line) {
				throw new Error("expected JSON-RPC line not found");
			}
			return line;
		},
		{ timeout: 5000, interval: 5 },
	);
}

async function waitForResponse(id: string | number): Promise<Record<string, unknown>> {
	const line = await waitForLine(
		(candidate) => candidate.id === id && ("result" in candidate || "error" in candidate),
	);
	if (line.error) {
		throw new Error(`JSON-RPC error for ${String(id)}: ${JSON.stringify(line.error)}`);
	}
	return line.result as Record<string, unknown>;
}

beforeEach(() => {
	stdin = new PassThrough();
	captured = [];
	originalStdin = process.stdin;
	Object.defineProperty(process, "stdin", {
		value: stdin,
		configurable: true,
	});
	originalStdoutWrite = process.stdout.write;
	stdoutSpy = vi.fn((chunk: unknown, encodingOrCallback?: unknown, callback?: unknown) => {
		captured.push(String(chunk));
		const done = typeof encodingOrCallback === "function" ? encodingOrCallback : callback;
		if (typeof done === "function") {
			(done as (error?: Error | null) => void)(null);
		}
		return true;
	});
	process.stdout.write = stdoutSpy as unknown as typeof process.stdout.write;
});

afterEach(() => {
	restoreStdout();
	process.stdout.write = originalStdoutWrite;
	stdin.destroy();
	Object.defineProperty(process, "stdin", {
		value: originalStdin,
		configurable: true,
	});
});

describe("acp mode", () => {
	test("streams a prompt turn and resolves a permission request without blocking stdin", async () => {
		const { session, getUIContext } = createSession();
		const host = createHost(session);
		let releasePrompt = () => {};
		const promptDone = new Promise<void>((resolve) => {
			releasePrompt = resolve;
		});
		session.prompt.mockImplementation(async () => {
			const approved = await getUIContext()?.confirm("Approve?", "run bash");
			if (!approved) {
				throw new Error("permission rejected");
			}
			await promptDone;
		});

		void runAcpMode(host);
		send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 1 } });
		const initialized = (await waitForResponse(1)) as unknown as InitializeResult;
		expect(initialized.protocolVersion).toBe(1);
		expect(initialized.agentCapabilities.promptCapabilities.image).toBe(true);

		send({
			jsonrpc: "2.0",
			id: 2,
			method: "session/prompt",
			params: { sessionId: "session-1", prompt: [{ type: "text", text: "hello" }] },
		});
		const permission = await waitForLine((line) => line.method === "session/request_permission");
		const permissionId = permission.id;
		expect(permissionId).toBeTypeOf("string");
		expect((permission.params as PermissionParams).toolCall.title).toBe("Approve?");
		send({
			jsonrpc: "2.0",
			id: permissionId,
			result: { outcome: { outcome: "selected", optionId: "allow_once" } },
		});
		releasePrompt();
		const result = await waitForResponse(2);
		expect(result.stopReason).toBe("end_turn");
	});

	test("cancels an active prompt turn", async () => {
		const { session } = createSession();
		const host = createHost(session);
		let rejectPrompt: (error: Error) => void = () => {};
		session.prompt.mockImplementation(
			() =>
				new Promise<void>((_resolve, reject) => {
					rejectPrompt = reject;
				}),
		);
		session.abort.mockImplementation(async () => {
			rejectPrompt(new Error("aborted"));
		});

		void runAcpMode(host);
		send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 1 } });
		await waitForResponse(1);

		send({
			jsonrpc: "2.0",
			id: 3,
			method: "session/prompt",
			params: { sessionId: "session-1", prompt: [{ type: "text", text: "hello" }] },
		});
		await vi.waitFor(() => {
			expect(session.prompt).toHaveBeenCalledTimes(1);
		});
		send({ jsonrpc: "2.0", method: "session/cancel" });
		const result = await waitForResponse(3);
		expect(result.stopReason).toBe("cancelled");
		expect(session.abort).toHaveBeenCalledTimes(1);
	});

	test("negotiates the v2 baseline and answers prompts with a messageId", async () => {
		const { session } = createSession();
		const host = createHost(session);

		void runAcpMode(host);
		send({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: { protocolVersion: 2, info: { name: "test-client", version: "1.0.0" } },
		});
		const initialized = (await waitForResponse(1)) as unknown as InitializeResultV2;
		expect(initialized.protocolVersion).toBe(2);
		expect(initialized.info.name).toBe("Step Code");
		expect(initialized.capabilities.session.prompt.image).toEqual({});

		send({
			jsonrpc: "2.0",
			id: 9,
			method: "session/prompt",
			params: { sessionId: "session-1", prompt: [{ type: "text", text: "hello" }] },
		});
		const result = (await waitForResponse(9)) as unknown as PromptResultV2;
		expect(result.messageId).toBeTypeOf("string");
		expect(session.prompt).toHaveBeenCalledWith("hello", expect.objectContaining({ source: "acp" }));
	});

	test("rejects v2 initialize without client info", async () => {
		const { session } = createSession();
		const host = createHost(session);

		void runAcpMode(host);
		send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 2 } });
		await expect(waitForResponse(1)).rejects.toThrow(/JSON-RPC error/);
		expect(session.prompt).not.toHaveBeenCalled();
	});

	test("rejects requests that arrive before initialize", async () => {
		const { session } = createSession();
		const host = createHost(session);

		void runAcpMode(host);
		send({ jsonrpc: "2.0", id: 1, method: "session/prompt", params: { sessionId: "session-1", prompt: [] } });
		await expect(waitForResponse(1)).rejects.toThrow(/-32002/);
		expect(session.prompt).not.toHaveBeenCalled();
	});

	test("keeps v1-only and v2-only methods behind the negotiated version", async () => {
		const { session } = createSession();
		const host = createHost(session);

		void runAcpMode(host);
		send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 1 } });
		await waitForResponse(1);

		send({ jsonrpc: "2.0", id: 2, method: "session/resume", params: { sessionId: "session-1", cwd: process.cwd() } });
		await expect(waitForResponse(2)).rejects.toThrow(/-32601/);

		send({ jsonrpc: "2.0", id: 3, method: "session/list", params: {} });
		await expect(waitForResponse(3)).rejects.toThrow(/-32601/);

		send({ jsonrpc: "2.0", id: 4, method: "session/close", params: { sessionId: "session-1" } });
		await expect(waitForResponse(4)).rejects.toThrow(/-32601/);
		expect(session.abort).not.toHaveBeenCalled();
	});

	test("routes v2 clients to session/resume, session/list, and session/close", async () => {
		const { session } = createSession();
		const host = createHost(session);

		void runAcpMode(host);
		send({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: { protocolVersion: 2, info: { name: "test-client", version: "1.0.0" } },
		});
		await waitForResponse(1);

		send({ jsonrpc: "2.0", id: 2, method: "session/load", params: { sessionId: "session-1", cwd: process.cwd() } });
		await expect(waitForResponse(2)).rejects.toThrow(/-32601/);

		send({
			jsonrpc: "2.0",
			id: 3,
			method: "session/new",
			params: { cwd: process.cwd(), mcpServers: [{ name: "extra" }] },
		});
		await expect(waitForResponse(3)).rejects.toThrow(/-32602/);

		send({ jsonrpc: "2.0", id: 4, method: "session/close", params: { sessionId: "session-1" } });
		expect(await waitForResponse(4)).toEqual({});
		expect(session.abort).toHaveBeenCalledTimes(1);

		send({ jsonrpc: "2.0", id: 5, method: "session/close", params: { sessionId: "other-session" } });
		await expect(waitForResponse(5)).rejects.toThrow(/-32602/);
	});
});

describe("session event mapping", () => {
	function sessionUpdates(): Array<{ notification: Record<string, unknown>; update: SessionUpdate }> {
		return parsedLines()
			.filter((line) => line.method === "session/update")
			.map((line) => ({
				notification: line,
				update: (line.params as { update?: SessionUpdate } | undefined)?.update as SessionUpdate,
			}))
			.filter((entry) => entry.update !== undefined);
	}

	function updateTypes(): string[] {
		return sessionUpdates().map((entry) => String(entry.update.sessionUpdate));
	}

	function textDelta(
		delta: string,
		message: Record<string, unknown> = { role: "assistant", content: [] },
	): AgentSessionEvent {
		return {
			type: "message_update",
			message,
			assistantMessageEvent: { type: "text_delta", delta },
		} as unknown as AgentSessionEvent;
	}

	function thinkingDelta(delta: string): AgentSessionEvent {
		return {
			type: "message_update",
			message: { role: "assistant", content: [] },
			assistantMessageEvent: { type: "thinking_delta", delta },
		} as unknown as AgentSessionEvent;
	}

	function toolStart(toolCallId: string, toolName: string, args: unknown): AgentSessionEvent {
		return { type: "tool_execution_start", toolCallId, toolName, args } as unknown as AgentSessionEvent;
	}

	function toolUpdate(toolCallId: string, partialResult: unknown): AgentSessionEvent {
		return {
			type: "tool_execution_update",
			toolCallId,
			toolName: "bash",
			args: {},
			partialResult,
		} as unknown as AgentSessionEvent;
	}

	function toolEnd(toolCallId: string, result: unknown, isError: boolean): AgentSessionEvent {
		return {
			type: "tool_execution_end",
			toolCallId,
			toolName: "bash",
			args: {},
			result,
			isError,
		} as unknown as AgentSessionEvent;
	}

	async function runTurn(options: {
		script: (emit: (event: AgentSessionEvent) => void) => void;
		protocolVersion?: number;
		id?: number;
	}) {
		const { session, emitSession } = createSession();
		session.prompt.mockImplementation(async () => {
			options.script(emitSession);
		});
		const host = createHost(session);
		void runAcpMode(host);
		const initializeParams: Record<string, unknown> = { protocolVersion: options.protocolVersion ?? 1 };
		if (options.protocolVersion === 2) {
			initializeParams.info = { name: "test-client", version: "1.0.0" };
		}
		send({ jsonrpc: "2.0", id: 1, method: "initialize", params: initializeParams });
		await waitForResponse(1);
		const id = options.id ?? 6;
		send({
			jsonrpc: "2.0",
			id,
			method: "session/prompt",
			params: { sessionId: "session-1", prompt: [{ type: "text", text: "hello" }] },
		});
		const result = await waitForResponse(id);
		return { session, emitSession, result, updates: sessionUpdates() };
	}

	test("streams assistant text deltas as append-only message chunks", async () => {
		const { result, updates } = await runTurn({
			script: (emit) => {
				emit(textDelta("Hel"));
				emit(thinkingDelta("let me think"));
				emit(textDelta("lo"));
			},
		});

		expect(updates.map((entry) => entry.update)).toEqual([
			{ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hel" } },
			{ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "let me think" } },
			{ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "lo" } },
		]);
		expect(
			updates.every((entry) => (entry.notification.params as { sessionId?: string })?.sessionId === "session-1"),
		).toBe(true);
		expect(result).toEqual({ stopReason: "end_turn" });
	});

	test("ignores empty deltas", async () => {
		const { result } = await runTurn({
			script: (emit) => {
				emit(textDelta(""));
				emit(thinkingDelta(""));
			},
		});

		expect(updateTypes()).toEqual([]);
		expect(result).toEqual({ stopReason: "end_turn" });
	});

	test("maps tool execution start to a pending tool_call with sanitized input", async () => {
		const { updates } = await runTurn({
			script: (emit) => {
				emit(toolStart("call-1", "bash", { command: "ls -la", apiToken: "sk-secret" }));
			},
		});

		expect(updates.map((entry) => entry.update)).toEqual([
			{
				sessionUpdate: "tool_call",
				toolCallId: "call-1",
				title: "bash ls -la",
				name: "bash",
				kind: "execute",
				status: "pending",
				content: [],
				rawInput: { command: "ls -la", apiToken: "[redacted]" },
			},
		]);
	});

	test("maps successful and failed tool execution ends", async () => {
		const { updates } = await runTurn({
			script: (emit) => {
				emit(toolStart("call-1", "bash", { command: "ls" }));
				emit(toolEnd("call-1", "total 0", false));
				emit(toolStart("call-2", "bash", { command: "rm -rf /" }));
				emit(toolEnd("call-2", "permission denied", true));
			},
		});

		const toolUpdates = updates
			.map((entry) => entry.update)
			.filter((update) => update.sessionUpdate === "tool_call_update");
		expect(toolUpdates).toEqual([
			{ sessionUpdate: "tool_call_update", toolCallId: "call-1", status: "completed" },
			{
				sessionUpdate: "tool_call_update",
				toolCallId: "call-2",
				status: "failed",
				rawOutput: { error: "permission denied" },
			},
		]);
	});

	test("drops partial tool output under v1", async () => {
		await runTurn({
			script: (emit) => {
				emit(toolStart("call-1", "bash", { command: "ls" }));
				emit(toolUpdate("call-1", "partial output"));
			},
		});

		expect(updateTypes()).toEqual(["tool_call"]);
	});

	test("ignores non-assistant message updates under v2", async () => {
		const { updates } = await runTurn({
			protocolVersion: 2,
			script: (emit) => {
				emit(textDelta("user text", { role: "user", content: [] }));
			},
		});

		expect(updates.filter((entry) => entry.update.sessionUpdate === "agent_message_chunk")).toEqual([]);
	});

	test("keeps a stable messageId per assistant message under v2", async () => {
		const message = { role: "assistant", content: [] };
		const otherMessage = { role: "assistant", content: [] };
		const { updates } = await runTurn({
			protocolVersion: 2,
			script: (emit) => {
				emit(textDelta("Hel", message));
				emit(textDelta("lo", message));
				emit(textDelta("next", otherMessage));
			},
		});

		const chunks = updates
			.map((entry) => entry.update)
			.filter((update) => update.sessionUpdate === "agent_message_chunk");
		expect(chunks).toHaveLength(3);
		expect(chunks[0]?.messageId).toBeTypeOf("string");
		expect(chunks[1]?.messageId).toBe(chunks[0]?.messageId);
		expect(chunks[2]?.messageId).not.toBe(chunks[0]?.messageId);
	});

	test("streams the tool lifecycle through tool_call_update under v2", async () => {
		const { updates } = await runTurn({
			protocolVersion: 2,
			script: (emit) => {
				emit(toolStart("call-1", "bash", { command: "ls" }));
				emit(toolUpdate("call-1", "partial output"));
				emit(toolEnd("call-1", "total 0", false));
			},
		});

		const toolUpdates = updates
			.map((entry) => entry.update)
			.filter((update) => update.sessionUpdate === "tool_call_update");
		expect(toolUpdates).toEqual([
			{
				sessionUpdate: "tool_call_update",
				toolCallId: "call-1",
				title: "bash ls",
				name: "bash",
				kind: "execute",
				status: "pending",
				content: [],
				rawInput: { command: "ls" },
			},
			{
				sessionUpdate: "tool_call_update",
				toolCallId: "call-1",
				status: "in_progress",
				rawOutput: "partial output",
			},
			{ sessionUpdate: "tool_call_update", toolCallId: "call-1", status: "completed", rawOutput: "total 0" },
		]);
	});
});
