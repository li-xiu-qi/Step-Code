import type { ComponentPropsWithRef, ReactNode } from "react";
import { cx } from "../../lib/format";
import { Icon, type IconName } from "../Icon/Icon";
import styles from "./Menu.module.css";

export interface MenuProps extends ComponentPropsWithRef<"div"> {
	/** Unstyled: keep only the legacy classes passed in. */
	readonly bare?: boolean;
}

/** Vertical list of MenuItems. Adds no ARIA role by default; pass `role="menu"` where wanted. */
export function Menu({ bare = false, className, ...rest }: MenuProps) {
	return <div className={cx(!bare && styles.menu, className)} {...rest} />;
}

export interface MenuItemProps extends ComponentPropsWithRef<"button"> {
	/** Leading sprite icon (md). */
	readonly icon?: IconName;
	/** Muted text or element after the label, pushed to the trailing edge. */
	readonly trailing?: ReactNode;
	readonly danger?: boolean;
	readonly bare?: boolean;
}

/** One row of a Menu: `<button type="button">` with optional icon and trailing slot. */
export function MenuItem({
	icon,
	trailing,
	danger = false,
	bare = false,
	type = "button",
	className,
	children,
	...rest
}: MenuItemProps) {
	return (
		<button
			type={type}
			className={cx(!bare && styles.item, !bare && danger && styles.danger, danger && "danger", className)}
			{...rest}
		>
			{icon ? <Icon name={icon} /> : null}
			{children}
			{trailing === undefined ? null : <span className={bare ? undefined : styles.trailing}>{trailing}</span>}
		</button>
	);
}

export interface MenuDividerProps extends ComponentPropsWithRef<"div"> {
	readonly bare?: boolean;
}

export function MenuDivider({ bare = false, className, ...rest }: MenuDividerProps) {
	return <div className={cx(!bare && styles.divider, className)} {...rest} />;
}
