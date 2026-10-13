import { mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";

export interface WebWorkspace {
	readonly path: string;
	readonly name: string;
	/** False when the directory has since been moved or deleted. */
	readonly available: boolean;
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
		} catch {
			// Missing or malformed metadata must not stop the host; start empty.
		}
	}

	private async save(): Promise<void> {
		await mkdir(dirname(this.file), { recursive: true });
		const temporary = `${this.file}.${process.pid}.tmp`;
		await writeFile(temporary, `${JSON.stringify({ workspaces: this.paths }, null, 2)}\n`, "utf8");
		await rename(temporary, this.file);
	}

	async list(): Promise<WebWorkspace[]> {
		await this.load();
		return Promise.all(
			this.paths.map(async (path) => ({ path, name: basename(path) || path, available: await isDirectory(path) })),
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
		if (!this.paths.includes(path)) {
			this.paths.push(path);
			await this.save();
		}
		return { path, name: basename(path) || path, available: true };
	}

	/** Unregister a folder. Returns false when it was not registered. */
	async remove(path: string): Promise<boolean> {
		await this.load();
		if (!this.paths.includes(path)) return false;
		this.paths = this.paths.filter((entry) => entry !== path);
		await this.save();
		return true;
	}
}
