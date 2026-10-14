import { useEffect, useRef } from "react";

/**
 * A document `click` listener that runs `onOutside` unless the click landed
 * inside an element matching `insideSelector` (legacy document click handler,
 * app.js 3585-3589). Clicks whose React handler stopped propagation never
 * reach the document, as with the legacy `event.stopPropagation()` calls.
 */
export function useOutsideClick(enabled: boolean, insideSelector: string, onOutside: () => void): void {
	const latest = useRef(onOutside);
	latest.current = onOutside;
	useEffect(() => {
		if (!enabled) return;
		const onClick = (event: MouseEvent) => {
			const target = event.target;
			if (target instanceof Element && target.closest(insideSelector)) return;
			latest.current();
		};
		document.addEventListener("click", onClick);
		return () => document.removeEventListener("click", onClick);
	}, [enabled, insideSelector]);
}
