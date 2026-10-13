import assert from "node:assert/strict";
import test from "node:test";
import { FEEDBACK_TOPICS, feedbackCategoryFor } from "../src/feedback.ts";

/** Mirrors the kernel's accepted set; see feedback.ts for why it lives here too. */
const KERNEL_CATEGORIES = ["bug", "bad_result", "good_result", "safety_check", "other"];

test("every offered topic maps to a category the kernel accepts", () => {
	for (const topic of FEEDBACK_TOPICS) {
		assert.ok(KERNEL_CATEGORIES.includes(topic.category), `${topic.id} -> ${topic.category}`);
	}
});

test("task result flips with the sentiment, everything else is fixed", () => {
	assert.equal(feedbackCategoryFor("up", "taskResult"), "good_result");
	assert.equal(feedbackCategoryFor("down", "taskResult"), "bad_result");
	assert.equal(feedbackCategoryFor("up", "instructionFollowing"), "bad_result");
	assert.equal(feedbackCategoryFor("down", "instructionFollowing"), "bad_result");
	assert.equal(feedbackCategoryFor("down", "stabilitySpeed"), "bug");
	assert.equal(feedbackCategoryFor("down", "safetyPrivacy"), "safety_check");
	assert.equal(feedbackCategoryFor("up", "productInteraction"), "other");
});

test("no topic falls back to the sentiment alone", () => {
	assert.equal(feedbackCategoryFor("up"), "good_result");
	assert.equal(feedbackCategoryFor("down"), "bad_result");
});

test("an unknown topic is treated as no topic rather than crashing", () => {
	assert.equal(feedbackCategoryFor("down", "not-a-topic"), "bad_result");
});

test("every mapping result is a category the kernel accepts", () => {
	for (const sentiment of ["up", "down"] as const) {
		for (const topic of [...FEEDBACK_TOPICS.map((entry) => entry.id), undefined]) {
			const category = feedbackCategoryFor(sentiment, topic);
			assert.ok(KERNEL_CATEGORIES.includes(category), `${sentiment}/${topic} -> ${category}`);
		}
	}
});
