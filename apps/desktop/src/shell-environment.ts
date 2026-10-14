/**
 * Login-shell environment for GUI launches on macOS and Linux.
 *
 * Problem: an app started from Finder, the Dock or a desktop launcher inherits
 * the session manager's environment, e.g. PATH=/usr/bin:/bin:/usr/sbin:/sbin.
 * The agent's bash tool would then not find git, node, pnpm or Homebrew tools
 * that work in the user's terminal, so the desktop would behave differently
 * from the CLI.
 *
 * Solution: run the user's login shell once (`$SHELL -ilc`), print its
 * environment between delimiters, and overlay it on the inherited one before
 * starting the web server. Windows GUI apps already inherit the registry
 * environment, so nothing is done there. Failures fall back to the inherited
 * environment; they never block startup beyond the timeout.
 */

import { spawn } from "node:child_process";
import { homedir, userInfo } from "node:os";

const DELIMITER = "_STEPCODE_SHELL_ENV_DELIMITER_";
const DUMP = `printf '\\0%s\\0' '${DELIMITER}'; command env -0 || exit; printf '\\0%s\\0' '${DELIMITER}'; exit`;
/** Keep oh-my-zsh update prompts and tmux autostart plugins from blocking a non-terminal read. */
const PROBE_ENVIRONMENT = { DISABLE_AUTO_UPDATE: "true", ZSH_TMUX_AUTOSTARTED: "true", ZSH_TMUX_AUTOSTART: "false" };
/** Variables that describe the probe shell process rather than the user's configuration. */
const SESSION_KEYS = new Set(["PWD", "OLDPWD", "SHLVL", "_", ...Object.keys(PROBE_ENVIRONMENT)]);
/** Variables the launcher owns; the shell must not override them. */
const LAUNCHER_PREFIXES = ["ELECTRON_", "STEPCODE_DESKTOP_", "STEPCODE_WEB_"];
const DEFAULT_TIMEOUT_MS = 8_000;

export interface ShellEnvironmentResult {
	readonly environment: NodeJS.ProcessEnv;
	/** Why the shell environment was not used, or undefined when it was. */
	readonly skipped?: string;
}

/** Extract the variables printed between the two delimiters. */
export function parseShellEnvironment(stdout: string): Record<string, string> | undefined {
	const parts = stdout.split("\0");
	const first = parts.indexOf(DELIMITER);
	const last = parts.lastIndexOf(DELIMITER);
	if (first === -1 || first === last) return undefined;
	const variables: Record<string, string> = {};
	for (const entry of parts.slice(first + 1, last)) {
		const separator = entry.indexOf("=");
		if (separator > 0) variables[entry.slice(0, separator)] = entry.slice(separator + 1);
	}
	return variables;
}

function loginShell(env: NodeJS.ProcessEnv): string {
	try {
		const shell = userInfo().shell;
		if (shell) return shell;
	} catch {
		// No account record for this uid.
	}
	return env.SHELL || "/bin/zsh";
}

function readShell(
	shell: string,
	base: NodeJS.ProcessEnv,
	timeoutMs: number,
): Promise<Record<string, string> | string> {
	return new Promise((resolve) => {
		let settled = false;
		const chunks: Buffer[] = [];
		const child = spawn(shell, ["-ilc", DUMP], {
			cwd: homedir(),
			env: { ...base, ...PROBE_ENVIRONMENT },
			stdio: ["ignore", "pipe", "ignore"],
			detached: true,
		});
		const finish = (result: Record<string, string> | string): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			// Keep draining so rc-started background children do not fail with EPIPE.
			child.stdout.resume();
			resolve(result);
		};
		const timer = setTimeout(() => {
			finish("timeout");
			try {
				if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
			} catch {
				// The group already exited.
			}
		}, timeoutMs);
		child.stdout.on("data", (chunk: Buffer) => {
			chunks.push(chunk);
			// Background children started by rc files can hold stdout open after
			// the shell exits, so finish at the closing delimiter, not at `close`.
			const parsed = parseShellEnvironment(Buffer.concat(chunks).toString("utf8"));
			if (parsed !== undefined) finish(parsed);
		});
		child.on("error", (error) => finish(error.message));
		child.on("close", (code, signal) => {
			if (code !== 0) finish(signal ?? `exit ${String(code)}`);
			else finish(parseShellEnvironment(Buffer.concat(chunks).toString("utf8")) ?? "unparsed");
		});
	});
}

/**
 * Read the login-shell environment once. Never rejects.
 *
 * Skipped on Windows, when `STEPCODE_DESKTOP_SHELL_ENV=0`, and when the app was
 * started from a terminal (`TERM_PROGRAM` / `TERM` set), which already carries
 * the user's shell environment.
 */
export async function readShellEnvironment(base: NodeJS.ProcessEnv): Promise<ShellEnvironmentResult> {
	if (process.platform === "win32") return { environment: base, skipped: "windows" };
	if (base.STEPCODE_DESKTOP_SHELL_ENV === "0") return { environment: base, skipped: "disabled" };
	if (base.STEPCODE_DESKTOP_SHELL_ENV !== "1" && (base.TERM_PROGRAM || base.TERM)) {
		return { environment: base, skipped: "terminal launch" };
	}
	const timeout = Number.parseInt(base.STEPCODE_DESKTOP_SHELL_ENV_TIMEOUT_MS ?? "", 10);
	const shell = loginShell(base);
	const result = await readShell(shell, base, Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS);
	if (typeof result === "string") return { environment: base, skipped: `${shell}: ${result}` };
	const merged: NodeJS.ProcessEnv = { ...base };
	for (const [key, value] of Object.entries(result)) {
		if (SESSION_KEYS.has(key) || LAUNCHER_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
		merged[key] = value;
	}
	return { environment: merged };
}
