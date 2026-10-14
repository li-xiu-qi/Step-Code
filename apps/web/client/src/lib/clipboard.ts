/**
 * Clipboard write. Throws when the browser refuses (no permission, insecure
 * context). The user-facing wrapper with the "copied" / "copy denied" toast is
 * `copyText` in state/session.ts, which matches legacy app.js `copyText`.
 */
export async function writeClipboard(value: string): Promise<void> {
	await navigator.clipboard.writeText(value);
}
