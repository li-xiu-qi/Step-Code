import { PassThrough } from "node:stream";
import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { AgentSessionRuntimeHost } from "../src/core/agent-session-runtime.ts";
import type { ExtensionUIContext } from "../src/core/extensions/index.ts";
import { restoreStdout } from "../src/core/output-guard.ts";
import { runAcpMode } from "../src/modes/acp/acp-mode.ts";

type FakeSession = {
	sessionId: string;
	agent: { subscribe: () => () => void };
	subscribe: () => () => void;
	bindExtensions: (bindings: { uiContext?: ExtensionUIContext }) => Promise<void>;
	prompt: Mock<(text: string) => Promise<void>>;
	abort: Mock<() => Promise<void>>;
	waitForIdle: Mock<() => Promise<void>>;
	navigateTree: Mock<() => Promise<{ cancelled: boolean }>>;
	reload: Mock<() => Promise<void>>;
};

type InitializeResult = {
	protocolVersion: number;
	agentCapabilities: { promptCapabilities: { image: boolean } };
};

type PermissionParams = {
	sessionId: string;
	toolCall: { title: string };
};

let stdin: PassThrough;
let captured: string[];
let stdoutSpy: Mock<(chunk: unknown, encodingOrCallback?: unknown, callback?: unknown) => boolean>;
let originalStdoutWrite: typeof process.stdout.write;
let originalStdin: typeof process.stdin;

function createSession() {
	let uiContext: ExtensionUIContext | undefined;
	const session: FakeSession = {
		sessionId: "session-1",
		agent: { subscribe: vi.fn(() => () => {}) },
		subscribe: vi.fn(() => () => {}),
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
});
