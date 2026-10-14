import type { ComponentPropsWithRef } from "react";
import { cx } from "../../lib/format";
import styles from "./Spinner.module.css";

/**
 * Decorative pulsing dot, the legacy "running" indicator. It is
 * `aria-hidden`: put the status text (e.g. t("running")) next to it.
 */
export function Spinner({ className, ...rest }: ComponentPropsWithRef<"span">) {
	return <span className={cx(styles.root, className)} aria-hidden="true" {...rest} />;
}
