import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { claimWebSessionWriter } from "../src/writer-lease.ts";

test("Web host writer lease rejects duplicate writers and releases cleanly", () => {
	const directory = mkdtempSync(join(tmpdir(), "stepcode-web-lease-"));
	const sessionFile = join(directory, "session.jsonl");
	try {
		const release = claimWebSessionWriter(sessionFile, "owner-1");
		assert.throws(() => claimWebSessionWriter(sessionFile, "owner-2"), /already open/u);
		release();
		const releaseAgain = claimWebSessionWriter(sessionFile, "owner-2");
		releaseAgain();
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
