import { expect, test, vi } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { createExtensionRuntime } from "../src/core/extensions/loader.ts";
import { ExtensionRunner } from "../src/core/extensions/runner.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { createInMemoryModelRegistry } from "./model-runtime-test-utils.ts";

test.each([false, true])(
	"structured clarification brackets the existing user-wait lifecycle (reject=%s)",
	async (reject) => {
		const runner = new ExtensionRunner(
			[],
			createExtensionRuntime(),
			"/tmp",
			SessionManager.inMemory(),
			await createInMemoryModelRegistry(AuthStorage.inMemory()),
		);
		const events = vi.spyOn(runner, "emit");
		const result = { answers: [], cancelled: true };
		const clarify = vi.fn(async () => {
			if (reject) throw new Error("dialog failed");
			return result;
		});
		runner.setUIContext({ ...runner.getUIContext(), clarify }, "rpc");
		const signal = new AbortController().signal;
		const pending = runner.getUIContext().clarify?.([], signal);
		if (reject) await expect(pending).rejects.toThrow("dialog failed");
		else await expect(pending).resolves.toEqual(result);
		await Promise.resolve();
		expect(clarify).toHaveBeenCalledWith([], signal);
		expect(events).toHaveBeenNthCalledWith(1, { type: "ui_prompt_start", reason: "ui_prompt", kind: "custom" });
		expect(events).toHaveBeenNthCalledWith(2, { type: "ui_prompt_end", reason: "ui_prompt", kind: "custom" });
	},
);
