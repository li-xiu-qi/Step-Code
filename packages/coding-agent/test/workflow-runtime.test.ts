import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os, { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { acquireWorkflowAdmission } from "../src/features/workflow/admission.ts";
import {
	clampWorkflowConcurrency,
	configuredWorkflowConcurrencyLimit,
	WorkflowBudgetExceeded,
	WorkflowSemaphore,
} from "../src/features/workflow/budget.ts";
import {
	createWorkflowRunPaths,
	readJsonLines,
	WorkflowJournal,
	type WorkflowRunPaths,
} from "../src/features/workflow/journal.ts";
import { WorkflowProgressStore } from "../src/features/workflow/progress.ts";
import { WorkflowRuntime, workflowToolResult } from "../src/features/workflow/runtime.ts";
import { checkWorkflowPathAccess, checkWorkflowToolCall } from "../src/features/workflow/tool-profile.ts";
import type {
	IterateResult,
	WorkflowAgentOptions,
	WorkflowAgentRunInput,
	WorkflowAgentRunner,
	WorkflowProgress,
	WorkflowProgressAgent,
	WorkflowTelemetryRecord,
} from "../src/features/workflow/types.ts";

const cleanups: string[] = [];
let runSequence = 0;

beforeEach(() => {
	const cpu = os.cpus()[0]!;
	vi.spyOn(os, "cpus").mockReturnValue(Array(10).fill(cpu));
});

afterEach(async () => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	await Promise.all(cleanups.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function workspace(): Promise<string> {
	const directory = await mkdtemp(path.join(tmpdir(), "step-workflow-test-"));
	cleanups.push(directory);
	return directory;
}

function runtimeAt(
	cwd: string,
	runner: WorkflowAgentRunner,
	options: {
		resumeFrom?: WorkflowRunPaths;
		budgetTotal?: number;
		maxConcurrency?: number;
		providerConcurrencyLimit?: number;
		runnerCleanupTimeoutMs?: number;
		maxAgents?: number;
		agentTimeoutMs?: number;
		vmExecutor?: ConstructorParameters<typeof WorkflowRuntime>[0]["vmExecutor"];
		nestedWorkflow?: ConstructorParameters<typeof WorkflowRuntime>[0]["nestedWorkflow"];
	} = {},
): { runtime: WorkflowRuntime; journal: WorkflowJournal; paths: WorkflowRunPaths } {
	runSequence += 1;
	const paths = createWorkflowRunPaths(cwd, `test_${runSequence}`);
	const journal = new WorkflowJournal(paths, options.resumeFrom);
	const runtime = new WorkflowRuntime({
		cwd,
		runId: `test_${runSequence}`,
		name: "test",
		journal,
		runner,
		budgetTotal: options.budgetTotal,
		maxConcurrency: options.maxConcurrency,
		providerConcurrencyLimit: options.providerConcurrencyLimit,
		runnerCleanupTimeoutMs: options.runnerCleanupTimeoutMs,
		maxAgents: options.maxAgents,
		agentTimeoutMs: options.agentTimeoutMs,
		vmExecutor: options.vmExecutor,
		nestedWorkflow: options.nestedWorkflow,
	});
	return { runtime, journal, paths };
}

function result(value: unknown, tokens = 1) {
	return {
		value,
		status: "completed" as const,
		usage: { input: tokens, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: tokens, turns: 1 },
	};
}

function initialProgress(runId: string): WorkflowProgress {
	return {
		schemaVersion: 1,
		runId,
		name: "test",
		status: "running",
		startedAt: 0,
		updatedAt: 0,
		agents: [],
		completedAgents: 0,
		totalAgents: 0,
		spentTokens: 0,
	};
}

test("explicit concurrency cannot exceed the machine ceiling", () => {
	expect(clampWorkflowConcurrency(22, 10)).toBe(8);
	expect(clampWorkflowConcurrency(22, 32)).toBe(16);
	expect(clampWorkflowConcurrency(2, 10)).toBe(2);
});

test("optional provider concurrency ignores blank and invalid environment values", () => {
	for (const raw of ["", "   ", "abc", "Infinity", "-1", "0"])
		expect(configuredWorkflowConcurrencyLimit(raw)).toBeUndefined();
	expect(configuredWorkflowConcurrencyLimit(" 8 ")).toBe(8);
});

test("a long server Retry-After cannot freeze the shared admission window", async () => {
	// A node's own retry honors Retry-After verbatim, but the admission window is
	// process-wide, so an hour-long (or far-future-date) cooldown must not stall
	// unrelated workflows with no timeout and no error.
	vi.useFakeTimers();
	const semaphore = new WorkflowSemaphore(4);
	try {
		semaphore.throttle(semaphore.epoch, 3_600_000);
		let admitted = false;
		const acquired = semaphore.acquire().then((release) => {
			admitted = true;
			return release;
		});
		await vi.advanceTimersByTimeAsync(29_000);
		expect(admitted).toBe(false);
		await vi.advanceTimersByTimeAsync(2_000);
		const release = await acquired;
		expect(admitted).toBe(true);
		release();
	} finally {
		semaphore.dispose();
		vi.useRealTimers();
	}
});

test("an invalid throttle delay neither blocks admission nor schedules a far-future timer", async () => {
	vi.useFakeTimers();
	const semaphore = new WorkflowSemaphore(2);
	try {
		for (const delay of [Number.NaN, Number.POSITIVE_INFINITY, -1]) semaphore.throttle(semaphore.epoch, delay);
		const release = await semaphore.acquire();
		release();
	} finally {
		semaphore.dispose();
		vi.useRealTimers();
	}
});

test("nested workflow callback failures propagate to the owning run", async () => {
	const child = 'return await parallel([() => agent("ok"), () => { throw new ReferenceError("missingRef"); }]);';
	const { runtime } = runtimeAt(await workspace(), async () => result("ok"), {
		nestedWorkflow: (_name, args, parent, depth) =>
			parent.runNestedScript(child, args, depth + 1, { filename: "child.js" }),
	});
	const output = await runtime.runScript('return await workflow("child");', null);
	expect(output).toMatchObject({
		status: "partial_failed",
		summary: { total: 1, completed: 1, failed: 0, failedCallbacks: 1 },
		taskFailures: [{ primitive: "parallel", index: 1, script: "child.js", message: "ReferenceError: missingRef" }],
	});
});

test.each([false, true])("agent failures are not double counted as callback failures (nested=%s)", async (nested) => {
	const { runtime } = runtimeAt(
		await workspace(),
		async () => ({ status: "failed", errorMessage: "provider failed" }),
		{
			nestedWorkflow: (_name, args, parent, depth) =>
				parent.runNestedScript('return await agent("bad");', args, depth + 1),
		},
	);
	const output = await runtime.runScript(
		nested ? 'return await parallel([() => workflow("child")]);' : 'return await parallel([() => agent("bad")]);',
		null,
	);
	expect(output.status).toBe("failed");
	expect(output.summary).toEqual({ total: 1, completed: 0, failed: 1 });
	expect(output.taskFailures).toBeUndefined();
});

test("unawaited nested workflows fail rather than returning a successful zero-call run", async () => {
	const { runtime, paths } = runtimeAt(await workspace(), async () => result("ok"), {
		nestedWorkflow: (_name, args, parent, depth) =>
			parent.runNestedScript('return await agent("child");', args, depth + 1),
	});
	await expect(runtime.runScript('void workflow("child"); return "done";', null)).rejects.toThrow("unawaited");
	const progress = JSON.parse(await readFile(paths.progressPath, "utf8"));
	expect(progress.status).toBe("failed");
	expect(progress.agents.every((agent: { status: string }) => !["running", "queued"].includes(agent.status))).toBe(
		true,
	);
});

test("a failing terminal progress write never replaces the run's terminal error", async () => {
	const cwd = await workspace();
	const paths = createWorkflowRunPaths(cwd, "progress_write_failure");
	const journal = new WorkflowJournal(paths);
	// A disk that only fails on terminal writes: the run's real error must survive.
	class TerminalFailingProgress extends WorkflowProgressStore {
		override async update(
			patch: Partial<WorkflowProgress> & { agent?: WorkflowProgressAgent },
		): Promise<WorkflowProgress> {
			if (patch.status !== undefined && patch.status !== "running") throw new Error("progress disk full");
			return super.update(patch);
		}
	}
	const runtime = new WorkflowRuntime({
		cwd,
		runId: "progress_write_failure",
		name: "test",
		journal,
		progress: new TerminalFailingProgress(paths.progressPath, initialProgress("progress_write_failure")),
		runner: async () => {
			throw new Error("provider exploded");
		},
	});
	await expect(runtime.runScript('return await agent("boom");', null)).rejects.toThrow("provider exploded");
	const entries = await readJsonLines<{ status?: string; error?: string }>(journal.paths.journalPath);
	expect(entries.filter((entry) => entry.status === "failed")).toMatchObject([
		{ status: "failed", error: expect.stringContaining("provider exploded") },
	]);
});

test("a failed progress write while recording a node keeps the failure classified once", async () => {
	const cwd = await workspace();
	const paths = createWorkflowRunPaths(cwd, "node_record_progress_failure");
	// State mutates before the write, so the agent is already failed when the write
	// rejects. The run must still report that node once, not also as a callback error.
	class LateFailingProgress extends WorkflowProgressStore {
		failWrites = false;
		override async update(
			patch: Partial<WorkflowProgress> & { agent?: WorkflowProgressAgent },
		): Promise<WorkflowProgress> {
			const snapshot = await super.update(patch);
			if (this.failWrites) throw new Error("progress disk full");
			return snapshot;
		}
	}
	const progress = new LateFailingProgress(paths.progressPath, initialProgress("node_record_progress_failure"));
	const runtime = new WorkflowRuntime({
		cwd,
		runId: "node_record_progress_failure",
		name: "test",
		journal: new WorkflowJournal(paths),
		progress,
		runner: async () => {
			progress.failWrites = true;
			return { status: "failed", errorMessage: "provider failed" };
		},
	});
	const output = await runtime.runScript('return await parallel([() => agent("bad")]);', null);
	expect(output).toMatchObject({ status: "failed", summary: { total: 1, completed: 0, failed: 1 } });
	expect(output.taskFailures).toBeUndefined();
	expect(output.failures?.[0]?.error?.message).toContain("provider failed");
});

test("a failed journal append while recording a node keeps the failure classified once", async () => {
	const cwd = await workspace();
	const paths = createWorkflowRunPaths(cwd, "node_record_journal_failure");
	await mkdir(paths.runDir, { recursive: true });
	// A directory at the journal path makes every append fail while the script copy
	// and progress writes still work.
	await mkdir(paths.journalPath, { recursive: true });
	const runtime = new WorkflowRuntime({
		cwd,
		runId: "node_record_journal_failure",
		name: "test",
		journal: new WorkflowJournal(paths),
		runner: async () => ({ status: "failed", errorMessage: "provider failed" }),
	});
	const output = await runtime.runScript('return await parallel([() => agent("bad")]);', null);
	expect(output).toMatchObject({ status: "failed", summary: { total: 1, completed: 0, failed: 1 } });
	expect(output.taskFailures).toBeUndefined();
	expect(output.failures?.[0]?.error?.message).toContain("provider failed");
});

test("shell interpolation errors before agent() cannot become a successful zero-call workflow", async () => {
	let calls = 0;
	const { runtime, paths } = runtimeAt(await workspace(), async (input) => {
		calls++;
		return result(input.prompt);
	});
	const output = await runtime.runScript(
		// biome-ignore lint/suspicious/noTemplateCurlyInString: Execute the user's broken JS template verbatim in the guest VM.
		'const tasks = Array.from({length: 10}, () => () => agent(`sleep $d; echo "slept=${d}s"`)); return await parallel(tasks);',
		null,
	);
	expect(calls).toBe(0);
	expect(output).toMatchObject({ status: "failed", agentCalls: 0, summary: { failedCallbacks: 10 } });
	expect(output.taskFailures).toHaveLength(10);
	expect(
		output.taskFailures?.every(
			(failure) => failure.message.includes("ReferenceError") && failure.message.includes("d"),
		),
	).toBe(true);
	expect(workflowToolResult(output).isError).toBe(true);
	expect(workflowToolResult(output).content).toMatchObject([{ text: expect.stringContaining("ReferenceError") }]);
	const progress = JSON.parse(await readFile(paths.progressPath, "utf8"));
	expect(progress.status).toBe("failed");
	expect(progress.taskFailures).toHaveLength(10);
});

test("ordinary JS strings preserve shell substitutions and dispatch all ten agents", async () => {
	const prompts: string[] = [];
	const { runtime } = runtimeAt(await workspace(), async (input) => {
		prompts.push(input.prompt);
		return result("ok");
	});
	const output = await runtime.runScript(
		// biome-ignore lint/suspicious/noTemplateCurlyInString: Shell substitutions must survive JavaScript string construction.
		"const command = 'sleep $d; echo \"slept=${d}s\"'; return await parallel(Array.from({length: 10}, () => () => agent(command)));",
		null,
	);
	expect(output).toMatchObject({
		status: "completed",
		agentCalls: 10,
		summary: { total: 10, completed: 10, failed: 0 },
	});
	// biome-ignore lint/suspicious/noTemplateCurlyInString: Assert the exact literal shell command.
	expect(prompts).toEqual(Array(10).fill('sleep $d; echo "slept=${d}s"'));
});

test("throttling one wave reduces cap once and queued work resumes after releases", async () => {
	const semaphore = new WorkflowSemaphore(8);
	const releases = await Promise.all(Array.from({ length: 8 }, () => semaphore.acquire()));
	let admitted = 0;
	const queued = Array.from({ length: 3 }, () =>
		semaphore.acquire().then((release) => {
			admitted++;
			return release;
		}),
	);
	const epoch = semaphore.epoch;
	semaphore.throttle(epoch, 0);
	semaphore.throttle(epoch, 0);
	expect(semaphore.max).toBe(6);
	for (const release of releases.slice(0, 2)) release();
	await Promise.resolve();
	expect(admitted).toBe(0);
	for (const release of releases.slice(2)) release();
	for (const release of await Promise.all(queued)) release();
	expect(admitted).toBe(3);
	semaphore.dispose();
});

test("cooldown blocks new admissions, cancellation removes waiters, and successes recover cap", async () => {
	vi.useFakeTimers();
	const semaphore = new WorkflowSemaphore(4);
	semaphore.throttle(semaphore.epoch, 1000);
	const controller = new AbortController();
	const cancelled = semaphore.acquire(controller.signal);
	const cancelledCheck = expect(cancelled).rejects.toThrow("aborted");
	controller.abort();
	await cancelledCheck;
	let admitted = 0;
	const pending = Array.from({ length: 4 }, () =>
		semaphore.acquire().then((release) => {
			admitted++;
			return release;
		}),
	);
	await vi.advanceTimersByTimeAsync(999);
	expect(admitted).toBe(0);
	await vi.advanceTimersByTimeAsync(1);
	expect(admitted).toBe(3);
	for (let i = 0; i < 4; i++) semaphore.succeeded(semaphore.epoch);
	expect(semaphore.max).toBe(4);
	for (const release of await Promise.all(pending)) release();
	semaphore.dispose();
	expect(vi.getTimerCount()).toBe(0);
});

test("parallel failures survive null filtering in final tool output and disk progress", async () => {
	const { runtime, paths } = runtimeAt(await workspace(), async (input) =>
		input.prompt === "bad"
			? { status: "failed", errorMessage: "429 concurrency reached, current: 9, limit: 8" }
			: result("ok"),
	);
	const output = await runtime.runScript(
		'return (await parallel([() => agent("ok"), () => agent("bad")])).filter(Boolean);',
		null,
	);
	expect(output).toMatchObject({
		status: "partial_failed",
		value: ["ok"],
		summary: { total: 2, completed: 1, failed: 1 },
		failures: [{ error: { code: "RATE_LIMITED", retryable: true } }],
	});
	expect(workflowToolResult(output).isError).toBe(true);
	expect(workflowToolResult(output).content).toMatchObject([
		{ text: expect.stringContaining("429 concurrency reached") },
	]);
	const progress = JSON.parse(await readFile(paths.progressPath, "utf8"));
	expect(progress.status).toBe("partial_failed");
	expect(progress.agents[1].error.message).toContain("429");
});

test("a recovered 429 adjusts cap without restarting the node or reporting it failed", async () => {
	let calls = 0;
	const { runtime } = runtimeAt(
		await workspace(),
		async (input) => {
			calls++;
			input.onModelRequest?.({ type: "rate_limit", attempt: 1, maxRetries: 3, delayMs: 0, message: "429" });
			input.onModelRequest?.({ type: "started" });
			input.onModelRequest?.({ type: "succeeded" });
			return result("ok");
		},
		{ maxConcurrency: 4 },
	);
	const output = await runtime.runScript('return await agent("test");', null);
	expect(calls).toBe(1);
	expect(output).toMatchObject({ status: "completed", failures: [], concurrency: { limit: 4, cap: 3 } });
});

test("agent retries invalid schema output and strips unknown fields", async () => {
	const cwd = await workspace();
	const prompts: string[] = [];
	const values = [{ wrong: true }, { value: "ok", ignored: true }];
	const { runtime, journal, paths } = runtimeAt(cwd, async (input) => {
		prompts.push(input.prompt);
		return result(values.shift());
	});
	await journal.initialize("schema-test");

	const value = await runtime.agent("return a value", {
		schema: {
			type: "object",
			required: ["value"],
			properties: { value: { type: "string" } },
			additionalProperties: false,
		},
	});

	expect(value).toEqual({ value: "ok" });
	expect(prompts).toHaveLength(2);
	expect(prompts[1]).toContain("Previous output failed schema validation");
	const entries = await readJsonLines<{ attempt: number; result: unknown }>(paths.journalPath);
	expect(entries).toMatchObject([{ attempt: 2, result: { value: "ok" } }]);
});

test("agent stops after three schema failures and journals the error", async () => {
	const cwd = await workspace();
	let calls = 0;
	const { runtime, journal, paths } = runtimeAt(cwd, async () => {
		calls += 1;
		return result({});
	});
	await journal.initialize("schema-failure");

	await expect(
		runtime.agent("return a value", {
			schema: { type: "object", required: ["value"], properties: { value: { type: "string" } } },
		}),
	).rejects.toMatchObject({ attempts: 3 });
	expect(calls).toBe(3);
	const entries = await readJsonLines<{ status: string; attempt: number; error: string }>(paths.journalPath);
	expect(entries).toMatchObject([{ status: "failed", attempt: 3 }]);
	expect(entries[0]?.error).toContain("required properties value");
});

test("resume reuses only the matching journal prefix", async () => {
	const cwd = await workspace();
	const original = runtimeAt(cwd, async (input) => result(input.prompt));
	await original.journal.initialize("original");
	for (const prompt of ["a", "b", "c"]) await original.runtime.agent(prompt);

	const exactCalls: string[] = [];
	const exact = runtimeAt(
		cwd,
		async (input) => {
			exactCalls.push(input.prompt);
			return result(input.prompt);
		},
		{ resumeFrom: original.paths },
	);
	await exact.journal.initialize("exact");
	expect(await exact.runtime.agent("a")).toBe("a");
	expect(await exact.runtime.agent("b")).toBe("b");
	expect(await exact.runtime.agent("d")).toBe("d");
	expect(exactCalls).toEqual(["d"]);
	await exact.journal.flush();

	const chainedCalls: string[] = [];
	const chained = runtimeAt(
		cwd,
		async (input) => {
			chainedCalls.push(input.prompt);
			return result(input.prompt);
		},
		{ resumeFrom: exact.paths },
	);
	await chained.journal.initialize("chained");
	expect(await chained.runtime.agent("a")).toBe("a");
	expect(await chained.runtime.agent("b")).toBe("b");
	expect(await chained.runtime.agent("d")).toBe("d");
	expect(chainedCalls).toEqual([]);

	const mismatchCalls: string[] = [];
	const mismatch = runtimeAt(
		cwd,
		async (input) => {
			mismatchCalls.push(input.prompt);
			return result(input.prompt);
		},
		{ resumeFrom: original.paths },
	);
	await mismatch.journal.initialize("mismatch");
	expect(await mismatch.runtime.agent("a")).toBe("a");
	expect(await mismatch.runtime.agent("changed")).toBe("changed");
	expect(await mismatch.runtime.agent("c")).toBe("c");
	expect(mismatchCalls).toEqual(["changed", "c"]);
});

test("resume stops at a malformed journal line instead of skipping ahead", async () => {
	const cwd = await workspace();
	const source = runtimeAt(cwd, async (input) => result(input.prompt));
	await source.journal.initialize("malformed-source");
	await source.runtime.agent("a");
	await source.runtime.agent("b");
	const journalText = await readFile(source.paths.journalPath, "utf8");
	const lines = journalText.trimEnd().split("\n");
	await writeFile(source.paths.journalPath, `${lines[0]}\nnot-json\n${lines[1]}\n`);

	const calls: string[] = [];
	const resumed = runtimeAt(
		cwd,
		async (input) => {
			calls.push(input.prompt);
			return result(input.prompt);
		},
		{ resumeFrom: source.paths },
	);
	await resumed.journal.initialize("malformed-resume");
	expect(await resumed.runtime.agent("a")).toBe("a");
	expect(await resumed.runtime.agent("b")).toBe("b");
	expect(calls).toEqual(["b"]);
});

test("budget failure accounts the completed call and persists a terminal status", async () => {
	const cwd = await workspace();
	const execution = runtimeAt(cwd, async () => result("expensive", 7), {
		budgetTotal: 5,
		vmExecutor: async (_script, _args, host) => ({ value: await host.agent("expensive", {}), meta: {} }),
	});

	await expect(execution.runtime.runScript("return agent('expensive')", null)).rejects.toBeInstanceOf(
		WorkflowBudgetExceeded,
	);
	expect(execution.runtime.budget.spent()).toBe(7);
	const progress = JSON.parse(await readFile(execution.paths.progressPath, "utf8")) as WorkflowProgress;
	expect(progress).toMatchObject({ status: "budget_exceeded", spentTokens: 7 });
	const journal = await readJsonLines<{ status: string; error: string }>(execution.paths.journalPath);
	expect(journal).toMatchObject([{ status: "failed" }]);
	const telemetry = await readJsonLines<WorkflowTelemetryRecord>(execution.paths.telemetryPath);
	expect(telemetry.at(-1)).toMatchObject({ event: "workflow_finished", properties: { status: "budget_exceeded" } });
});

test("budget fails closed even when the script swallows per-call budget errors", async () => {
	const cwd = await workspace();
	let runnerCalls = 0;
	// Mimic parallel()/pipeline() null-on-error: swallow each agent() rejection and keep going.
	// Without a pre-spend gate every call would run and overspend (5 calls * 7 = 35 tokens on a
	// budget of 5); the gate must refuse calls once the budget is exhausted, and the run must
	// still terminate as budget_exceeded rather than silently completing.
	const execution = runtimeAt(
		cwd,
		async (input) => {
			runnerCalls += 1;
			return result(input.prompt, 7);
		},
		{
			budgetTotal: 5,
			maxConcurrency: 1,
			vmExecutor: async (_script, _args, host) => {
				for (let index = 0; index < 5; index += 1) {
					try {
						await host.agent(`item-${index}`, {});
					} catch {
						// swallowed, exactly like the VM parallel()/pipeline() primitives
					}
				}
				return { value: null, meta: {} };
			},
		},
	);

	await expect(execution.runtime.runScript("swallowing script", null)).rejects.toBeInstanceOf(WorkflowBudgetExceeded);
	expect(runnerCalls).toBe(1);
	expect(execution.runtime.budget.spent()).toBe(7);
	const progress = JSON.parse(await readFile(execution.paths.progressPath, "utf8")) as WorkflowProgress;
	expect(progress).toMatchObject({ status: "budget_exceeded", spentTokens: 7 });
});

test("budget gate bounds overspend to one in-flight concurrency wave", async () => {
	const cwd = await workspace();
	const concurrency = 4;
	let runnerCalls = 0;
	// Fire 20 agents at once under a budget of 1 with concurrency 4. Every agent() reaches the
	// semaphore in the same tick while spent() is still 0, so up to `concurrency` are admitted
	// before any of them account spend; the rest must be gated. This is the concurrent case the
	// gate is really about — the serial test above only proves the maxConcurrency:1 case.
	const execution = runtimeAt(
		cwd,
		async (input) => {
			runnerCalls += 1;
			return result(input.prompt, 7);
		},
		{
			budgetTotal: 1,
			maxConcurrency: concurrency,
			vmExecutor: async (_script, _args, host) => {
				await Promise.all(
					Array.from({ length: 20 }, (_unused, index) => host.agent(`item-${index}`, {}).catch(() => null)),
				);
				return { value: null, meta: {} };
			},
		},
	);

	await expect(execution.runtime.runScript("swallowing fan-out", null)).rejects.toBeInstanceOf(WorkflowBudgetExceeded);
	expect(runnerCalls).toBeGreaterThan(1); // the concurrent wave ran more than one (not the serial bound)
	expect(runnerCalls).toBeLessThanOrEqual(concurrency); // but overspend is capped to the wave, not all 20
	expect(execution.runtime.budget.spent()).toBeLessThanOrEqual(concurrency * 7);
});

test("agent concurrency stays within the configured semaphore limit", async () => {
	const cwd = await workspace();
	const limit = 2;
	let active = 0;
	let peak = 0;
	// Gate each runner until `limit` runners are concurrently active so the peak is
	// observed deterministically instead of relying on a fixed sleep to overlap — the
	// pre-runner progress I/O can otherwise stagger the calls and hide the true peak.
	let releaseWhenSaturated!: () => void;
	const saturated = new Promise<void>((resolve) => {
		releaseWhenSaturated = resolve;
	});
	const { runtime, journal } = runtimeAt(
		cwd,
		async (input) => {
			active += 1;
			peak = Math.max(peak, active);
			if (active >= limit) releaseWhenSaturated();
			// Fall back to a timeout so a broken semaphore (that never saturates) still
			// resolves and lets the assertion fail with the observed peak.
			await Promise.race([saturated, new Promise((resolve) => setTimeout(resolve, 200))]);
			active -= 1;
			return result(input.prompt);
		},
		{ maxConcurrency: limit },
	);
	await journal.initialize("concurrency");

	await Promise.all(Array.from({ length: 6 }, (_, index) => runtime.agent(`call-${index}`)));
	expect(peak).toBe(limit);
	expect(runtime.semaphore.peak).toBe(limit);
});

test("parallel calls cannot race past the workflow agent limit", async () => {
	const cwd = await workspace();
	let runnerCalls = 0;
	const { runtime, journal } = runtimeAt(
		cwd,
		async (input) => {
			runnerCalls += 1;
			await new Promise((resolve) => setTimeout(resolve, 5));
			return result(input.prompt);
		},
		{ maxAgents: 2, maxConcurrency: 1 },
	);
	await journal.initialize("agent-limit");

	const calls = await Promise.allSettled(Array.from({ length: 4 }, (_, index) => runtime.agent(`call-${index}`)));
	expect(calls.filter((entry) => entry.status === "fulfilled")).toHaveLength(2);
	expect(calls.filter((entry) => entry.status === "rejected")).toHaveLength(2);
	expect(runnerCalls).toBe(2);
});

test("agent timeout aborts the attempt and releases its semaphore slot", async () => {
	const cwd = await workspace();
	const { runtime, journal } = runtimeAt(
		cwd,
		async (input) =>
			new Promise((resolve) => {
				input.signal?.addEventListener("abort", () => resolve({ status: "aborted" }), { once: true });
			}),
		{
			agentTimeoutMs: 1_000,
			maxConcurrency: 1,
		},
	);
	await journal.initialize("agent-timeout");

	await expect(runtime.agent("never settles")).rejects.toThrow("timed out after 1000ms");
	expect(runtime.semaphore.active).toBe(0);
});

test("script failure cancels running and queued nodes, awaits cleanup, and seals terminal progress", async () => {
	let signalStarted!: () => void;
	const started = new Promise<void>((resolve) => {
		signalStarted = resolve;
	});
	const calls: string[] = [];
	let cleaned = false;
	const { runtime, paths } = runtimeAt(
		await workspace(),
		async (input) => {
			calls.push(input.prompt);
			signalStarted();
			await new Promise<void>((resolve) =>
				input.signal?.addEventListener(
					"abort",
					() => {
						setTimeout(() => {
							cleaned = true;
							resolve();
						}, 10);
					},
					{ once: true },
				),
			);
			return { status: "aborted" };
		},
		{
			maxConcurrency: 1,
			vmExecutor: async (_script, _args, host) => {
				void host.agent("running", {});
				void host.agent("queued", {});
				await started;
				throw new Error("script exploded");
			},
		},
	);
	await expect(runtime.runScript("bad script", null)).rejects.toThrow("script exploded");
	expect(cleaned).toBe(true);
	expect(calls).toEqual(["running"]);
	const before = await readFile(paths.progressPath, "utf8");
	const progress = JSON.parse(before);
	expect(progress).toMatchObject({ status: "failed", message: "script exploded" });
	expect(progress.agents.every((a: { status: string }) => a.status === "aborted")).toBe(true);
	const journal = await readJsonLines<{ status: string }>(paths.journalPath);
	expect(journal).toHaveLength(2);
	expect(journal.every((entry) => entry.status === "aborted")).toBe(true);
	await expect(runtime.agent("late")).rejects.toThrow("scope is closed");
	runtime.log("late update");
	expect(await readFile(paths.progressPath, "utf8")).toBe(before);
});

test("returning with detached agent calls fails and cancels them instead of claiming completion", async () => {
	let aborted = false;
	let signalStarted!: () => void;
	const started = new Promise<void>((resolve) => {
		signalStarted = resolve;
	});
	const { runtime } = runtimeAt(
		await workspace(),
		async (input) => {
			signalStarted();
			await new Promise<void>((resolve) =>
				input.signal?.addEventListener(
					"abort",
					() => {
						aborted = true;
						resolve();
					},
					{ once: true },
				),
			);
			return { status: "aborted" };
		},
		{
			vmExecutor: async (_script, _args, host) => {
				void host.agent("detached", {});
				await started;
				return { value: null, meta: {} };
			},
		},
	);
	await expect(runtime.runScript("missing await", null)).rejects.toThrow("unawaited agent calls");
	expect(aborted).toBe(true);
});

test("abort during admission progress never calls the runner", async () => {
	const cwd = await workspace();
	const controller = new AbortController();
	let calls = 0;
	const paths = createWorkflowRunPaths(cwd, "abort-before-runner");
	const runtime = new WorkflowRuntime({
		cwd,
		runId: "abort-before-runner",
		name: "abort",
		journal: new WorkflowJournal(paths),
		signal: controller.signal,
		onProgress: (progress) => {
			if (progress.agents.some((agent) => agent.status === "running")) controller.abort();
		},
		runner: async () => {
			calls++;
			return result("unexpected");
		},
	});
	await expect(runtime.runScript('return await agent("test");', null)).rejects.toThrow(/aborted/i);
	expect(calls).toBe(0);
});

test("uncooperative runners retain admission until settlement, then the pool can be recreated", async () => {
	let started!: () => void;
	const ready = new Promise<void>((resolve) => {
		started = resolve;
	});
	let finish!: () => void;
	const gate = new Promise<void>((resolve) => {
		finish = resolve;
	});
	const first = runtimeAt(
		await workspace(),
		async () => {
			started();
			await gate;
			return result("late");
		},
		{
			maxConcurrency: 1,
			providerConcurrencyLimit: 1,
			runnerCleanupTimeoutMs: 10,
			vmExecutor: async (_script, _args, host) => {
				void host.agent("uncooperative", {});
				await ready;
				throw new Error("stop this run");
			},
		},
	);
	try {
		await expect(first.runtime.runScript("stop", null)).rejects.toThrow("stop this run");
		const progress = JSON.parse(await readFile(first.paths.progressPath, "utf8"));
		expect(progress.agents[0].error.message).toContain("shared slot remains reserved");
		let nextCalls = 0;
		const next = runtimeAt(
			await workspace(),
			async () => {
				nextCalls++;
				return result("ok");
			},
			{ maxConcurrency: 1, providerConcurrencyLimit: 1 },
		);
		const run = next.runtime.runScript('return await agent("next");', null);
		await vi.waitFor(() => expect(next.runtime.semaphore.active).toBe(1));
		expect(nextCalls).toBe(0);
		finish();
		expect((await run).status).toBe("completed");
		expect(nextCalls).toBe(1);
		const recreated = acquireWorkflowAdmission(2);
		expect(recreated.semaphore.active).toBe(0);
		expect(recreated.semaphore.max).toBe(2);
		recreated.release();
	} finally {
		finish();
	}
});

test("two workflows share one host window and both drain their queues", async () => {
	let active = 0;
	let peak = 0;
	let startedCount = 0;
	let signalSaturated!: () => void;
	const saturated = new Promise<void>((resolve) => {
		signalSaturated = resolve;
	});
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const runner: WorkflowAgentRunner = async (input) => {
		active++;
		startedCount++;
		peak = Math.max(peak, active);
		if (active === 2) signalSaturated();
		await gate;
		active--;
		return result(input.prompt);
	};
	const first = runtimeAt(await workspace(), runner, { maxConcurrency: 2, providerConcurrencyLimit: 2 });
	const second = runtimeAt(await workspace(), runner, { maxConcurrency: 2, providerConcurrencyLimit: 2 });
	const script = 'return await parallel([agent("a"), agent("b"), agent("c")]);';
	const runs = [first.runtime.runScript(script, null), second.runtime.runScript(script, null)];
	await saturated;
	await new Promise((resolve) => setTimeout(resolve, 20));
	expect(startedCount).toBe(2);
	release();
	const results = await Promise.all(runs);
	expect(results.map((run) => run.status)).toEqual(["completed", "completed"]);
	expect(peak).toBe(2);
	expect(startedCount).toBe(6);
	expect(active).toBe(0);
});

test("named tool profiles resolve and writable agents remain single-writer", async () => {
	const cwd = await workspace();
	const options: WorkflowAgentOptions[] = [];
	let runnerCalls = 0;
	const { runtime, journal } = runtimeAt(cwd, async (input) => {
		options.push(input.options);
		runnerCalls += 1;
		await new Promise((resolve) => setTimeout(resolve, 10));
		return result(input.prompt);
	});
	await journal.initialize("profiles");

	await runtime.agent("plan", { toolProfile: "planner" });
	await runtime.agent("develop", { toolProfile: "developer" });
	expect(options[0]?.toolProfile).toEqual([
		"read_file",
		"search_files",
		"find_files",
		"list_directory",
		"find_tools",
		"clarify_user",
	]);
	expect(options[1]?.toolProfile).toEqual([
		"read_file",
		"search_files",
		"find_files",
		"list_directory",
		"find_tools",
		"write_file",
		"edit_file",
		"run_command",
	]);

	const writers = await Promise.allSettled([
		runtime.agent("writer-a", { writable: [cwd] }),
		runtime.agent("writer-b", { writable: [cwd] }),
	]);
	expect(writers.filter((entry) => entry.status === "fulfilled")).toHaveLength(1);
	expect(writers.filter((entry) => entry.status === "rejected")).toHaveLength(1);
	expect(runnerCalls).toBe(3);
});

test("path ACL blocks read-only writes, traversal, and symlink escapes", async () => {
	const cwd = await workspace();
	const artifact = path.join(cwd, "artifact");
	const outside = await workspace();
	await mkdir(artifact);
	await symlink(outside, path.join(artifact, "escape"));
	const acl = { readOnly: [artifact], writable: [path.join(cwd, "output")] };

	expect(checkWorkflowPathAccess(cwd, path.join(artifact, "file.ts"), "write", acl).allowed).toBe(false);
	expect(checkWorkflowPathAccess(cwd, path.join(cwd, "elsewhere.ts"), "write", { readOnly: [artifact] }).allowed).toBe(
		false,
	);
	expect(checkWorkflowPathAccess(cwd, path.join(artifact, "..", "secret"), "read", acl).allowed).toBe(false);
	expect(checkWorkflowPathAccess(cwd, path.join(artifact, "escape", "secret"), "read", acl).allowed).toBe(false);
	expect(
		checkWorkflowToolCall(cwd, "run_command", { command: `echo changed > '${artifact}/file.ts'` }, acl).allowed,
	).toBe(false);
	expect(
		checkWorkflowToolCall(cwd, "run_command", { command: `echo changed 2> '${artifact}/error.log'` }, acl).allowed,
	).toBe(false);
	expect(
		checkWorkflowToolCall(
			cwd,
			"run_command",
			{
				cwd: path.join(cwd, "output"),
				command: "echo changed > relative.txt",
			},
			acl,
		).allowed,
	).toBe(true);
	expect(checkWorkflowToolCall(cwd, "subagent", {}, acl).allowed).toBe(false);
	expect(checkWorkflowToolCall(cwd, "write_file", { path: path.join(cwd, "output", "ok.ts") }, acl).allowed).toBe(
		true,
	);
	expect(
		checkWorkflowToolCall(
			cwd,
			"write_file",
			{ path: path.join(cwd, "output", "ok.ts"), then_run: `echo changed > '${artifact}/file.ts'` },
			acl,
		).allowed,
	).toBe(false);
});

function plan(objective: string) {
	return {
		objective,
		taskSpecification: [{ task: "implement", filesLikely: ["src/a.ts"], nestedIgnored: true }],
		preservationConstraints: ["keep behavior"],
		validationRequirements: ["run tests"],
		rationale: "next bounded change",
		ignored: "strip me",
	};
}

function developer() {
	return {
		filesChanged: ["src/a.ts"],
		selfTestsPassed: [{ name: "unit", evidence: "passed" }],
		selfTestsFailed: [],
		designDecisions: ["small change"],
		handoff: "ready for QA",
	};
}

function evidence(specCoverage: number, coverageDelta?: number) {
	return {
		dimensions: {
			functionalCorrectness: [],
			buildTestIntegrity: [],
			interfaceInteraction: [],
			dataDependencies: [],
			configuration: [],
			stabilityCompleteness: [],
		},
		verifiedBehaviors: ["works"],
		unresolvedGaps: [],
		prioritizedTaskScope: [],
		specCoverage,
		...(coverageDelta === undefined ? {} : { coverageDelta }),
	};
}

function hohRunner(
	objectives: string[],
	coverages: number[],
	calls: WorkflowAgentRunInput[] = [],
): WorkflowAgentRunner {
	return async (input) => {
		calls.push(input);
		const label = input.options.label ?? "";
		const iteration = Number(label.split(":")[1] ?? "1") - 1;
		if (label.startsWith("planner:")) return result(plan(objectives[iteration] ?? objectives.at(-1) ?? ""));
		if (label.startsWith("developer:")) return result(developer());
		return result(evidence(coverages[iteration] ?? coverages.at(-1) ?? 0));
	};
}

test("HoH iterate carries evidence through Planner, Developer, and QA", async () => {
	const cwd = await workspace();
	const calls: WorkflowAgentRunInput[] = [];
	const execution = runtimeAt(cwd, hohRunner(["first", "second"], [0.4, 0.9], calls), {
		vmExecutor: async (_script, _args, host) => ({
			value: await host.iterate({ spec: "finish the feature", maxIterations: 5, stopWhenSpecCoverage: 0.8 }),
			meta: {},
		}),
	});

	const run = await execution.runtime.runScript("return iterate({ spec: 'finish the feature' })", null);
	const iterate = run.value as IterateResult;
	expect(iterate).toMatchObject({
		iterations: 2,
		status: "completed",
		stopReason: "coverage_target",
		specCoverage: 0.9,
	});
	expect(calls.map((call) => call.options.label)).toEqual([
		"planner:1",
		"developer:1",
		"qa:1",
		"planner:2",
		"developer:2",
		"qa:2",
	]);
	expect(calls[3]?.prompt).toContain('"specCoverage":0.4');
	expect(calls[0]?.options.readOnly).toEqual([cwd]);
	expect(calls[1]?.options.writable).toEqual([cwd]);
	expect(calls[2]?.options.readOnly).toEqual([cwd]);
	expect(calls[1]?.options.toolProfile).toEqual([
		"read_file",
		"search_files",
		"find_files",
		"list_directory",
		"find_tools",
		"write_file",
		"edit_file",
		"run_command",
	]);
	const persisted = await readJsonLines<{ plan: Record<string, unknown> }>(execution.paths.evidencePath);
	expect(persisted).toHaveLength(2);
	expect(persisted[0]?.plan).not.toHaveProperty("ignored");
	expect(JSON.stringify(persisted[0]?.plan)).not.toContain("nestedIgnored");
	const progress = JSON.parse(await readFile(execution.paths.progressPath, "utf8")) as WorkflowProgress;
	expect(progress).toMatchObject({ status: "completed", completedAgents: 6, totalAgents: 6 });
});

test("HoH iterate honors empty-objective and custom evidence-path stops", async () => {
	const cwd = await workspace();
	const customEvidence = path.join(cwd, "reports", "hoh.jsonl");
	const execution = runtimeAt(cwd, hohRunner([""], []));
	await execution.journal.initialize("empty-objective");

	const iterate = (await execution.runtime.iterate({
		spec: "bounded spec",
		maxIterations: 4,
		evidencePath: customEvidence,
	})) as IterateResult;
	expect(iterate).toMatchObject({ iterations: 1, status: "stopped", stopReason: "empty_objective" });
	expect(await readJsonLines(customEvidence)).toHaveLength(1);
	await expect(execution.runtime.iterate({ spec: " " })).rejects.toThrow("non-empty spec");
	await expect(execution.runtime.iterate({ spec: "ok", evidencePath: "../escape.jsonl" })).rejects.toThrow(
		"inside the working directory",
	);
});

test("HoH iterate stops at max iterations and on stagnant coverage", async () => {
	const cwd = await workspace();
	const maxed = runtimeAt(cwd, hohRunner(["one"], [0.2]));
	await maxed.journal.initialize("maxed");
	expect(await maxed.runtime.iterate({ spec: "spec", maxIterations: 1 })).toMatchObject({
		iterations: 1,
		status: "stopped",
		stopReason: "max_iterations",
	});

	const stagnant = runtimeAt(cwd, hohRunner(["one"], [0.1, 0.1, 0.1, 0.1]));
	await stagnant.journal.initialize("stagnant");
	expect(await stagnant.runtime.iterate({ spec: "spec", maxIterations: 10, stagnationLimit: 3 })).toMatchObject({
		iterations: 4,
		status: "stopped",
		stopReason: "stagnation",
	});
});

test.each([0, 1])("a swallowed budget rejection at an exact limit of %i still fails the run", async (budgetTotal) => {
	const cwd = await workspace();
	let calls = 0;
	const execution = runtimeAt(
		cwd,
		async () => {
			calls += 1;
			return result("done", 1);
		},
		{
			budgetTotal,
			maxConcurrency: 1,
			vmExecutor: async (_script, _args, host) => {
				for (const prompt of ["first", "second"]) await host.agent(prompt, {}).catch(() => null);
				return { value: null, meta: {} };
			},
		},
	);
	await expect(execution.runtime.runScript("swallowed limit", null)).rejects.toBeInstanceOf(WorkflowBudgetExceeded);
	expect(calls).toBe(budgetTotal);
	const progress = JSON.parse(await readFile(execution.paths.progressPath, "utf8")) as WorkflowProgress;
	expect(progress).toMatchObject({ status: "budget_exceeded", spentTokens: budgetTotal });
});

test("schema retries stop when the previous attempt has exhausted the budget", async () => {
	const cwd = await workspace();
	let calls = 0;
	const execution = runtimeAt(
		cwd,
		async () => {
			calls += 1;
			return result({}, 1);
		},
		{
			budgetTotal: 1,
			vmExecutor: async (_script, _args, host) => ({
				value: await host.agent("return a value", {
					schema: { type: "object", required: ["value"], properties: { value: { type: "string" } } },
				}),
				meta: {},
			}),
		},
	);
	await expect(execution.runtime.runScript("schema budget", null)).rejects.toBeInstanceOf(WorkflowBudgetExceeded);
	expect(calls).toBe(1);
	expect(execution.runtime.budget.spent()).toBe(1);
});
