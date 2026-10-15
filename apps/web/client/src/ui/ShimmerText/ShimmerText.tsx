import type { ComponentPropsWithRef } from "react";
import { cx } from "../../lib/format";
import styles from "./ShimmerText.module.css";

/**
 * Muted text with a highlight band that sweeps across it from the first
 * character to the last, for "working on it" labels. Put it in a status
 * region (e.g. `<output>`) to announce it; the motion itself is decorative.
 */
export function ShimmerText({ className, ...rest }: ComponentPropsWithRef<"span">) {
	return <span className={cx(styles.root, className)} {...rest} />;
}
