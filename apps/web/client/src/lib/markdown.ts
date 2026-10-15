/**
 * Minimal Markdown renderer and text helpers (legacy app.js `escapeHtml`,
 * `contentText`, `renderMarkdown`).
 *
 * The renderer is deliberately tiny: fenced code blocks, `#`/`##`/`###`
 * headings, `**bold**`, inline code, line breaks and paragraph gaps. Everything else is
 * escaped. Its output is an HTML string meant for `dangerouslySetInnerHTML`
 * (see ui/MarkdownView, which also wires the `.copy-code` buttons).
 */

const HTML_ESCAPES: Readonly<Record<string, string>> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&#39;",
};

export function escapeHtml(value: unknown): string {
	return String(value).replace(/[&<>"']/g, (character) => HTML_ESCAPES[character] ?? character);
}

/** Text of a message `content` value: a string, or the text parts of a content array. */
export function contentText(value: unknown): string {
	if (typeof value === "string") return value;
	if (!Array.isArray(value)) return "";
	return value
		.filter((part): part is { type: "text"; text: string } => part?.type === "text")
		.map((part) => part.text)
		.join("");
}

export interface MarkdownLabels {
	/** Header label of a fenced block without a language (legacy `t("code")`). */
	readonly code: string;
	/** Text of the copy button in each code block header (legacy `t("copy")`). */
	readonly copy: string;
}

export function renderMarkdown(value: unknown, labels: MarkdownLabels): string {
	const blocks: string[] = [];
	const source = String(value).replace(/```([^\n]*)\n([\s\S]*?)```/g, (_match, language: string, code: string) => {
		const label = language.trim() || labels.code;
		const index =
			blocks.push(
				`<div class="code-block"><div class="code-block-header"><span>${escapeHtml(label)}</span><button class="copy-code" type="button">${labels.copy}</button></div><pre><code>${escapeHtml(code)}</code></pre></div>`,
			) - 1;
		return `\u0000${index}\u0000`;
	});
	const html = escapeHtml(source.replace(/\n{3,}/g, "\n\n"))
		.replace(/^### (.+)$/gm, "<h4>$1</h4>")
		.replace(/^## (.+)$/gm, "<h3>$1</h3>")
		.replace(/^# (.+)$/gm, "<h2>$1</h2>")
		.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
		.replace(/`([^`]+)`/g, "<code>$1</code>")
		// Headings and code blocks are blocks: the line breaks around them would only add empty lines.
		.replace(/\n*(<h[234]>.*?<\/h[234]>|\u0000\d+\u0000)\n*/g, "$1")
		// A blank line separates paragraphs with a small gap rather than a whole empty line.
		.replace(/\n\n/g, '<span class="md-gap"></span>')
		.replace(/\n/g, "<br>");
	return html.replace(/\u0000(\d+)\u0000/g, (_match, index: string) => blocks[Number(index)] ?? "");
}
