import type { ComponentPropsWithRef } from "react";
import { cx } from "../../lib/format";
import styles from "./Kbd.module.css";

export interface KbdProps extends ComponentPropsWithRef<"kbd"> {
	/** Unstyled: keep only the classes passed in (legacy `.sidebar-search kbd` styles itself). */
	readonly bare?: boolean;
}

/** Keyboard key hint. */
export function Kbd({ bare = false, className, ...rest }: KbdProps) {
	return <kbd className={cx(!bare && styles.root, className) || undefined} {...rest} />;
}
