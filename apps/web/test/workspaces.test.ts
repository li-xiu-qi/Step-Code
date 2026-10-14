import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { WorkspaceRegistry } from "../src/workspaces.ts";

test("workspaces persist across registry instances and can be removed", async () => {
	const base = await realpath(await mkdtemp(join(tmpdir(), "stepcode-web-workspaces-")));
	try {
		const file = join(base, "agent", "web-workspaces.json");
		const folder = join(base, "project");
		await mkdir(folder);
		const registry = new WorkspaceRegistry(file);
		assert.deepEqual(await registry.list(), []);

		assert.deepEqual(await registry.add(folder), { path: folder, name: "project", available: true });
		// Adding the same folder twice, even spelled differently, lists it once.
		await registry.add(join(folder, "..", "project"));
		assert.equal((await registry.list()).length, 1);

		const reopened = new WorkspaceRegistry(file);
		assert.deepEqual(await reopened.list(), [{ path: folder, name: "project", available: true }]);
		assert.equal(await reopened.has(folder), true);

		await rm(folder, { recursive: true });
		assert.equal((await reopened.list())[0]?.available, false);

		assert.equal(await reopened.remove(folder), true);
		assert.equal(await reopened.remove(folder), false);
		assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { workspaces: [] });
	} finally {
		await rm(base, { recursive: true, force: true });
	}
});

test("the most recently added workspace is listed first", async () => {
	const base = await realpath(await mkdtemp(join(tmpdir(), "stepcode-web-workspaces-")));
	try {
		const registry = new WorkspaceRegistry(join(base, "web-workspaces.json"));
		for (const name of ["first", "second"]) await mkdir(join(base, name));
		await registry.add(join(base, "first"));
		await registry.add(join(base, "second"));
		assert.deepEqual(
			(await registry.list()).map((workspace) => workspace.name),
			["second", "first"],
		);
		// Adding a listed folder again moves it back to the top.
		await registry.add(join(base, "first"));
		assert.deepEqual(
			(await registry.list()).map((workspace) => workspace.name),
			["first", "second"],
		);
	} finally {
		await rm(base, { recursive: true, force: true });
	}
});

test("only existing directories can be registered", async () => {
	const base = await mkdtemp(join(tmpdir(), "stepcode-web-workspaces-"));
	try {
		const registry = new WorkspaceRegistry(join(base, "web-workspaces.json"));
		await writeFile(join(base, "file.txt"), "x");
		await assert.rejects(registry.add(join(base, "missing")), /does not exist/);
		await assert.rejects(registry.add(join(base, "file.txt")), /not a directory/);
		await assert.rejects(registry.add("  "), /path is required/);
		assert.deepEqual(await registry.list(), []);
	} finally {
		await rm(base, { recursive: true, force: true });
	}
});

test("a malformed registry file starts empty instead of failing", async () => {
	const base = await mkdtemp(join(tmpdir(), "stepcode-web-workspaces-"));
	try {
		const file = join(base, "web-workspaces.json");
		await writeFile(file, "{not json");
		assert.deepEqual(await new WorkspaceRegistry(file).list(), []);
	} finally {
		await rm(base, { recursive: true, force: true });
	}
});
