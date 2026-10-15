import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createWriteToolDefinition, type SessionEntry } from "@step-harness/coding-agent";
import {
	revertedTurnIds,
	reversePatch,
	revertTurnChanges,
	TURN_REVERT_TYPE,
	TurnReverter,
	turnChanges,
	turnRevertNotice,
} from "../src/turn-changes.ts";

/** Patches exactly as the coding agent's `generateUnifiedPatch` (jsdiff) prints them. */
const PATCHES = {
	edit: "--- f.txt\n+++ f.txt\n@@ -1,3 +1,4 @@\n a\n-b\n+B\n c\n+d\n",
	create: "--- f.txt\n+++ f.txt\n@@ -0,0 +1,2 @@\n+one\n+two\n",
	appendNoEol: "--- f.txt\n+++ f.txt\n@@ -1,2 +1,3 @@\n a\n-b\n\\ No newline at end of file\n+b\n+c\n\\ No newline at end of file\n",
	addEol: "--- f.txt\n+++ f.txt\n@@ -1,2 +1,2 @@\n a\n-b\n\\ No newline at end of file\n+b\n",
	dropEol: "--- f.txt\n+++ f.txt\n@@ -1,2 +1,2 @@\n a\n-b\n+b\n\\ No newline at end of file\n",
	two: "--- a.txt\n+++ a.txt\n@@ -1,3 +1,3 @@\n one\n-two\n+TWO\n three\n",
	fresh: "--- b.txt\n+++ b.txt\n@@ -0,0 +1,1 @@\n+fresh\n",
};

function entry(id: string, message: Record<string, unknown>): SessionEntry {
	return { type: "message", id, parentId: null, timestamp: "2026-10-14T00:00:00.000Z", message } as SessionEntry;
}

async function withRoot(run: (root: string) => Promise<void>): Promise<void> {
	const root = await mkdtemp(join(tmpdir(), "stepcode-web-turn-"));
	try {
		await run(root);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

/** One turn of `write` calls run through the real write tool, as session entries. */
async function writeTurn(root: string, writes: ReadonlyArray<{ path: string; content: string }>) {
	const tool = createWriteToolDefinition(root);
	const calls = writes.map((input, index) => ({ id: `w${index}`, input }));
	const entries: SessionEntry[] = [
		entry("u1", { role: "user", content: "go" }),
		entry("a1", {
			role: "assistant",
			content: calls.map((call) => ({ type: "toolCall", id: call.id, name: "write", arguments: call.input })),
		}),
	];
	for (const call of calls) {
		const result = await tool.execute(call.id, call.input, undefined, undefined, undefined as never);
		entries.push(entry(`r-${call.id}`, { role: "toolResult", toolCallId: call.id, details: result.details }));
	}
	return entries;
}

test("reversePatch undoes edits, including a trailing-newline change", () => {
	const cases: Array<[string, string, string]> = [
		["a\nb\nc\n", "a\nB\nc\nd\n", PATCHES.edit],
		["", "one\ntwo\n", PATCHES.create],
		["a\nb", "a\nb\nc", PATCHES.appendNoEol],
		["a\nb", "a\nb\n", PATCHES.addEol],
		["a\nb\n", "a\nb", PATCHES.dropEol],
	];
	for (const [before, after, patch] of cases) assert.equal(reversePatch(after, patch), before);
});

test("reversePatch finds a hunk that later edits moved, and keeps those edits", () => {
	// PATCHES.edit turned a/b/c into a/B/c/d; a later turn then prepended two lines and appended one.
	assert.equal(reversePatch("x\ny\na\nB\nc\nd\nz\n", PATCHES.edit), "x\ny\na\nb\nc\nz\n");
});

test("reversePatch tolerates edited context but not edited changes", () => {
	// PATCHES.edit's context line `a` was rewritten later; its own lines B and d are intact.
	assert.equal(reversePatch("A\nB\nc\nd\n", PATCHES.edit), "A\nb\nc\n");
	// The appended `mul` is undone although the `sub` body above it (its context) changed.
	const appendMul =
		"--- m.js\n+++ m.js\n@@ -3,3 +3,7 @@\n export function sub(a, b) {\n \treturn a - b;\n }\n+\n+export function mul(a, b) {\n+\treturn a * b;\n+}\n";
	assert.equal(
		reversePatch(
			"x\ny\nexport function sub(a, b) {\n\treturn a - b - 0;\n}\n\nexport function mul(a, b) {\n\treturn a * b;\n}\n",
			appendMul,
		),
		"x\ny\nexport function sub(a, b) {\n\treturn a - b - 0;\n}\n",
	);
});

test("reversePatch refuses content that changed since the patch", () => {
	assert.throws(() => reversePatch("a\nX\nc\nd\n", PATCHES.edit));
});

test("revertTurnChanges restores the turn's files and deletes created ones", async () => {
	await withRoot(async (root) => {
		await writeFile(join(root, "a.txt"), "one\r\nTWO\r\nthree\r\n");
		await writeFile(join(root, "b.txt"), "fresh\n");
		const entries = [
			entry("u1", { role: "user", content: "first" }),
			entry("u2", { role: "user", content: "second" }),
			entry("a1", {
				role: "assistant",
				content: [
					{ type: "toolCall", id: "c1", name: "edit", arguments: { path: "a.txt" } },
					{ type: "toolCall", id: "c2", name: "write", arguments: { path: "b.txt", content: "fresh\n" } },
					{ type: "toolCall", id: "c3", name: "edit", arguments: { path: "missing.txt" } },
				],
			}),
			entry("r1", { role: "toolResult", toolCallId: "c1", details: { patch: PATCHES.two } }),
			entry("r2", { role: "toolResult", toolCallId: "c2", details: { patch: PATCHES.fresh, created: true } }),
			entry("r3", { role: "toolResult", toolCallId: "c3", isError: true, details: { patch: "x" } }),
			entry("u3", { role: "user", content: "third" }),
		];
		assert.deepEqual(turnChanges(entries, "u1"), { changes: [], skipped: [] });
		const { changes } = turnChanges(entries, "u2");
		assert.deepEqual(
			changes.map((change) => [change.path, change.created]),
			[
				["a.txt", false],
				["b.txt", true],
			],
		);
		await revertTurnChanges(changes, root);
		// An edit keeps the file's line endings, so the revert keeps them too.
		assert.equal(await readFile(join(root, "a.txt"), "utf8"), "one\r\ntwo\r\nthree\r\n");
		await assert.rejects(stat(join(root, "b.txt")));
		// Applying again finds the content already restored, so nothing is written.
		await writeFile(join(root, "b.txt"), "fresh\n");
		await assert.rejects(revertTurnChanges(changes, root), /changed since this turn/);
		assert.equal(await readFile(join(root, "b.txt"), "utf8"), "fresh\n");
	});
});

test("turnChanges lists writes without a patch as skipped", async () => {
	await withRoot(async (root) => {
		await writeFile(join(root, "big.txt"), "x".repeat(2_000_000));
		await writeFile(join(root, "b.txt"), "b\n");
		const entries = await writeTurn(root, [
			{ path: "big.txt", content: "small\n" },
			{ path: "b.txt", content: "B\n" },
		]);
		// A write from before the tool recorded patches.
		entries.push(
			entry("a2", { role: "assistant", content: [{ type: "toolCall", id: "old", name: "write", arguments: { path: "o.txt" } }] }),
			entry("r2", { role: "toolResult", toolCallId: "old" }),
		);
		const { changes, skipped } = turnChanges(entries, "u1");
		assert.deepEqual(
			changes.map((change) => change.path),
			["b.txt"],
		);
		assert.deepEqual(skipped, [
			{ path: "big.txt", reason: "too_large" },
			{ path: "o.txt", reason: "unknown" },
		]);
	});
});

test("reverting a write restores the overwritten file's line endings and BOM", async () => {
	await withRoot(async (root) => {
		await writeFile(join(root, "lf.txt"), "a\nb\n");
		await writeFile(join(root, "crlf.txt"), "﻿a\r\nb\r\n");
		const entries = await writeTurn(root, [
			{ path: "lf.txt", content: "a\r\nb\r\nc\r\n" },
			{ path: "crlf.txt", content: "a\nb\nc\n" },
		]);
		await revertTurnChanges(turnChanges(entries, "u1").changes, root);
		assert.equal(await readFile(join(root, "lf.txt"), "utf8"), "a\nb\n");
		assert.equal(await readFile(join(root, "crlf.txt"), "utf8"), "﻿a\r\nb\r\n");
	});
});

test("reverting a write resolves the path like the write tool, including unicode spaces", async () => {
	await withRoot(async (root) => {
		await writeFile(join(root, "a b.txt"), "old\n");
		const entries = await writeTurn(root, [{ path: "a b.txt", content: "new\n" }]);
		await revertTurnChanges(turnChanges(entries, "u1").changes, root);
		assert.equal(await readFile(join(root, "a b.txt"), "utf8"), "old\n");
	});
});

/** The custom message entry `TurnReverter`'s record callback appends in the runtime. */
function revertEntry(turnId: string): SessionEntry {
	return {
		type: "custom_message",
		id: `revert-${turnId}`,
		parentId: null,
		timestamp: "2026-10-15T00:00:00.000Z",
		customType: TURN_REVERT_TYPE,
		content: "",
		display: false,
		details: { turnId, paths: [] },
	} as SessionEntry;
}

test("TurnReverter refuses a second revert while the first is running, and a reverted turn", async () => {
	await withRoot(async (root) => {
		await writeFile(join(root, "a.txt"), "old\n");
		const entries = await writeTurn(root, [{ path: "a.txt", content: "new\n" }]);
		const reverter = new TurnReverter();
		let release!: () => void;
		const recorded = new Promise<void>((resolve) => {
			release = resolve;
		});
		const first = reverter.revert("u1", entries, root, async () => {
			await recorded;
		});
		assert.equal(reverter.isBusy(), true);
		await assert.rejects(
			reverter.revert("u1", entries, root, async () => {}),
			/already reverting/,
		);
		release();
		assert.deepEqual((await first).paths, [join(root, "a.txt")]);
		assert.equal(reverter.isBusy(), false);
		assert.equal(await readFile(join(root, "a.txt"), "utf8"), "old\n");
		// The branch records the revert, so the same turn is refused afterwards.
		await assert.rejects(
			reverter.revert("u1", [...entries, revertEntry("u1")], root, async () => {}),
			/already reverted/,
		);
	});
});

test("reverted turns are read from the revert entries, and the notice names the request and files", () => {
	const entries = [entry("u1", { role: "user", content: [{ type: "text", text: "rename the   title" }] }), revertEntry("u1")];
	assert.deepEqual(revertedTurnIds(entries), ["u1"]);
	const notice = turnRevertNotice(entries, "u1", [
		{ toolCallId: "1", path: "a.txt", patch: "", created: false },
		{ toolCallId: "2", path: "a.txt", patch: "", created: false },
		{ toolCallId: "3", path: "b.txt", patch: "", created: true },
	]);
	assert.match(notice, /"rename the title"/);
	assert.match(notice, /a\.txt, b\.txt\./);
});
