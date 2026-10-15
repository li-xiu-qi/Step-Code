import assert from "node:assert/strict";
import test from "node:test";
import { webSkills } from "../src/skills.ts";

test("skills are listed by name with only their name and description", () => {
	const listed = webSkills([
		{ name: "web-search", description: "Search", filePath: "/secret/a/SKILL.md" } as {
			name: string;
			description: string;
		},
		{ name: "find-skills", description: "Find" },
	]);
	assert.deepEqual(listed, [
		{ name: "find-skills", description: "Find" },
		{ name: "web-search", description: "Search" },
	]);
});
