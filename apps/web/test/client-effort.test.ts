import assert from "node:assert/strict";
import test from "node:test";
import { clampThinkingLevel } from "@step-harness/coding-agent";
import { clampEffort, draftModelSource } from "../client/src/features/composer/models.ts";
import type { DraftModels } from "../client/src/state/types.ts";

const ALL = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

type KernelModel = Parameters<typeof clampThinkingLevel>[0];

function model(levels: readonly string[]): KernelModel {
	const map: Record<string, string | null> = {};
	for (const level of ALL) map[level] = levels.includes(level) ? level : null;
	return {
		id: "m",
		name: "m",
		api: "openai-completions",
		provider: "test",
		baseUrl: "https://example.invalid",
		reasoning: true,
		thinkingLevelMap: map,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1000,
		maxTokens: 1000,
	};
}

test("the draft panel rounds an effort the way the kernel will", () => {
	const shapes = [
		["off", "low", "medium", "high", "max"],
		["off", "low", "medium", "high"],
		["low", "high"],
		["off"],
		["medium", "xhigh"],
	];
	for (const levels of shapes) {
		for (const wanted of ALL) {
			assert.equal(
				clampEffort(wanted, levels),
				clampThinkingLevel(model(levels), wanted),
				`${wanted} on [${levels.join(", ")}]`,
			);
		}
	}
	// The case the review found: xhigh on a model with high and max runs at max, not high.
	assert.equal(clampEffort("xhigh", ["off", "low", "medium", "high", "max"]), "max");
});

test("a model picked in a draft brings its own levels and rounds the picked effort", () => {
	const draft: DraftModels = {
		model: { provider: "step", id: "a" },
		thinkingLevel: "medium",
		availableThinkingLevels: ["off", "low", "medium", "high", "xhigh"],
		models: [
			{ provider: "step", id: "a", thinkingLevels: ["off", "low", "medium", "high", "xhigh"] },
			{ provider: "step", id: "b", thinkingLevels: ["off", "low", "medium", "high", "max"] },
		],
	};
	const source = draftModelSource(draft, "step\u0000b", "xhigh");
	assert.deepEqual(source.model, { provider: "step", id: "b" });
	assert.equal(source.thinkingLevel, "max");
});
