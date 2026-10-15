import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@step-harness/providers";
import { afterEach, describe, expect, it } from "vitest";
import { generateUnifiedPatch } from "../../src/core/tools/edit-diff.ts";
import { MAX_WRITE_PATCH_BYTES, type WriteToolDetails } from "../../src/core/tools/write.ts";
import type { InlineExtension } from "../../src/index.ts";
import { createHarness, type Harness } from "./harness.ts";

/** Details of every finished write, in result order. */
function writeDetails(harness: Harness): Array<WriteToolDetails | undefined> {
	return harness.session.messages
		.filter((message) => message.role === "toolResult" && message.toolName === "write")
		.map((message) => (message as { details?: WriteToolDetails }).details);
}

async function runWrites(harness: Harness, calls: ReturnType<typeof fauxToolCall>[]): Promise<void> {
	harness.setResponses([fauxAssistantMessage(calls, { stopReason: "toolUse" }), fauxAssistantMessage("done")]);
	await harness.session.prompt("go");
}

describe("write tool patch details", () => {
	let harness: Harness | undefined;
	afterEach(() => harness?.cleanup());

	it("records the content it replaced after an earlier edit in the same parallel batch", async () => {
		harness = await createHarness();
		await writeFile(join(harness.tempDir, "a.txt"), "one\ntwo\n");
		await runWrites(harness, [
			fauxToolCall("edit", { path: "a.txt", edits: [{ oldText: "two", newText: "TWO" }] }),
			fauxToolCall("write", { path: "a.txt", content: "one\nTWO\nthree\n" }),
		]);
		expect(writeDetails(harness)).toEqual([
			{
				patch: generateUnifiedPatch("a.txt", "one\nTWO\n", "one\nTWO\nthree\n"),
				previous: { lineEnding: "\n", bom: false },
			},
		]);
	});

	it("reads the file after tool_call handlers ran, so a change made during approval is the previous content", async () => {
		let file = "";
		const approval: InlineExtension = {
			name: "approval stand-in",
			factory: (pi) => {
				pi.on("tool_call", async () => {
					await writeFile(file, "user edit\n");
				});
			},
		};
		harness = await createHarness({ extensionFactories: [approval] });
		file = join(harness.tempDir, "a.txt");
		await writeFile(file, "original\n");
		await runWrites(harness, [fauxToolCall("write", { path: "a.txt", content: "model\n" })]);
		expect(writeDetails(harness)[0]?.patch).toBe(generateUnifiedPatch("a.txt", "user edit\n", "model\n"));
	});

	it("marks created files and keeps the overwritten file's line ending and BOM", async () => {
		harness = await createHarness();
		await writeFile(join(harness.tempDir, "crlf.txt"), "﻿a\r\nb\r\n");
		await runWrites(harness, [
			fauxToolCall("write", { path: "new.txt", content: "n\n" }),
			fauxToolCall("write", { path: "crlf.txt", content: "a\nb\nc\n" }),
		]);
		expect(writeDetails(harness)).toEqual([
			{ patch: generateUnifiedPatch("new.txt", "", "n\n"), created: true },
			{
				patch: generateUnifiedPatch("crlf.txt", "a\nb\n", "a\nb\nc\n"),
				previous: { lineEnding: "\r\n", bom: true },
			},
		]);
	});

	it("resolves the path like the write itself, including unicode spaces", async () => {
		harness = await createHarness();
		await writeFile(join(harness.tempDir, "a b.txt"), "old\n");
		await runWrites(harness, [fauxToolCall("write", { path: "a b.txt", content: "new\n" })]);
		expect(await readFile(join(harness.tempDir, "a b.txt"), "utf8")).toBe("new\n");
		expect(writeDetails(harness)[0]).toMatchObject({ previous: { lineEnding: "\n", bom: false } });
		expect(writeDetails(harness)[0]?.created).toBeUndefined();
	});

	it("says why it recorded no patch", async () => {
		harness = await createHarness();
		await writeFile(join(harness.tempDir, "big.txt"), "x".repeat(MAX_WRITE_PATCH_BYTES + 1));
		await writeFile(join(harness.tempDir, "bin.dat"), Buffer.from([0, 1, 2]));
		await runWrites(harness, [
			fauxToolCall("write", { path: "big.txt", content: "small\n" }),
			fauxToolCall("write", { path: "bin.dat", content: "text\n" }),
		]);
		expect(writeDetails(harness)).toEqual([{ untracked: "too_large" }, { untracked: "binary" }]);
	});
});
