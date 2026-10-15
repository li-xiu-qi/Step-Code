import { mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute } from "node:path";

export interface WebWorkspace {
	readonly path: string;
	readonly name: string;
	/** False when the directory has since been moved or deleted. */
	readonly available: boolean;
	/** Explicitly removed from workspace navigation; sessions remain intact. */
	readonly hidden?: boolean;
}

/** File name of the registry inside the StepCode agent directory. */
export const WORKSPACES_FILE = "web-workspaces.json";

async function isDirectory(path: string): Promise<boolean> {
	try {
		return (await stat(path)).isDirectory();
	} catch {
		return false;
	}
}

/**
 * Folders the user added as workspaces, independent of whether they hold a
 * session yet.
 *
 * Sessions already imply a workspace through their cwd, but that leaves no way
 * to keep an empty folder in the sidebar: it vanishes on reload until the first
 * message is sent. The registry is Web Host metadata only; it never touches
 * session files or the folders themselves.
 */
export class WorkspaceRegistry {
	private readonly file: string;
	private paths: string[] = [];
	private removed: string[] = [];
	private loaded = false;

	constructor(file: string) {
		this.file = file;
	}

	private async load(): Promise<void> {
		if (this.loaded) return;
		this.loaded = true;
		try {
			const parsed: unknown = JSON.parse(await readFile(this.file, "utf8"));
			const stored = (parsed as { workspaces?: unknown } | null)?.workspaces;
			if (Array.isArray(stored)) {
				this.paths = [...new Set(stored.filter((entry): entry is string => typeof entry === "string" && !!entry))];
			}
			const removed = (parsed as { removedWorkspaces?: unknown } | null)?.removedWorkspaces;
			if (Array.isArray(removed)) {
				this.removed = [
					...new Set(removed.filter((entry): entry is string => typeof entry === "string" && isAbsolute(entry))),
				];
				this.paths = this.paths.filter((path) => !this.removed.includes(path));
			}
		} catch {
			// Missing or malformed metadata must not stop the host; start empty.
		}
	}

	private async save(): Promise<void> {
		await mkdir(dirname(this.file), { recursive: true });
		const temporary = `${this.file}.${process.pid}.tmp`;
		await writeFile(
			temporary,
			`${JSON.stringify({ workspaces: this.paths, removedWorkspaces: this.removed }, null, 2)}\n`,
			"utf8",
		);
		await rename(temporary, this.file);
	}

	async list(): Promise<WebWorkspace[]> {
		await this.load();
		return Promise.all(
			[...this.paths, ...this.removed].map(async (path) => ({
				path,
				name: basename(path) || path,
				available: await isDirectory(path),
				...(this.removed.includes(path) ? { hidden: true } : {}),
			})),
		);
	}

	async has(path: string): Promise<boolean> {
		await this.load();
		return this.paths.includes(path);
	}

	/** Register a folder by its real path, so two spellings cannot list it twice. */
	async add(inputPath: string): Promise<WebWorkspace> {
		await this.load();
		if (!inputPath.trim()) throw new Error("path is required");
		let path: string;
		try {
			path = await realpath(inputPath);
		} catch {
			throw new Error("Folder does not exist");
		}
		if (!(await isDirectory(path))) throw new Error("Path is not a directory");
		// Newest first: the folder just added is the one the user wants to see at the top of the sidebar.
		if (this.paths[0] !== path) {
			const previousPaths = this.paths;
			const previousRemoved = this.removed;
			this.removed = this.removed.filter((entry) => entry !== path);
			this.paths = [path, ...this.paths.filter((entry) => entry !== path)];
			try {
				await this.save();
			} catch (error) {
				this.paths = previousPaths;
				this.removed = previousRemoved;
				throw error;
			}
		}
		return { path, name: basename(path) || path, available: true };
	}

	/** Hide registered and session-derived workspaces without touching sessions or files. Idempotent for retries. */
	async remove(path: string): Promise<boolean> {
		await this.load();
		if (!isAbsolute(path)) return false;
		if (this.removed.includes(path)) return true;
		const previous = this.paths;
		this.paths = this.paths.filter((entry) => entry !== path);
		this.removed = [...this.removed, path];
		try {
			await this.save();
		} catch (error) {
			this.paths = previous;
			this.removed = this.removed.filter((entry) => entry !== path);
			throw error;
		}
		return true;
	}
}
