import { type KeyboardEvent as ReactKeyboardEvent, useCallback, useMemo, useRef } from "react";

/**
 * Guard Enter against an IME composition (legacy app.js `enterGuard`).
 *
 * Confirming a Chinese/Japanese/Korean candidate is itself an Enter, so a bare
 * `key === "Enter"` check submits half-finished text. `isComposing` alone is not
 * enough: several browsers report it as false on the keydown that ends a
 * composition, and that keydown can arrive after compositionend — hence the
 * asynchronously cleared flag, which swallows that trailing Enter while leaving
 * the next real one alone.
 *
 * Usage:
 *   const ime = useImeGuard();
 *   <input {...ime.handlers} onKeyDown={(e) => { if (e.key === "Enter" && !ime.isComposing(e)) submit(); }} />
 */
export interface ImeGuard {
	/** Spread onto the input/textarea. */
	readonly handlers: {
		readonly onCompositionStart: () => void;
		readonly onCompositionEnd: () => void;
	};
	/** True while the keydown belongs to an IME composition and must not act as Enter. */
	isComposing(event: ReactKeyboardEvent | KeyboardEvent): boolean;
}

export function useImeGuard(): ImeGuard {
	const composing = useRef(false);
	const onCompositionStart = useCallback(() => {
		composing.current = true;
	}, []);
	const onCompositionEnd = useCallback(() => {
		setTimeout(() => {
			composing.current = false;
		}, 0);
	}, []);
	return useMemo(
		() => ({
			handlers: { onCompositionStart, onCompositionEnd },
			isComposing: (event: ReactKeyboardEvent | KeyboardEvent) => {
				const native = "nativeEvent" in event ? event.nativeEvent : event;
				return native.isComposing || composing.current;
			},
		}),
		[onCompositionStart, onCompositionEnd],
	);
}

/** Non-React variant for an element wired imperatively. Returns the same predicate. */
export function enterGuard(element: HTMLElement): (event: KeyboardEvent) => boolean {
	let composing = false;
	element.addEventListener("compositionstart", () => {
		composing = true;
	});
	element.addEventListener("compositionend", () => {
		setTimeout(() => {
			composing = false;
		}, 0);
	});
	return (event) => event.isComposing || composing;
}
