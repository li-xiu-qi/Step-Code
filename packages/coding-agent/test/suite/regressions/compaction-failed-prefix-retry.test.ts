import { type Context, fauxAssistantMessage } from "@step-harness/providers";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness, type HarnessOptions } from "../harness.ts";

const active: Harness[] = [];
afterEach(() => {
	for (const h of active.splice(0)) h.cleanup();
});

async function setup(extensionFactories?: HarnessOptions["extensionFactories"]) {
	const h = await createHarness({
		extensionFactories,
		models: [{ id: "summary-prefix", contextWindow: 64000, maxTokens: 8192 }],
		settings: {
			compaction: {
				contextProjection: "clm-v1",
				reserveTokens: 32768,
				keepRecentTokens: 10000,
				autoClm: { enabled: false },
			},
			retry: { enabled: false },
		},
	});
	active.push(h);
	for (let i = 0; i < 18; i++) {
		h.sessionManager.appendMessage({ role: "user", content: `Investigate component ${i}`, timestamp: i * 2 });
		h.sessionManager.appendMessage(
			fauxAssistantMessage(`Finding ${i}: ${"old observation ".repeat(560)}`, { timestamp: i * 2 + 1 }),
		);
	}
	h.session.agent.state.messages = h.sessionManager.buildSessionContext().messages;
	return h;
}

describe("failed automatic summary prefixes", () => {
	it("does not restart a spent summary budget just because the retained tail grows", async () => {
		const h = await setup();
		let summaries = 0;
		let actors = 0;
		const summaryInputs: string[] = [];
		const respond = (context: Context) => {
			if (context.systemPrompt?.includes("context summarization assistant")) {
				summaries++;
				summaryInputs.push(JSON.stringify(context.messages.map(({ role, content }) => ({ role, content }))));
				return fauxAssistantMessage("", { stopReason: "error", errorMessage: "Request timed out." });
			}
			actors++;
			return fauxAssistantMessage("A short new finding.");
		};
		h.setResponses(Array.from({ length: 20 }, () => respond));
		await h.session.prompt("Continue the implementation.");
		await h.session.prompt("Check the next component.");
		expect(actors).toBe(2);
		expect(summaries, `summary input variants: ${new Set(summaryInputs).size}`).toBe(1);
		expect(h.eventsOfType("compaction_start")).toHaveLength(1);
		expect(h.session.messages.at(-1)).toMatchObject({ role: "assistant", stopReason: "stop" });

		// Enough new retained content changes the summarized prefix and permits a
		// new budget, rather than permanently disabling automatic compaction.
		await h.session.prompt(`New evidence: ${"additional observation ".repeat(1500)}`);
		await h.session.prompt("Use the newly recorded evidence.");
		expect(actors).toBe(4);
		expect(summaries).toBe(2);

		// An explicit user retry is independent of the automatic failure guard.
		h.setResponses([
			fauxAssistantMessage("Explicitly retried summary."),
			fauxAssistantMessage("Retained turn prefix."),
		]);
		const result = await h.session.compact();
		expect(result.summary).toContain("Explicitly retried summary.");
	});

	it("lets compaction extensions reevaluate their own decisions", async () => {
		let interceptions = 0;
		const h = await setup([
			(api) => {
				api.on("session_before_compact", () => {
					interceptions++;
				});
			},
		]);
		let summaries = 0;
		h.setResponses(
			Array.from({ length: 20 }, () => (context: Context) => {
				if (context.systemPrompt?.includes("context summarization assistant")) {
					summaries++;
					return fauxAssistantMessage("", { stopReason: "error", errorMessage: "Request timed out." });
				}
				return fauxAssistantMessage("A short new finding.");
			}),
		);
		await h.session.prompt("Continue the implementation.");
		await h.session.prompt("Check the next component.");
		expect(interceptions).toBe(2);
		expect(summaries).toBe(2);
	});

	it("allows mandatory overflow recovery after an automatic prefix failed", async () => {
		const h = await setup();
		h.setResponses([
			fauxAssistantMessage("", { stopReason: "error", errorMessage: "Request timed out." }),
			fauxAssistantMessage("A short finding."),
		]);
		await h.session.prompt("Continue the implementation.");
		h.setResponses([
			fauxAssistantMessage("", {
				stopReason: "error",
				errorMessage: "This model's maximum context length is 64000 tokens. You requested 65000 tokens.",
			}),
			fauxAssistantMessage("Overflow recovery summary."),
			fauxAssistantMessage("Overflow turn prefix."),
			fauxAssistantMessage("Recovered."),
		]);
		await h.session.prompt("Continue after the failed automatic summary.");
		expect(h.eventsOfType("compaction_start").map((event) => event.reason)).toEqual(["threshold", "overflow"]);
		expect(h.session.messages.at(-1)).toMatchObject({
			role: "assistant",
			stopReason: "stop",
			content: [{ type: "text", text: "Recovered." }],
		});
	});
});
