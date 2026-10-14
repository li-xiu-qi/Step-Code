import { type ComponentPropsWithRef, type ReactNode, useEffect, useRef } from "react";
import { cx } from "../../lib/format";
import styles from "./Modal.module.css";

export interface ModalProps {
	readonly open: boolean;
	/** Backdrop click (and Escape, when `closeOnEscape`) call this. */
	readonly onClose?: () => void;
	/** id of the overlay element (legacy ids such as `searchModal` live here). */
	readonly id?: string;
	/** Extra classes on the overlay (`search-overlay`, `feedback-overlay`, ...). */
	readonly overlayClassName?: string;
	/** Extra classes on the dialog `<section>` (`search-dialog`, ...). */
	readonly className?: string;
	/** id of the dialog's heading, for `aria-labelledby`. */
	readonly labelledBy?: string;
	/** Close when the backdrop itself is clicked. Default true. */
	readonly closeOnBackdrop?: boolean;
	/**
	 * Close on Escape via a document listener. Default false: the legacy
	 * search and workspace dialogs close from the shell's central Escape chain,
	 * and a second listener would make one Escape close two layers.
	 */
	readonly closeOnEscape?: boolean;
	/** Attributes for the dialog `<section>`. */
	readonly dialogProps?: ComponentPropsWithRef<"section">;
	readonly children?: ReactNode;
}

/**
 * Overlay + dialog, kept mounted and toggled with `hidden` (tests read
 * `element.hidden`). DOM: `div#<id>.<overlay> > section.<dialog>[role=dialog][aria-modal=true]`.
 */
export function Modal({
	open,
	onClose,
	id,
	overlayClassName,
	className,
	labelledBy,
	closeOnBackdrop = true,
	closeOnEscape = false,
	dialogProps,
	children,
}: ModalProps) {
	const onCloseRef = useRef(onClose);
	onCloseRef.current = onClose;
	useEffect(() => {
		if (!open || !closeOnEscape) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") onCloseRef.current?.();
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [open, closeOnEscape]);
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: backdrop click mirrors the legacy overlay; keyboard users close with Escape or the close button.
		// biome-ignore lint/a11y/useKeyWithClickEvents: see above.
		<div
			id={id}
			className={cx(styles.overlay, overlayClassName)}
			hidden={!open}
			onClick={(event) => {
				if (closeOnBackdrop && event.target === event.currentTarget) onClose?.();
			}}
		>
			<section
				{...dialogProps}
				className={cx(styles.dialog, className, dialogProps?.className)}
				role="dialog"
				aria-modal="true"
				aria-labelledby={labelledBy}
			>
				{children}
			</section>
		</div>
	);
}
