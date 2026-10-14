import type { ComponentPropsWithRef, ReactNode } from "react";
import { cx } from "../../lib/format";
import styles from "./SegmentedControl.module.css";

export interface SegmentedItem<T extends string> {
	readonly value: T;
	readonly label: ReactNode;
	readonly title?: string;
	/** Extra attributes for this item's button, e.g. `{ "data-view": "project" }`. */
	readonly attrs?: Readonly<Record<string, string>>;
}

export interface SegmentedControlProps<T extends string> extends Omit<ComponentPropsWithRef<"div">, "onChange"> {
	readonly items: ReadonlyArray<SegmentedItem<T>>;
	/** Selected value; null selects nothing. */
	readonly value: T | null;
	readonly onChange: (value: T) => void;
	/** Extra classes on every item (`view-tab`, `control-segment`). */
	readonly itemClassName?: string;
	/**
	 * How the selected item is marked: `aria-pressed="true|false"` on every item
	 * (legacy effort segments) or an `active` class (legacy view tabs).
	 */
	readonly selection?: "aria-pressed" | "class";
	/** Class added to the selected item in `class` mode. Default `active`. */
	readonly activeClassName?: string;
	readonly bare?: boolean;
}

/** A row of mutually exclusive buttons (tabs or a segmented control). */
export function SegmentedControl<T extends string>({
	items,
	value,
	onChange,
	itemClassName,
	selection = "aria-pressed",
	activeClassName = "active",
	bare = false,
	className,
	...rest
}: SegmentedControlProps<T>) {
	return (
		<div className={cx(!bare && styles.root, className)} {...rest}>
			{items.map((item) => {
				const selected = item.value === value;
				return (
					<button
						key={item.value}
						type="button"
						className={cx(
							!bare && styles.item,
							!bare && selected && styles.selected,
							itemClassName,
							selection === "class" && selected && activeClassName,
						)}
						title={item.title}
						aria-pressed={selection === "aria-pressed" ? selected : undefined}
						onClick={() => onChange(item.value)}
						{...item.attrs}
					>
						{item.label}
					</button>
				);
			})}
		</div>
	);
}
