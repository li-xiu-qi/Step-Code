/** `#prompt`: auto-growing textarea, Enter sends (IME-safe), Shift+Enter newline (legacy app.js 3256-3273, 3576-3583). */

import { type KeyboardEvent, type RefObject, useEffect } from "react";
import { useT } from "../../i18n";
import { useImeGuard } from "../../lib/ime";
import { useAppStore } from "../../state/store";

/** Composer growth limits, read once from CSS so the knobs stay in :root. */
let limits: { readonly min: number; readonly max: number } | null = null;

function readCssPx(element: Element, name: string, fallback: number): number {
	const value = Number.parseInt(getComputedStyle(element).getPropertyValue(name), 10);
	return Number.isFinite(value) ? value : fallback;
}

/** Fit the textarea to its content between `--textarea-min-h` and `--textarea-max-h`. */
export function resizePrompt(prompt: HTMLTextAreaElement | null): void {
	if (!prompt) return;
	limits ??= {
		min: readCssPx(prompt, "--textarea-min-h", 64),
		max: readCssPx(prompt, "--textarea-max-h", 320),
	};
	// Reset first so a shrinking value is measured against the minimum, not the
	// previously grown height.
	prompt.style.height = `${limits.min}px`;
	prompt.style.height = `${Math.min(limits.max, Math.max(limits.min, prompt.scrollHeight))}px`;
}

export interface PromptInputProps {
	readonly promptRef: RefObject<HTMLTextAreaElement | null>;
	readonly disabled: boolean;
	/** Enter without Shift, outside an IME composition. */
	readonly onSubmit: () => void;
	/** Every edit, with the new value (the slash menu follows it). */
	readonly onValueInput?: (value: string) => void;
	/** Offered each key first; returning true means an open menu used it. */
	readonly onMenuKey?: (key: string) => boolean;
}

/** Uncontrolled, as legacy: the value is read and reset through the ref on send. */
export function PromptInput({ promptRef, disabled, onSubmit, onValueInput, onMenuKey }: PromptInputProps) {
	const t = useT();
	const ime = useImeGuard();
	const focusRequest = useAppStore((state) => state.ui.promptFocusRequest);
	useEffect(() => {
		if (focusRequest) promptRef.current?.focus();
	}, [focusRequest, promptRef]);
	const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (ime.isComposing(event)) return;
		if (!event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey && onMenuKey?.(event.key)) {
			event.preventDefault();
			return;
		}
		if (event.key !== "Enter" || event.shiftKey) return;
		event.preventDefault();
		onSubmit();
	};
	return (
		<textarea
			id="prompt"
			ref={promptRef}
			rows={3}
			placeholder={t("messagePlaceholder")}
			disabled={disabled}
			{...ime.handlers}
			onInput={(event) => {
				resizePrompt(event.currentTarget);
				onValueInput?.(event.currentTarget.value);
			}}
			onKeyDown={onKeyDown}
		/>
	);
}
