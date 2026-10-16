import type { ComponentPropsWithRef } from "react";
import { cx } from "../../lib/format";
import styles from "./Switch.module.css";

export interface SwitchProps extends Omit<ComponentPropsWithRef<"button">, "onChange" | "role"> {
	readonly checked: boolean;
	readonly onChange: (checked: boolean) => void;
}

/**
 * On/off toggle: `<button role="switch" aria-checked>`. It sets no accessible
 * name of its own; pass `aria-label` (or `aria-labelledby`).
 */
export function Switch({ checked, onChange, className, type = "button", disabled, ...rest }: SwitchProps) {
	return (
		<button
			type={type}
			role="switch"
			aria-checked={checked}
			disabled={disabled}
			className={cx(styles.root, checked && styles.on, className)}
			onClick={() => onChange(!checked)}
			{...rest}
		>
			<span className={styles.knob} />
		</button>
	);
}
