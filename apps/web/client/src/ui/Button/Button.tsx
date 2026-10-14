import type { ComponentPropsWithRef } from "react";
import { cx } from "../../lib/format";
import styles from "./Button.module.css";

/**
 * `plain` resets the native look; `primary` / `secondary` are the dialog
 * footer actions (legacy `.primary-action` / `.secondary-action`).
 */
export type ButtonVariant = "plain" | "primary" | "secondary";

export interface ButtonProps extends ComponentPropsWithRef<"button"> {
	readonly variant?: ButtonVariant;
}

/** A `<button type="button">` unless `type` says otherwise. Extra classes and attributes pass through. */
export function Button({ variant = "plain", type = "button", className, ...rest }: ButtonProps) {
	return <button type={type} className={cx(styles.root, styles[variant], className)} {...rest} />;
}
