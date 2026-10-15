/**
 * Desktop sign-in. The host writes `~/.stepcode/auth.json` (the file `step
 * login` writes); this module only drives its routes and closes the gate.
 */

import { ApiError, api, apiSend, errorMessage } from "../../lib/api";
import { getDesktopBridge } from "../../platform/host";
import { completeLogin } from "../../state/session";
import type { BrowserLoginState, LoginMethod, LoginReport } from "../../state/types";

const BROWSER_POLL_MS = 1500;

export async function loadLoginMethods(): Promise<readonly LoginMethod[]> {
	return (await api<{ methods: LoginMethod[] }>("/api/v1/login/methods")).methods;
}

/** Open a page in the system browser (Desktop), or a new tab in a plain browser. */
export function openLoginPage(url: string): void {
	const bridge = getDesktopBridge();
	if (bridge) {
		void bridge.openExternal(url).catch(() => window.open(url, "_blank", "noopener,noreferrer"));
		return;
	}
	window.open(url, "_blank", "noopener,noreferrer");
}

async function finishLogin(): Promise<void> {
	completeLogin(await api<LoginReport>("/api/v1/login"));
}

export type ApiKeyOutcome =
	| { readonly kind: "ok" }
	| { readonly kind: "invalid" }
	| { readonly kind: "unavailable" }
	| { readonly kind: "error"; readonly message: string };

/** Validate and save a platform key; the gate closes when it is accepted. */
export async function signInWithApiKey(profile: LoginMethod["id"], apiKey: string): Promise<ApiKeyOutcome> {
	try {
		const result = await apiSend<{ login: LoginReport }>("/api/v1/login/api-key", "POST", { profile, apiKey });
		completeLogin(result.login);
		return { kind: "ok" };
	} catch (caught) {
		if (caught instanceof ApiError && caught.body.code === "invalid_key") return { kind: "invalid" };
		if (caught instanceof ApiError && caught.body.code === "unavailable") return { kind: "unavailable" };
		return { kind: "error", message: errorMessage(caught) };
	}
}

/** Bumped by every start and cancel, so a stale poll loop stops on its own. */
let browserAttempt = 0;

/**
 * Step Plan sign-in: the host starts the same cloud flow as `step login` and
 * hands back the authorize URL, which opens in the system browser. Resolves
 * `completed` after the approval is saved, `cancelled` when the user went back;
 * throws when the sign-in fails.
 */
export async function signInWithBrowser(
	profile: LoginMethod["id"],
	onAuthUrl: (url: string) => void,
): Promise<"completed" | "cancelled"> {
	browserAttempt += 1;
	const attempt = browserAttempt;
	try {
		const started = await apiSend<BrowserLoginState>("/api/v1/login/browser", "POST", { profile });
		if (attempt !== browserAttempt) return "cancelled";
		if (started.authUrl) {
			onAuthUrl(started.authUrl);
			openLoginPage(started.authUrl);
		}
		for (;;) {
			await new Promise((resolve) => setTimeout(resolve, BROWSER_POLL_MS));
			if (attempt !== browserAttempt) return "cancelled";
			const state = await api<BrowserLoginState>("/api/v1/login/browser");
			if (attempt !== browserAttempt) return "cancelled";
			if (state.state === "completed") {
				await finishLogin();
				return "completed";
			}
			if (state.state === "failed") throw new Error(state.error ?? "failed");
			if (state.state === "idle") return "cancelled";
		}
	} catch (caught) {
		// After the user went back, a late failure is not theirs to see.
		if (attempt !== browserAttempt) return "cancelled";
		throw caught;
	}
}

export function cancelBrowserSignIn(): void {
	browserAttempt += 1;
	// Best effort: if this request is lost, the host's sign-in still ends at its
	// own timeout, and the poll loop above has already stopped.
	void apiSend("/api/v1/login/browser", "DELETE").catch(() => {});
}
