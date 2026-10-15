import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Api, Model, Provider } from "@step-harness/providers";
import { afterAll, describe, expect, it } from "vitest";
import { ModelConfig } from "../src/core/model-config.ts";
import { composeModelProvider } from "../src/core/provider-composer.ts";

const dir = mkdtempSync(join(tmpdir(), "provider-context-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const known: Model<Api> = {
	id: "known-model",
	name: "Known model",
	provider: "test",
	api: "openai-responses",
	baseUrl: "https://provider.example/v1",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 272000,
	maxTokens: 32768,
};
const base: Provider = {
	id: "test",
	name: "Test",
	auth: {},
	getModels: () => [known],
	stream() {
		throw new Error("No model calls in this test");
	},
	streamSimple() {
		throw new Error("No model calls in this test");
	},
};
async function models(definition: Record<string, unknown>, overrides?: Record<string, unknown>) {
	const path = join(dir, `${Math.random().toString(36).slice(2)}.json`);
	writeFileSync(
		path,
		JSON.stringify({
			providers: {
				test: {
					baseUrl: "https://proxy.example/v1",
					apiKey: "test-key",
					models: [definition],
					modelOverrides: overrides,
				},
			},
		}),
	);
	const config = await ModelConfig.load(path);
	expect(config.getError()).toBeUndefined();
	return composeModelProvider("test", base, config, undefined).getModels();
}

describe("model overlay context budgets", () => {
	it("preserves a matching catalog model's limits when replacing its transport", async () => {
		const [model] = await models({ id: "known-model" });
		expect(model.contextWindow).toBe(272000);
		expect(model.maxTokens).toBe(32768);
		expect(model.baseUrl).toBe("https://proxy.example/v1");
	});

	it("preserves context capacity when only the output cap is explicit", async () => {
		const [model] = await models({ id: "known-model", maxTokens: 16384 });
		expect(model.contextWindow).toBe(272000);
		expect(model.maxTokens).toBe(16384);
	});

	it("preserves the output cap when only context capacity is explicit", async () => {
		const [model] = await models({ id: "known-model", contextWindow: 64000 });
		expect(model.contextWindow).toBe(64000);
		expect(model.maxTokens).toBe(32768);
	});

	it("keeps explicit values and final modelOverrides authoritative", async () => {
		const [model] = await models(
			{ id: "known-model", contextWindow: 64000, maxTokens: 4096 },
			{
				"known-model": { contextWindow: 96000, maxTokens: 8192 },
			},
		);
		expect(model.contextWindow).toBe(96000);
		expect(model.maxTokens).toBe(8192);
	});

	it("never borrows capacity from a different model in the same provider", async () => {
		const resolved = await models({ id: "unknown-model" });
		const model = resolved.find((model) => model.id === "unknown-model")!;
		expect(model.contextWindow).toBe(128000);
		expect(model.maxTokens).toBe(16384);
	});
});
