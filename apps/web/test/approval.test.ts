import assert from "node:assert/strict";
import test from "node:test";
import { ApprovalBroker, type ApprovalRequest } from "../src/approval.ts";

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

test("approval broker lists undecided requests so a snapshot can show them again", async () => {
	const events: unknown[] = [];
	const broker = new ApprovalBroker("session-3", (event) => events.push(event));
	const controller = new AbortController();
	const first = broker.confirm("write", "first");
	const second = broker.confirm("bash", "second", controller.signal);
	assert.deepEqual(
		broker.pendingRequests().map((request) => request.message),
		["first", "second"],
	);
	broker.decide((events[0] as { approval: { id: string } }).approval.id, "approve");
	controller.abort();
	assert.equal(await first, true);
	assert.equal(await second, false);
	assert.deepEqual(broker.pendingRequests(), []);
});

test("approval snapshots expose the full command and separate the policy reason from diagnostics", async () => {
	const broker = new ApprovalBroker("command-session", () => {});
	const command = `printf '%s' '${"long argument ".repeat(100)}'\nprintf 'done\\n'`;
	broker.captureToolCall("tool-abcdefgh", "bash", { command, timeout: 30 });
	const result = broker.confirm("bash [abcdefgh]", "Call: tool-abcdefgh\nSpecific policy reason\n\nclipped command...\n\nBatch calls may ask separately");
	const [request] = broker.pendingRequests();
	assert.equal(request.input?.command, command);
	assert.equal(request.reason, "Specific policy reason");
	const wire = JSON.parse(JSON.stringify(request)) as ApprovalRequest;
	assert.equal(wire.input?.command, command);
	broker.decide(request.id, "deny");
	assert.equal(await result, false);
});

test("session allow applies to later calls with a different id for the same captured tool", async () => {
	const broker = new ApprovalBroker("remember-session", () => {});
	broker.captureToolCall("tool-first123", "bash", { command: "printf first" });
	const reason = "bash can modify the workspace or execute a command";
	const first = broker.confirm("bash [first123]", `Call: tool-first123\n${reason}`);
	broker.decide(broker.pendingRequests()[0].id, "approve_for_session");
	assert.equal(await first, true);
	broker.captureToolCall("tool-next4567", "bash", { command: "printf next" });
	assert.equal(await broker.confirm("bash [next4567]", `Call: tool-next4567\n${reason}`), true);
	assert.deepEqual(broker.pendingRequests(), []);
	const other = broker.confirm("edit", "different tool still asks");
	assert.equal(broker.pendingRequests().length, 1);
	broker.clear();
	assert.equal(await other, false);
});

test("a session grant never suppresses specific danger or incomplete-analysis prompts", async () => {
	const broker = new ApprovalBroker("policy-session", () => {});
	const first = broker.confirm("bash", "routine");
	broker.decide(broker.pendingRequests()[0].id, "approve_for_session");
	assert.equal(await first, true);
	for (const reason of ["Dangerous command requires confirmation (rule): rm -rf folder", "Shell command could not be fully analyzed (unsupported-shell); explicit approval is required."]) {
		broker.captureToolCall("tool-abcd1234", "bash", { command: "fixture" });
		const pending = broker.confirm("bash [abcd1234]", `Call: tool-abcd1234\n${reason}`);
		assert.equal(broker.pendingRequests().length, 1);
		broker.decide(broker.pendingRequests()[0].id, "deny");
		assert.equal(await pending, false);
	}
});
