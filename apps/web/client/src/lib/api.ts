/**
 * JSON fetch wrapper for the StepCode Web host API (legacy app.js `api()`).
 *
 * Every request carries `content-type: application/json`; a non-2xx response
 * throws an Error whose message is the server's `error` field (or `HTTP <n>`).
 * A 401 additionally triggers the registered unauthorized handler, which the
 * session layer uses to show the "connection lost" banner: the launch token is
 * single-use, so a stale cookie is an expected state, not a bug.
 */

type UnauthorizedHandler = () => void;

let unauthorizedHandler: UnauthorizedHandler | undefined;

/** Register the callback run on every 401 response. Pass undefined to clear it. */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | undefined): void {
	unauthorizedHandler = handler;
}

export async function api<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
	const response = await fetch(path, {
		...options,
		headers: { "content-type": "application/json", ...((options.headers as Record<string, string>) ?? {}) },
	});
	if (response.status === 401) unauthorizedHandler?.();
	if (!response.ok) {
		const payload = (await response.json().catch(() => ({}))) as { error?: string };
		throw new Error(payload.error ?? `HTTP ${response.status}`);
	}
	return (await response.json()) as T;
}

/** POST/PATCH/DELETE helper: `api(path, { method, body: JSON.stringify(body) })`. */
export function apiSend<T = unknown>(path: string, method: string, body?: unknown): Promise<T> {
	return api<T>(path, body === undefined ? { method } : { method, body: JSON.stringify(body) });
}

/** Build a workspace-scoped API URL; `cwd` selects the folder, not a session (legacy `workspaceApi`). */
export function workspaceApi(cwd: string, endpoint: string, params: Record<string, string> = {}): string {
	return `/api/v1/workspace${endpoint}?${new URLSearchParams({ cwd, ...params })}`;
}

/** Message of a caught value, as the legacy code read `error.message`. */
export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
