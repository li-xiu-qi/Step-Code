/**
 * Feedback topics offered by the composer, and the kernel category each maps to.
 *
 * The kernel accepts five coarse categories and rejects anything outside them,
 * so the UI cannot forward its own labels. Each topic names the nearest kernel
 * category; the topic itself still travels in the comment, so the finer signal
 * is not lost.
 *
 * This module deliberately imports nothing from the kernel so it stays testable
 * on its own — the categories below are a contract, and the server validates the
 * mapped value against the kernel's own list before submitting, so drift fails
 * loudly at runtime rather than silently dropping feedback.
 */
export const FEEDBACK_TOPICS = [
	{ id: "taskResult", category: "good_result" },
	{ id: "instructionFollowing", category: "bad_result" },
	{ id: "productInteraction", category: "other" },
	{ id: "stabilitySpeed", category: "bug" },
	{ id: "resourceCost", category: "other" },
	{ id: "safetyPrivacy", category: "safety_check" },
	{ id: "other", category: "other" },
] as const;

export type FeedbackTopicId = (typeof FEEDBACK_TOPICS)[number]["id"];

const TOPIC_BY_ID = new Map<string, (typeof FEEDBACK_TOPICS)[number]>(
	FEEDBACK_TOPICS.map((topic) => [topic.id, topic]),
);

/**
 * Pick the kernel category for a submission.
 *
 * "Task result" is the one topic whose meaning flips with the sentiment — a
 * thumbs-up on it is a good result and a thumbs-down is a bad one — so it is
 * resolved here rather than fixed in the table.
 */
export function feedbackCategoryFor(sentiment: "up" | "down", topic?: string): string {
	const entry = topic ? TOPIC_BY_ID.get(topic) : undefined;
	if (!entry) return sentiment === "up" ? "good_result" : "bad_result";
	if (entry.id !== "taskResult") return entry.category;
	return sentiment === "up" ? "good_result" : "bad_result";
}
