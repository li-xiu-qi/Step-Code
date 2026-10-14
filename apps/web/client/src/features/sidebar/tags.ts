import type { CSSProperties } from "react";
import type { TagColor } from "../../i18n";
import type { TagGroup } from "../../state/types";

/** Tag colours in their legacy order (app.js `TAG_COLORS`, 75-84). */
export const TAG_COLORS: Readonly<Record<TagColor, string>> = {
	red: "#D14343",
	orange: "#E2822E",
	yellow: "#C7A500",
	green: "#43A24B",
	blue: "#3E82C9",
	purple: "#8E6BD9",
	pink: "#D96890",
	gray: "#8F8981",
};

export const TAG_COLOR_KEYS = Object.keys(TAG_COLORS) as TagColor[];

/** Name of the group a tag colour stands for, or "" (legacy `groupName`, 756-758). */
export function groupName(groups: readonly TagGroup[], key: TagColor): string {
	return groups.find((group) => group.key === key)?.name ?? "";
}

/** Inline style carrying a CSS custom property (`--tag-color`, `--group-color`). */
export function cssVar(name: string, value: string): CSSProperties {
	return { [name]: value } as CSSProperties;
}
