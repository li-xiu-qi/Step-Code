import assert from "node:assert/strict";
import test from "node:test";
import { renderMarkdown } from "../client/src/lib/markdown.ts";

const labels = { code: "Code", copy: "Copy" };

test("renders named sources with escaped URLs and safe new-tab attributes", () => {
	const html = renderMarkdown("- [今日金价](https://example.com/price?a=1&b=2)", labels);
	assert.equal(
		html,
		'<span class="md-li"><a href="https://example.com/price?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">今日金价</a></span>',
	);
});

test("supports parentheses in destinations and bare URLs beside punctuation", () => {
	const html = renderMarkdown(
		"[Source](https://example.com/wiki/Gold_(metal)) (https://example.com/price). https://example.com/报价。",
		labels,
	);
	assert.match(html, /href="https:\/\/example.com\/wiki\/Gold_\(metal\)"/);
	assert.match(html, /href="https:\/\/example.com\/price"[^>]*>https:\/\/example.com\/price<\/a>\)\./);
	assert.match(html, /href="https:\/\/example.com\/报价"[^>]*>https:\/\/example.com\/报价<\/a>。/);
});

test("preserves inline and fenced code without links or emphasis", () => {
	const html = renderMarkdown(
		"`[**Source**](https://example.com)`\n\n```md\n[Source](https://example.com)\n```",
		labels,
	);
	assert.doesNotMatch(html, /<a |<strong>/);
	assert.match(html, /<code>\[\*\*Source\*\*\]\(https:\/\/example.com\)<\/code>/);
	assert.match(html, /<pre><code>\[Source\]\(https:\/\/example.com\)<\/code><\/pre>/);
});

test("rejects executable and local destinations while escaping HTML and attributes", () => {
	for (const url of ["javascript:alert(1)", "data:text/html,evil", "file:///tmp/example", "//example.com"]) {
		assert.doesNotMatch(renderMarkdown(`[Source](${url})`, labels), /<a /);
	}
	const html = renderMarkdown('[<img src=x onerror=alert(1)>](https://example.com/"onclick="evil)', labels);
	assert.doesNotMatch(html, /<img|"onclick=/);
	assert.match(html, /&lt;img/);
	assert.match(html, /&quot;onclick=&quot;/);
});

test("handles incomplete streaming Markdown and keeps surrounding formatting", () => {
	assert.equal(renderMarkdown("[Source](https://", labels), "[Source](https://");
	assert.equal(
		renderMarkdown("## Sources\n**Read [source](https://example.com)**", labels),
		'<h3>Sources</h3><strong>Read <a href="https://example.com" target="_blank" rel="noopener noreferrer">source</a></strong>',
	);
});
