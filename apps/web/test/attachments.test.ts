import assert from "node:assert/strict";
import test from "node:test";
import { classifyAttachment, MAX_ATTACHMENT_BYTES, withTextAttachments } from "../src/attachments.ts";

const text = (name: string, body: string) => ({
	name,
	mimeType: "text/plain",
	data: Buffer.from(body, "utf8").toString("base64"),
	kind: "text" as const,
});

const image = (name: string) => ({
	name,
	mimeType: "image/png",
	data: Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64"),
	kind: "image" as const,
});

test("classifyAttachment routes images and everything else to text", () => {
	assert.equal(classifyAttachment("image/png"), "image");
	assert.equal(classifyAttachment("image/jpeg"), "image");
	assert.equal(classifyAttachment("text/plain"), "text");
	assert.equal(classifyAttachment("application/json"), "text");
	assert.equal(classifyAttachment("application/pdf"), "text");
});

test("a message without text attachments is returned untouched", () => {
	assert.equal(withTextAttachments("hello", []), "hello");
	assert.equal(withTextAttachments("hello", [image("shot.png")]), "hello");
});

test("text attachments are folded in with their filename", () => {
	const result = withTextAttachments(" summarise this", [text("notes.md", "# Title\n\nBody")]);

	assert.match(result, /summarise this/);
	assert.match(result, /\[attached file: notes\.md\]/u);
	assert.match(result, /# Title/);
	assert.match(result, /Body/);
});

test("each attachment becomes its own block, in order", () => {
	const result = withTextAttachments("go", [text("a.txt", "AAA"), text("b.txt", "BBB")]);

	assert.ok(result.indexOf("AAA") < result.indexOf("BBB"));
	assert.equal(result.match(/\[attached file:/gu)?.length, 2);
});

test("an oversized text attachment is truncated, not dropped", () => {
	const huge = "x".repeat(50_000);
	const result = withTextAttachments("go", [text("big.txt", huge)]);

	assert.match(result, /truncated/u);
	assert.ok(result.length < huge.length);
});

test("the size limit is a sane ceiling", () => {
	assert.equal(MAX_ATTACHMENT_BYTES, 5 * 1024 * 1024);
});
