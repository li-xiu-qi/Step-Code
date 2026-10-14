/**
 * The two pages the shell shows itself: "starting" while the server boots,
 * and an error page when it cannot start or stops unexpectedly. Both are
 * self-contained data: URLs, so they render without the server.
 */

const LIGHT = { canvas: "#ffffff", ink: "#171718", muted: "#6b6b70", code: "#f5f5f6" };
const DARK = { canvas: "#181819", ink: "#f1f1f2", muted: "#a1a1a6", code: "#272729" };

/** Window background before any page paints; matches the web client's --canvas token. */
export function canvasColor(dark: boolean): string {
	return dark ? DARK.canvas : LIGHT.canvas;
}

function escapeHtml(text: string): string {
	return text.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

function page(title: string, body: string): string {
	const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
:root { color-scheme: light dark; --canvas: ${LIGHT.canvas}; --ink: ${LIGHT.ink}; --muted: ${LIGHT.muted}; --code: ${LIGHT.code}; }
@media (prefers-color-scheme: dark) {
	:root { --canvas: ${DARK.canvas}; --ink: ${DARK.ink}; --muted: ${DARK.muted}; --code: ${DARK.code}; }
}
html, body { margin: 0; height: 100%; background: var(--canvas); color: var(--ink);
	font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
body { display: grid; place-items: center; -webkit-app-region: drag; }
main { max-width: 640px; padding: 32px; -webkit-app-region: no-drag; }
h1 { font-size: 18px; font-weight: 600; margin: 0 0 8px; }
p { color: var(--muted); margin: 0 0 12px; }
pre { background: var(--code); border-radius: 8px; padding: 12px; max-height: 320px; overflow: auto;
	white-space: pre-wrap; word-break: break-word; font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
.spinner { width: 20px; height: 20px; margin: 0 auto 12px; border-radius: 50%;
	border: 2px solid var(--muted); border-top-color: transparent; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.center { text-align: center; }
</style></head><body><main>${body}</main></body></html>`;
	return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

export function loadingPageUrl(): string {
	return page("StepCode", `<div class="center"><div class="spinner"></div><p>Starting StepCode…</p></div>`);
}

export function errorPageUrl(title: string, detail: string, logPath: string): string {
	return page(
		"StepCode",
		`<h1>${escapeHtml(title)}</h1>
<p>Use File → Restart Server to try again. The server log is at <code>${escapeHtml(logPath)}</code>.</p>
<pre>${escapeHtml(detail)}</pre>`,
	);
}
