import assert from "node:assert/strict";
import test from "node:test";
import { ApprovalBroker } from "../src/approval.ts";

test("approval broker supports deny, allow once, and session allow", async () => {
	const events: unknown[] = [];
	const broker = new ApprovalBroker("session-1", (event) => events.push(event));

	const denied = broker.confirm("bash", "deny this");
	assert.equal(events.length, 1);
	const first = events[0] as { approval: { id: string } };
	assert.equal(broker.decide(first.approval.id, "deny"), true);
	assert.equal(await denied, false);

	const allowed = broker.confirm("edit", "allow this");
	const second = events[1] as { approval: { id: string } };
	assert.equal(broker.decide(second.approval.id, "approve"), true);
	assert.equal(await allowed, true);

	const remembered = broker.confirm("write", "remember this");
	const third = events[2] as { approval: { id: string } };
	assert.equal(broker.decide(third.approval.id, "approve_for_session"), true);
	assert.equal(await remembered, true);
	assert.equal(await broker.confirm("write", "should not prompt"), true);
	assert.equal(broker.decide("missing", "approve"), false);
});

test("approval broker projects edit before/after preview from the captured tool call", async () => {
	const events: unknown[] = [];
	const broker = new ApprovalBroker("session-2", (event) => events.push(event));
	broker.captureToolCall("tool-12345678", "edit_file", {
		path: "src/example.ts",
		edits: [{ oldText: "before", newText: "after" }],
	});

	const approval = broker.confirm("Approve edit_file [12345678]", "Call: tool-12345678");
	const event = events[0] as {
		approval: { id: string; preview?: { path?: string; before?: string; after?: string } };
	};
	assert.deepEqual(event.approval.preview, { path: "src/example.ts", before: "before", after: "after" });
	assert.equal(broker.decide(event.approval.id, "deny"), true);
	assert.equal(await approval, false);
});
