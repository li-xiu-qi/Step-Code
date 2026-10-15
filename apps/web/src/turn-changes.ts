/**
 * File changes per conversation turn.
 *
 * `edit` and `write` record a unified patch in their tool result
 * (`details.patch`, LF without BOM); `write` also records the overwritten
 * file's line ending and BOM, or why it recorded no patch. The client derives
 * each turn's change card from the same details.
 *
 * A turn is the run of entries from one user message to the next. Reverting a
 * turn reverse-applies its patches, newest first, and writes nothing unless
 * every patch still matches the files on disk. Changes without a patch (large
 * or binary files, `bash`) cannot be reverted and are reported as skipped.
 */

import { readFile, unlink, writeFile } from "node:fs/promises";
import {
	detectLineEnding,
	normalizeToLF,
	resolveToCwd,
	restoreLineEndings,
	type SessionEntry,
	type WriteToolDetails,
} from "@step-harness/coding-agent";

function toolPath(input: Readonly<Record<string, unknown>>): string | undefined {
	const value = input.path ?? input.file_path;
	return typeof value === "string" && value.trim() ? value : undefined;
}

/* ── Patches ─────────────────────────────────────────────────────────────── */

interface Hunk {
	readonly newStart: number;
	readonly oldLines: readonly string[];
	readonly newLines: readonly string[];
	/** The last line of that side has no trailing newline ("\ No newline at end of file"). */
	readonly oldNoEol: boolean;
	readonly newNoEol: boolean;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function parseHunks(patch: string): Hunk[] {
	const lines = patch.split("\n");
	const hunks: Hunk[] = [];
	let index = 0;
	while (index < lines.length) {
		const header = HUNK_HEADER.exec(lines[index] ?? "");
		index += 1;
		if (!header) continue;
		let oldCount = header[2] === undefined ? 1 : Number(header[2]);
		let newCount = header[4] === undefined ? 1 : Number(header[4]);
		const oldLines: string[] = [];
		const newLines: string[] = [];
		let oldNoEol = false;
		let newNoEol = false;
		let last: " " | "-" | "+" | undefined;
		while (index < lines.length && (oldCount > 0 || newCount > 0 || lines[index]?.startsWith("\\"))) {
			const line = lines[index] ?? "";
			index += 1;
			const marker = line[0];
			if (marker === "\\") {
				if (last === "-" || last === " ") oldNoEol = true;
				if (last === "+" || last === " ") newNoEol = true;
				continue;
			}
			const text = line.slice(1);
			if (marker === "-") {
				oldLines.push(text);
				oldCount -= 1;
				last = "-";
			} else if (marker === "+") {
				newLines.push(text);
				newCount -= 1;
				last = "+";
			} else {
				oldLines.push(text);
				newLines.push(text);
				oldCount -= 1;
				newCount -= 1;
				last = " ";
			}
		}
		hunks.push({ newStart: Number(header[3]), oldLines, newLines, oldNoEol, newNoEol });
	}
	return hunks;
}

/** Undo `patch` on `content` (LF line endings). Throws when the content no longer matches. */
export function reversePatch(content: string, patch: string): string {
	const lines = content.split("\n");
	const hunks = parseHunks(patch);
	for (const hunk of [...hunks].reverse()) {
		const start = hunk.newLines.length ? hunk.newStart - 1 : hunk.newStart;
		const matches = hunk.newLines.every((line, offset) => lines[start + offset] === line);
		if (!matches || start < 0) throw new Error("content changed since the patch");
		lines.splice(start, hunk.newLines.length, ...hunk.oldLines);
		const after = start + hunk.oldLines.length;
		// Only the trailing newline differs between the two sides of the last line.
		if (hunk.oldNoEol && !hunk.newNoEol && lines[after] === "" && after === lines.length - 1) lines.pop();
		if (hunk.newNoEol && !hunk.oldNoEol && after === lines.length) lines.push("");
	}
	return lines.join("\n");
}

/* ── Turns ───────────────────────────────────────────────────────────────── */

type LineEnding = "\r\n" | "\n";

export interface TurnChange {
	readonly toolCallId: string;
	readonly path: string;
	readonly patch: string;
	readonly created: boolean;
	/** Line ending and BOM of the file a `write` replaced. */
	readonly previous?: { readonly lineEnding: LineEnding; readonly bom: boolean };
}

/** A successful edit/write with no patch to reverse. */
export interface SkippedChange {
	readonly path: string;
	readonly reason: NonNullable<WriteToolDetails["untracked"]> | "unknown";
}

export interface TurnChangeSet {
	readonly changes: readonly TurnChange[];
	readonly skipped: readonly SkippedChange[];
}

function isUserMessage(entry: SessionEntry): boolean {
	return entry.type === "message" && entry.message.role === "user";
}

/** Successful edit/write calls of the turn that starts at the user entry `turnId`, in order. */
export function turnChanges(entries: readonly SessionEntry[], turnId: string): TurnChangeSet {
	const start = entries.findIndex((entry) => entry.id === turnId && isUserMessage(entry));
	const changes: TurnChange[] = [];
	const skipped: SkippedChange[] = [];
	if (start < 0) return { changes, skipped };
	const calls = new Map<string, { name: string; path?: string }>();
	for (const entry of entries.slice(start + 1)) {
		if (isUserMessage(entry)) break;
		if (entry.type !== "message") continue;
		const message = entry.message as {
			role: string;
			content?: unknown;
			toolCallId?: string;
			isError?: boolean;
			details?: unknown;
		};
		if (message.role === "assistant" && Array.isArray(message.content)) {
			for (const part of message.content as Array<Record<string, unknown>>) {
				if (part?.type !== "toolCall") continue;
				const args = (part.arguments ?? {}) as Record<string, unknown>;
				calls.set(String(part.id), { name: String(part.name ?? ""), path: toolPath(args) });
			}
		}
		if (message.role !== "toolResult" || message.isError || !message.toolCallId) continue;
		const call = calls.get(message.toolCallId);
		if (!call?.path || (call.name !== "edit" && call.name !== "write")) continue;
		const details = (message.details ?? {}) as WriteToolDetails;
		if (typeof details.patch !== "string") {
			skipped.push({ path: call.path, reason: details.untracked ?? "unknown" });
			continue;
		}
		const write = call.name === "write";
		changes.push({
			toolCallId: message.toolCallId,
			path: call.path,
			patch: details.patch,
			created: write && details.created === true,
			...(write && details.previous ? { previous: details.previous } : {}),
		});
	}
	return { changes, skipped };
}

interface RevertFile {
	/** LF, without BOM: the view the patches were made against. */
	content: string;
	lineEnding: LineEnding;
	bom: boolean;
	deleted: boolean;
}

/**
 * Reverse-apply a turn's changes. Every file is computed first; nothing is
 * written unless all patches apply. Returns the absolute paths touched.
 */
export async function revertTurnChanges(changes: readonly TurnChange[], cwd: string): Promise<string[]> {
	if (!changes.length) throw new Error("This turn has no file changes that can be reverted");
	const files = new Map<string, RevertFile>();
	for (const change of [...changes].reverse()) {
		const absolute = resolveToCwd(change.path, cwd);
		let file = files.get(absolute);
		if (!file) {
			let raw: string;
			try {
				raw = await readFile(absolute, "utf8");
			} catch {
				throw new Error(`${change.path} no longer exists`);
			}
			const bom = raw.startsWith("\uFEFF");
			const text = bom ? raw.slice(1) : raw;
			file = { content: normalizeToLF(text), lineEnding: detectLineEnding(text), bom, deleted: false };
			files.set(absolute, file);
		}
		if (file.deleted) throw new Error(`${change.path} changed since this turn`);
		try {
			file.content = reversePatch(file.content, change.patch);
		} catch {
			throw new Error(`${change.path} changed since this turn`);
		}
		if (change.created) {
			if (file.content !== "") throw new Error(`${change.path} changed since this turn`);
			file.deleted = true;
		} else if (change.previous) {
			// A write replaced the whole file, line endings and BOM included.
			file.lineEnding = change.previous.lineEnding;
			file.bom = change.previous.bom;
		}
	}
	for (const [absolute, file] of files) {
		if (file.deleted) {
			await unlink(absolute);
			continue;
		}
		const text = restoreLineEndings(file.content, file.lineEnding);
		await writeFile(absolute, file.bom ? `\uFEFF${text}` : text, "utf8");
	}
	return [...files.keys()];
}

/**
 * The reverted turns of one session and the lock around reverting. Checks and
 * writes are asynchronous, so without the lock a second request (double click,
 * another tab) passes the checks while the first is still writing files.
 */
export class TurnReverter {
	private reverted: readonly string[] = [];
	private busy = false;

	/** User entry ids of turns whose file changes were reverted. */
	revertedTurns(): readonly string[] {
		return this.reverted;
	}

	setRevertedTurns(turnIds: readonly string[]): void {
		this.reverted = turnIds;
	}

	/** A revert is writing files or recording its turn. */
	isBusy(): boolean {
		return this.busy;
	}

	/** Revert the turn `turnId`; `record` persists it and returns the new list of reverted turns. */
	async revert(
		turnId: string,
		entries: readonly SessionEntry[],
		cwd: string,
		record: (turnId: string) => Promise<readonly string[]>,
	): Promise<{ paths: string[]; skipped: readonly SkippedChange[] }> {
		if (this.busy) throw new Error("This session is already reverting a turn");
		if (this.reverted.includes(turnId)) throw new Error("This turn was already reverted");
		this.busy = true;
		try {
			const { changes, skipped } = turnChanges(entries, turnId);
			const paths = await revertTurnChanges(changes, cwd);
			this.reverted = await record(turnId);
			return { paths, skipped };
		} finally {
			this.busy = false;
		}
	}
}
