import type { SVGProps } from "react";
import { cx } from "../../lib/format";
import type { IconName } from "../IconSprite/IconSprite";
import styles from "./Icon.module.css";

export type { IconName } from "../IconSprite/IconSprite";

/** `icon--<size>` in styles/global.css; `menu` is the 8x12 chevron used in the settings menu. */
export type IconSize = "2xs" | "xs" | "sm" | "md" | "lg" | "menu";

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
	readonly name: IconName;
	readonly size?: IconSize;
}

/**
 * A sprite icon: `<svg class="icon icon--<size>" aria-hidden="true"><use href="#i-<name>"/></svg>`,
 * exactly the legacy `icon(name, size)` markup. Requires `<IconSprite />` in the document.
 */
export function Icon({ name, size = "md", className, ...rest }: IconProps) {
	return (
		<svg className={cx(styles.root, "icon", `icon--${size}`, className)} aria-hidden="true" {...rest}>
			<use href={`#i-${name}`} />
		</svg>
	);
}

/**
 * Presets of legacy app.js `ICONS` (lines 62-73): the icon and size each
 * call site used. `<Icon {...LEGACY_ICONS.folder} />`.
 */
export const LEGACY_ICONS = {
	folder: { name: "folder", size: "md" },
	file: { name: "file", size: "xs" },
	tree: { name: "tree", size: "sm" },
	open: { name: "open", size: "sm" },
	plus: { name: "plus", size: "sm" },
	more: { name: "more", size: "xs" },
	tool: { name: "tool", size: "2xs" },
	copy: { name: "copy", size: "xs" },
	tag: { name: "tag", size: "xs" },
	archive: { name: "archive", size: "sm" },
} as const satisfies Record<string, { name: IconName; size: IconSize }>;
