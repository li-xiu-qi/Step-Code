import { expect, test } from "vitest";
import { decideStepToolCall, stepPermissionStateForPreset } from "../src/step/permissions.ts";

test("clarify_user asks directly under Ask and still honors explicit per-tool policies", () => {
	const state = stepPermissionStateForPreset("ask");
	expect(decideStepToolCall("clarify_user", { question: "Which app?" }, state).action).toBe("allow");
	expect(decideStepToolCall("clarify_user", {}, state, { clarify_user: "deny" }).action).toBe("deny");
	expect(decideStepToolCall("clarify_user", {}, state, { clarify_user: "confirm" }).action).toBe("confirm");
	expect(decideStepToolCall("write_file", { path: "result.txt", content: "x" }, state).action).toBe("confirm");
});
