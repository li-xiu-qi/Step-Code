import type { ComponentPropsWithRef } from "react";
import { cx } from "../../lib/format";
import { Icon, type IconName, type IconSize } from "../Icon/Icon";
import styles from "./SearchInput.module.css";

export interface SearchInputProps extends Omit<ComponentPropsWithRef<"input">, "type"> {
	/** Leading icon; null for none. Default `search`. */
	readonly icon?: IconName | null;
	readonly iconSize?: IconSize;
	/** Classes of the wrapper `<div>` (legacy `.file-search`, `.search-input-wrap`, ...). */
	readonly wrapperClassName?: string;
	readonly wrapperId?: string;
	readonly bare?: boolean;
}

/**
 * `<div><svg/><input type="search"/></div>`. All input attributes (id,
 * placeholder, value/defaultValue, handlers) go to the `<input>`.
 *
 * Tests drive some of these inputs by assigning `input.value` and dispatching
 * `new Event("input")`. React's `onChange` ignores that (its value tracker
 * sees no change), and the event does not bubble, so React's root-delegated
 * `onInput` misses it too. Handle such inputs with `onInputCapture` (the
 * capture phase reaches the root even for non-bubbling events) or a native
 * listener on the element, and leave them uncontrolled (`defaultValue`, reset
 * through a ref).
 */
export function SearchInput({
	icon = "search",
	iconSize = "md",
	wrapperClassName,
	wrapperId,
	bare = false,
	className,
	...rest
}: SearchInputProps) {
	return (
		<div id={wrapperId} className={cx(!bare && styles.root, wrapperClassName)}>
			{icon ? <Icon name={icon} size={iconSize} /> : null}
			<input type="search" className={cx(!bare && styles.input, className)} {...rest} />
		</div>
	);
}
