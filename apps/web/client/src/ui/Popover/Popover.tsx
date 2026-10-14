import { type ComponentPropsWithRef, type RefObject, useRef } from "react";
import { cx } from "../../lib/format";
import { type DismissEvent, useDismiss } from "../hooks/useDismiss";
import { useMergedRef } from "../hooks/useMergedRef";
import styles from "./Popover.module.css";

export interface PopoverProps extends ComponentPropsWithRef<"div"> {
	readonly open: boolean;
	/** Called when an outside press or Escape asks to close. The owner flips `open`. */
	readonly onClose: (reason: "outside" | "escape") => void;
	/** Elements that do not count as outside, typically the trigger. */
	readonly ignoreRefs?: ReadonlyArray<RefObject<Element | null>>;
	/** Document event that dismisses; `false` disables outside dismissal. Default `pointerdown`. */
	readonly dismissOn?: DismissEvent | false;
	/** Dismiss on Escape. Default true. Turn off when a central Escape chain owns this overlay. */
	readonly closeOnEscape?: boolean;
	/** Focus returned here after an Escape close (legacy `setupPopover` refocused the trigger). */
	readonly returnFocusRef?: RefObject<HTMLElement | null>;
	/** Unstyled: drop the module's surface styles and keep only the legacy classes passed in. */
	readonly bare?: boolean;
}

/**
 * Floating panel that stays mounted and toggles the native `hidden` attribute
 * (tests read `element.hidden`). Positioning is left to the caller's CSS.
 */
export function Popover({
	open,
	onClose,
	ignoreRefs = [],
	dismissOn = "pointerdown",
	closeOnEscape = true,
	returnFocusRef,
	bare = false,
	className,
	ref,
	children,
	...rest
}: PopoverProps) {
	const own = useRef<HTMLDivElement | null>(null);
	const mergedRef = useMergedRef(own, ref);
	useDismiss({
		enabled: open,
		insideRefs: [own, ...ignoreRefs],
		event: dismissOn,
		escape: closeOnEscape,
		onDismiss: (reason) => {
			onClose(reason);
			if (reason === "escape") returnFocusRef?.current?.focus();
		},
	});
	return (
		<div ref={mergedRef} className={cx(!bare && styles.root, className)} hidden={!open} {...rest}>
			{children}
		</div>
	);
}
