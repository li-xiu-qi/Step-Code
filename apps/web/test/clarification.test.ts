import assert from "node:assert/strict";
import test from "node:test";
import { ClarificationBroker, type ClarificationEvent, type ClarificationQuestion } from "../src/clarification.ts";

const questions: ClarificationQuestion[] = [
	{ id: "app", label: "App", question: "Which app?", options: [{ label: "Main", value: "main" }], allowFreeform: true },
	{ id: "scope", label: "Scope", question: "Which scope?", options: [], allowFreeform: true },
];

test("clarification broker projects pending questions and derives canonical answers", async () => {
	const events: ClarificationEvent[] = [];
	const broker = new ClarificationBroker(() => "session-1", (event) => events.push(event));
	const result = broker.ask(questions);
	const [request] = broker.pendingRequests();
	assert.equal(request.sessionId, "session-1");
	assert.equal(events[0].type, "clarification_required");
	assert.deepEqual(request.questions, questions);
	assert.equal(broker.respond(request.id, { cancelled: false, answers: [{ id: "app", optionIndex: 0 }, { id: "scope", text: "  custom  " }] }), true);
	assert.deepEqual(await result, { cancelled: false, answers: [
		{ id: "app", value: "main", label: "Main", wasCustom: false, index: 1 },
		{ id: "scope", value: "custom", label: "custom", wasCustom: true },
	] });
	assert.equal(events[1].type, "clarification_resolved");
	assert.equal(broker.respond(request.id, { cancelled: true }), false);
	assert.deepEqual(broker.pendingRequests(), []);
});

test("invalid replies leave the question pending for retry", async () => {
	const broker = new ClarificationBroker(() => "session-2", () => {});
	const result = broker.ask(questions);
	const [{ id }] = broker.pendingRequests();
	for (const answers of [[], [{ id: "wrong", skipped: true }, { id: "scope", skipped: true }],
		[{ id: "app", optionIndex: -1 }, { id: "scope", skipped: true }],
		[{ id: "app", text: " " }, { id: "scope", skipped: true }],
		[{ id: "app", text: "custom", optionIndex: 0 }, { id: "scope", skipped: true }]]) {
		assert.throws(() => broker.respond(id, { cancelled: false, answers }));
		assert.equal(broker.pendingRequests().length, 1);
	}
	broker.respond(id, { cancelled: false, answers: questions.map((question) => ({ id: question.id, skipped: true })) });
	assert.ok((await result).answers.every((answer) => answer.skipped));
});

test("freeform-disabled questions reject custom text", async () => {
	const broker = new ClarificationBroker(() => "session-3", () => {});
	const result = broker.ask([{ ...questions[0], allowFreeform: false }]);
	const [{ id }] = broker.pendingRequests();
	assert.throws(() => broker.respond(id, { cancelled: false, answers: [{ id: "app", text: "custom" }] }));
	broker.respond(id, { cancelled: true });
	assert.deepEqual(await result, { cancelled: true, answers: [] });
});

test("abort, pre-abort and shutdown resolve waiting calls without stale requests", async () => {
	const broker = new ClarificationBroker(() => "session-4", () => {});
	const controller = new AbortController();
	const result = broker.ask(questions, controller.signal);
	controller.abort();
	assert.deepEqual(await result, { cancelled: true, answers: [] });
	assert.deepEqual(await broker.ask(questions, controller.signal), { cancelled: true, answers: [] });
	const first = broker.ask(questions);
	const second = broker.ask(questions);
	broker.clear();
	assert.equal((await first).cancelled, true);
	assert.equal((await second).cancelled, true);
	assert.deepEqual(broker.pendingRequests(), []);
});
