import { resolve } from "node:path";

const writers = new Map<string, string>();

/**
 * Prevents two Web session objects in one Host process from appending to the
 * same StepCode v3 JSONL file. This is deliberately process-local; older CLI
 * processes do not participate in this lease.
 */
export function claimWebSessionWriter(sessionFile: string, ownerId: string): () => void {
	const path = resolve(sessionFile);
	if (writers.has(path)) throw new Error(`Session is already open for writing in this Web host: ${path}`);
	writers.set(path, ownerId);
	let released = false;
	return () => {
		if (released) return;
		released = true;
		if (writers.get(path) === ownerId) writers.delete(path);
	};
}
