import { existsSync, readFileSync } from "node:fs";
import type { StepLoginStatus } from "@step-harness/coding-agent";

/**
 * What the browser is allowed to know about the model credential.
 *
 * StepCode Web has no login screen: signing in is a terminal action
 * (`step login`) that writes `auth.json`, and the host reuses it. The UI still
 * has to explain where its credential comes from when a request fails, so this
 * reports the source and the shape — never the secret itself. There is no field
 * here that can carry a token.
 */
export interface LoginReport {
	/** Environment variable that supplies the credential, when one does. */
	readonly source: "environment" | "auth.json" | "none";
	/** Provider id the credential belongs to, e.g. `step`. */
	readonly provider?: string;
	/** Login profile recorded at sign-in, e.g. `step_plan`. */
	readonly profile?: string;
	/** Where the credential lives, for a "run this in a terminal" hint. */
	readonly path?: string;
	/** True when a credential exists, whatever the provider says about it. */
	readonly configured: boolean;
	/**
	 * What the provider said when the credential was checked: `valid`, `invalid`
	 * (rejected), or `unavailable` (could not be reached, so unknown). Absent
	 * when no check was possible.
	 */
	readonly validity?: StepLoginStatus["validity"];
	/** The one command that changes this state. */
	readonly loginCommand: string;
}

export interface LoginReportInput {
	/** Result of the product's own credential inspection. */
	readonly status: StepLoginStatus;
	/** Credential file path, reported as-is (it is a path, not a secret). */
	readonly authPath: string;
	readonly env?: NodeJS.ProcessEnv;
	/** Overridable so tests do not touch the real filesystem. */
	readonly read?: (path: string) => string;
	readonly exists?: (path: string) => boolean;
}

/** The environment key the loopback host resolves a Step credential from first. */
const ENVIRONMENT_KEY = "STEP_API_KEY";

/**
 * Whether a usable credential is stored, independent of the network.
 *
 * `getStepLoginStatus` reports `loggedIn: false` when the provider cannot be
 * reached, which is the wrong question here: the credential is still on disk
 * and the next request may well succeed. Only the shape is read, never the
 * token.
 */
function storedCredential(authPath: string, read: (path: string) => string): { profile?: string } | undefined {
	try {
		const parsed: unknown = JSON.parse(read(authPath));
		const entry = (
			parsed as Record<string, { type?: unknown; access?: unknown; key?: unknown; profile?: unknown } | null>
		)?.step;
		if (!entry || (entry.type !== "oauth" && entry.type !== "api_key")) return undefined;
		const secret = entry.type === "oauth" ? entry.access : entry.key;
		if (typeof secret !== "string" || !secret.trim()) return undefined;
		const profile = typeof entry.profile === "string" && entry.profile.trim() ? entry.profile.trim() : undefined;
		return { ...(profile ? { profile } : {}) };
	} catch {
		// Missing or malformed: treated as no credential, which the UI reports as
		// "sign in from a terminal" — the same remedy either way.
		return undefined;
	}
}

/**
 * Project the kernel's login status into the browser-safe report.
 *
 * Presence comes from the filesystem or the environment; reachability comes
 * from the kernel's check. Keeping them apart matters because they need
 * different advice: an unreachable provider is not something a user fixes by
 * signing in again, and an expired token is.
 */
export function buildLoginReport(input: LoginReportInput): LoginReport {
	const env = input.env ?? process.env;
	const read = input.read ?? ((path: string) => readFileSync(path, "utf8"));
	const exists = input.exists ?? existsSync;
	const viaEnvironment = (env[ENVIRONMENT_KEY] ?? "").trim() !== "";
	const stored = viaEnvironment ? undefined : storedCredential(input.authPath, read);
	const configured = viaEnvironment || stored !== undefined || input.status.loggedIn === true;
	const profile = stored?.profile ?? input.status.profile;
	return {
		source: !configured ? "none" : viaEnvironment ? "environment" : "auth.json",
		...(configured ? { provider: "step" } : {}),
		...(configured && profile ? { profile } : {}),
		// The path is worth naming only when it is the thing to go and look at.
		...(configured && !viaEnvironment && exists(input.authPath) ? { path: input.authPath } : {}),
		configured,
		// A check ran only when the kernel reached a verdict; an unreachable
		// provider reports "unavailable", not a failure of the credential.
		...(configured ? { validity: input.status.validity } : {}),
		loginCommand: "step login",
	};
}
