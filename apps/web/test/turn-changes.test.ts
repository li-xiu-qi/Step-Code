import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { SessionEntry } from "@step-harness/coding-agent";
import {
	revertedTurnIds,
	reversePatch,
	revertTurnChanges,
	TURN_REVERT_TYPE,
	turnChanges,
	turnRevertNotice,
	WriteCapture,
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

/** Stand-in for generateUnifiedPatch: records its input. */
const fakePatch = (path: string, before: string, after: string) => JSON.stringify({ path, before, after });

function entry(id: string, message: Record<string, unknown>): SessionEntry {
	return { type: "message", id, parentId: null, timestamp: "2026-10-14T00:00:00.000Z", message } as SessionEntry;
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

test("WriteCapture patches a write and marks created files", async () => {
	const root = await mkdtemp(join(tmpdir(), "stepcode-web-turn-"));
	try {
		await writeFile(join(root, "old.txt"), "x\r\ny\r\n");
		const capture = new WriteCapture(fakePatch);
		await capture.capture("1", "write", { path: "old.txt", content: "x\ny\nz\n" }, root);
		await capture.capture("2", "write", { path: "new.txt", content: "n\n" }, root);
		await capture.capture("3", "read", { path: "old.txt" }, root);
		const changed = capture.details("1", "write", { path: "old.txt", content: "x\ny\nz\n" }, false);
		assert.equal(changed?.created, false);
		// Line endings are normalised so the patch matches the LF view revert works on.
		assert.deepEqual(JSON.parse(changed?.patch ?? "{}"), { path: "old.txt", before: "x\ny\n", after: "x\ny\nz\n" });
		assert.equal(capture.details("2", "write", { path: "new.txt", content: "n\n" }, false)?.created, true);
		assert.equal(capture.details("3", "read", { path: "old.txt" }, false), undefined);
		// Consumed once: a repeated result does not reuse the capture.
		assert.equal(capture.details("1", "write", { path: "old.txt", content: "" }, false), undefined);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("revertTurnChanges restores the turn's files and deletes created ones", async () => {
	const root = await mkdtemp(join(tmpdir(), "stepcode-web-turn-"));
	try {
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
			entry("r1", {
				role: "toolResult",
				toolCallId: "c1",
				details: { patch: PATCHES.two },
			}),
			entry("r2", {
				role: "toolResult",
				toolCallId: "c2",
				details: { patch: PATCHES.fresh, created: true },
			}),
			entry("r3", { role: "toolResult", toolCallId: "c3", isError: true, details: { patch: "x" } }),
			entry("u3", { role: "user", content: "third" }),
		];
		assert.deepEqual(turnChanges(entries, "u1"), []);
		const changes = turnChanges(entries, "u2");
		assert.deepEqual(
			changes.map((change) => [change.path, change.created]),
			[
				["a.txt", false],
				["b.txt", true],
			],
		);
		await revertTurnChanges(changes, root);
		assert.equal(await readFile(join(root, "a.txt"), "utf8"), "one\r\ntwo\r\nthree\r\n");
		await assert.rejects(stat(join(root, "b.txt")));
		// Applying again finds the content already restored, so nothing is written.
		await writeFile(join(root, "b.txt"), "fresh\n");
		await assert.rejects(revertTurnChanges(changes, root), /changed since this turn/);
		assert.equal(await readFile(join(root, "b.txt"), "utf8"), "fresh\n");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("reverted turns are read from the revert entries, and the notice names the request and files", () => {
	const entries = [
		entry("u1", { role: "user", content: [{ type: "text", text: "rename the   title" }] }),
		{
			type: "custom_message",
			id: "c1",
			parentId: null,
			timestamp: "2026-10-15T00:00:00.000Z",
			customType: TURN_REVERT_TYPE,
			content: "",
			display: false,
			details: { turnId: "u1", paths: [] },
		} as SessionEntry,
	];
	assert.deepEqual(revertedTurnIds(entries), ["u1"]);
	const notice = turnRevertNotice(entries, "u1", [
		{ toolCallId: "1", path: "a.txt", patch: "", created: false },
		{ toolCallId: "2", path: "a.txt", patch: "", created: false },
		{ toolCallId: "3", path: "b.txt", patch: "", created: true },
	]);
	assert.match(notice, /"rename the title"/);
	assert.match(notice, /a\.txt, b\.txt\./);
});
