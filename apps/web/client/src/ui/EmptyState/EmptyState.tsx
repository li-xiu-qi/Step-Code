import type { ComponentPropsWithRef } from "react";
import { cx } from "../../lib/format";
import styles from "./EmptyState.module.css";

/**
 * Muted "nothing here" line (legacy `emptyList()`): `<div class="empty-list">`.
 * The legacy class stays on the element because tests and feature CSS
 * (`#fileTreeBody .empty-list`, `.file-note`) select on it.
 */
export function EmptyState({ className, ...rest }: ComponentPropsWithRef<"div">) {
	return <div className={cx(styles.root, "empty-list", className)} {...rest} />;
}
