/**
 * Small JSON state file under Electron's userData directory.
 *
 * Holds what the shell needs across launches: the window bounds and the last
 * folder the user picked (the default workspace for the next server start).
 * Sessions, workspaces and credentials stay where the CLI and web host keep
 * them; this file is never a second source of truth for those.
 */

import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";

export interface WindowState {
	readonly x?: number;
	readonly y?: number;
	readonly width: number;
	readonly height: number;
	readonly maximized: boolean;
}

export interface DesktopState {
	readonly window?: WindowState;
	readonly lastWorkspace?: string;
}

function finite(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function parseWindowState(value: unknown): WindowState | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const raw = value as Record<string, unknown>;
	if (!finite(raw.width) || !finite(raw.height) || raw.width < 200 || raw.height < 200) return undefined;
	const positioned = finite(raw.x) && finite(raw.y);
	return {
		...(positioned ? { x: Math.round(raw.x as number), y: Math.round(raw.y as number) } : {}),
		width: Math.round(raw.width),
		height: Math.round(raw.height),
		maximized: raw.maximized === true,
	};
}

export class DesktopStateStore {
	private readonly path: string;
	private state: DesktopState;

	constructor(path: string) {
		this.path = path;
		this.state = this.load();
	}

	get(): DesktopState {
		return this.state;
	}

	/** The last picked folder, when it still exists. */
	lastWorkspace(): string | undefined {
		const path = this.state.lastWorkspace;
		if (path === undefined || !isAbsolute(path)) return undefined;
		try {
			return statSync(path).isDirectory() ? path : undefined;
		} catch {
			return undefined;
		}
	}

	update(patch: Partial<DesktopState>): void {
		this.state = { ...this.state, ...patch };
		try {
			mkdirSync(dirname(this.path), { recursive: true });
			const temporary = `${this.path}.${process.pid}.tmp`;
			writeFileSync(temporary, `${JSON.stringify(this.state, null, "\t")}\n`, "utf8");
			renameSync(temporary, this.path);
		} catch (error) {
			// Losing window bounds is not worth interrupting the user over.
			console.warn("stepcode desktop: could not persist state", error);
		}
	}

	private load(): DesktopState {
		try {
			const raw: unknown = JSON.parse(readFileSync(this.path, "utf8"));
			if (typeof raw !== "object" || raw === null) return {};
			const record = raw as Record<string, unknown>;
			const window = parseWindowState(record.window);
			const lastWorkspace = typeof record.lastWorkspace === "string" ? record.lastWorkspace : undefined;
			return {
				...(window === undefined ? {} : { window }),
				...(lastWorkspace === undefined ? {} : { lastWorkspace }),
			};
		} catch {
			return {};
		}
	}
}
