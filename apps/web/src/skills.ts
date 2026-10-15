/** A skill the composer offers as `/skill:<name>`; the kernel expands it when the prompt is sent. */
export interface WebSkill {
	readonly name: string;
	readonly description: string;
}

/** Name and description of each skill, by name; file paths stay on the host. */
export function webSkills(skills: ReadonlyArray<{ readonly name: string; readonly description: string }>): WebSkill[] {
	return skills
		.map((skill) => ({ name: skill.name, description: skill.description }))
		.sort((left, right) => left.name.localeCompare(right.name));
}
