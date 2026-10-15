import assert from "node:assert/strict";
import test from "node:test";
import { releaseIdleSessions } from "../src/runtime.ts";

function fakeSession(busy: boolean, closed: string[], id: string) {
	return {
		isBusy: () => busy,
		close: async () => {
			closed.push(id);
		},
	};
}

test("a sign-in releases idle sessions so they reopen with the new credential, and keeps busy ones", async () => {
	const closed: string[] = [];
	const sessions = new Map([
		["idle-1", fakeSession(false, closed, "idle-1")],
		["running", fakeSession(true, closed, "running")],
		["idle-2", fakeSession(false, closed, "idle-2")],
	]);
	const { released, closed: settled } = releaseIdleSessions(sessions);
	// Gone before any close settles: a request right after sign-in must not get the old object.
	assert.deepEqual([...sessions.keys()], ["running"]);
	assert.deepEqual(
		released.map(([id]) => id),
		["idle-1", "idle-2"],
	);
	await settled;
	assert.deepEqual(closed.sort(), ["idle-1", "idle-2"]);
});

test("a session that fails to close is reported, not thrown, and still forgotten", async () => {
	const sessions = new Map([
		[
			"broken",
			{
				isBusy: () => false,
				close: async () => {
					throw new Error("dispose failed");
				},
			},
		],
	]);
	const results = await releaseIdleSessions(sessions).closed;
	assert.equal(sessions.size, 0);
	assert.equal(results[0]?.status, "rejected");
});
