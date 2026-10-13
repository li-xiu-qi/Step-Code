import assert from "node:assert/strict";
import test from "node:test";
import { buildLoginReport } from "../src/login.ts";

const authPath = "/home/me/.stepcode/auth.json";
const planCredential = JSON.stringify({
	step: { type: "oauth", access: "the-token", refresh: "static", expires: 1, profile: "step_plan" },
});
const readCredential = () => planCredential;

test("a stored plan credential is reported with its profile and never its value", () => {
	const report = buildLoginReport({
		status: { loggedIn: true, loginMethod: "step_plan", profile: "step_plan", account: "uid-1", validity: "valid" },
		authPath,
		env: {},
		read: readCredential,
		exists: () => true,
	});
	assert.deepEqual(report, {
		source: "auth.json",
		provider: "step",
		profile: "step_plan",
		path: authPath,
		configured: true,
		validity: "valid",
		loginCommand: "step login",
	});
	// The account id the kernel returns is deliberately not forwarded, and no
	// field can carry a token.
	assert.equal(JSON.stringify(report).includes("uid-1"), false);
	assert.equal(JSON.stringify(report).includes("the-token"), false);
});

test("an unreachable provider still has a credential, and says so", () => {
	// The kernel folds "could not reach the provider" into loggedIn: false and
	// drops the profile. The credential is on disk either way, and telling the
	// user to sign in again would not fix a network problem.
	const report = buildLoginReport({
		status: { loggedIn: false, loginMethod: null, validity: "missing" },
		authPath,
		env: {},
		read: readCredential,
		exists: () => true,
	});
	assert.equal(report.configured, true);
	assert.equal(report.source, "auth.json");
	assert.equal(report.profile, "step_plan");
});

test("a rejected token keeps its source and reports the verdict", () => {
	const report = buildLoginReport({
		status: {
			loggedIn: true,
			loginMethod: "step_plan",
			profile: "step_plan_oversea",
			validity: "invalid",
			error: "401 Unauthorized",
		},
		authPath,
		env: {},
		// The stored profile is the authoritative record of the region, so the
		// fixture has to agree with the status it is paired with.
		read: () =>
			JSON.stringify({ step: { type: "oauth", access: "t", expires: 1, profile: "step_plan_oversea" } }),
		exists: () => true,
	});
	assert.equal(report.configured, true);
	assert.equal(report.profile, "step_plan_oversea");
	assert.equal(report.validity, "invalid");
	assert.equal("error" in report, false, "the kernel's error text is not part of the report");
});

test("an environment key is reported as coming from the environment", () => {
	const report = buildLoginReport({
		status: { loggedIn: true, loginMethod: "api_key", validity: "valid" },
		authPath,
		env: { STEP_API_KEY: "super-secret" },
		read: readCredential,
		exists: () => true,
	});
	assert.equal(report.source, "environment");
	assert.equal(report.configured, true);
	assert.equal("path" in report, false, "the stored file is not the source in use");
	assert.equal(JSON.stringify(report).includes("super-secret"), false);
});

test("an empty or malformed store reports none and names the command that fixes it", () => {
	for (const read of [
		() => { throw new Error("ENOENT"); },
		() => "{not json",
		() => JSON.stringify({ step: { type: "oauth", access: "   " } }),
		() => JSON.stringify({ other: { type: "oauth", access: "x" } }),
	]) {
		const report = buildLoginReport({
			status: { loggedIn: false, loginMethod: null, validity: "missing" },
			authPath,
			env: {},
			read,
			exists: () => false,
		});
		assert.deepEqual(report, { source: "none", configured: false, loginCommand: "step login" });
	}
});

test("a plain API-key credential is recognised without a profile", () => {
	const report = buildLoginReport({
		status: { loggedIn: false, loginMethod: null, validity: "missing" },
		authPath,
		env: {},
		read: () => JSON.stringify({ step: { type: "api_key", key: "sk-not-echoed" } }),
		exists: () => true,
	});
	assert.deepEqual(report, {
		source: "auth.json",
		provider: "step",
		path: authPath,
		configured: true,
		validity: "missing",
		loginCommand: "step login",
	});
	assert.equal(JSON.stringify(report).includes("sk-not-echoed"), false);
});
