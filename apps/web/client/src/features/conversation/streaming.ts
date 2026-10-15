/**
 * Streaming polish for the live assistant message.
 *
 * Tokens arrive in bursts (the session batches `message_update` per frame and
 * the provider itself sends chunks), so drawing them as they come makes the
 * reply jump forward a line at a time. `useSmoothText` lets the shown text
 * trail the received text and catch up at a steady pace; `useFadeIn` fades in
 * whatever text the last few renders added.
 */

import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";

/** How long newly shown text takes to fade in. Keep in step with `stream-fade` in stream.css. */
const FADE_MS = 420;
/** The shown text never trails by more than about this long. */
const CATCH_UP_MS = 240;
/** Slowest pace, in characters per millisecond, so a short tail does not crawl. */
const MIN_RATE = 0.06;

function cutAt(text: string, length: number): string {
	// Do not split a surrogate pair.
	const code = text.charCodeAt(length - 1);
	return text.slice(0, code >= 0xd800 && code <= 0xdbff ? length + 1 : length);
}

/**
 * `target` revealed progressively while `live`; the whole text otherwise.
 * Text that is replaced rather than extended is shown at once.
 */
export function useSmoothText(target: string, live: boolean): string {
	const [shown, setShown] = useState(live ? "" : target);
	const shownRef = useRef(shown);
	shownRef.current = shown;
	useEffect(() => {
		if (!live || !target.startsWith(shownRef.current)) {
			setShown(target);
			return;
		}
		let frame = 0;
		let last = performance.now();
		const step = (now: number) => {
			const elapsed = Math.min(64, now - last);
			last = now;
			const current = shownRef.current;
			const backlog = target.length - current.length;
			if (backlog <= 0) return;
			const advance = Math.ceil(Math.max(backlog * (elapsed / CATCH_UP_MS), elapsed * MIN_RATE));
			const next = cutAt(target, Math.min(target.length, current.length + advance));
			shownRef.current = next;
			setShown(next);
			if (next.length < target.length) frame = requestAnimationFrame(step);
		};
		frame = requestAnimationFrame(step);
		return () => cancelAnimationFrame(frame);
	}, [target, live]);
	return live ? shown : target;
}

interface Chunk {
	/** Offset in the rendered text where the chunk starts. */
	readonly start: number;
	readonly time: number;
}

/**
 * After each render of `html` into `ref`, wrap the text added since earlier
 * renders in spans whose fade continues where it left off: the markup is
 * rebuilt every frame, so each chunk carries a negative animation delay equal
 * to its age instead of restarting.
 */
export function useFadeIn(ref: RefObject<HTMLElement | null>, html: string, live: boolean): void {
	const chunks = useRef<Chunk[]>([]);
	const length = useRef<number | null>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: `html` is the trigger: MarkdownView has just replaced the markup.
	useLayoutEffect(() => {
		const root = ref.current;
		if (!root || !live) return;
		const now = performance.now();
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
		const nodes: Text[] = [];
		let total = 0;
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			nodes.push(node as Text);
			total += (node as Text).data.length;
		}
		// The first render shows what is already there without a fade.
		const previous = length.current ?? total;
		if (total > previous) chunks.current.push({ start: previous, time: now });
		length.current = total;
		chunks.current = chunks.current.filter((chunk) => chunk.start < total && now - chunk.time < FADE_MS);
		if (!chunks.current.length) return;
		const first = chunks.current[0].start;
		let offset = total;
		for (let index = nodes.length - 1; index >= 0 && offset > first; index -= 1) {
			const node = nodes[index];
			offset -= node.data.length;
			// Split from the end so earlier offsets in this node stay valid.
			for (let chunk = chunks.current.length - 1; chunk >= 0; chunk -= 1) {
				const { start, time } = chunks.current[chunk];
				const end = chunks.current[chunk + 1]?.start ?? total;
				const from = Math.max(start, offset) - offset;
				const to = Math.min(end, offset + node.data.length) - offset;
				if (from >= to) continue;
				const range = document.createRange();
				range.setStart(node, from);
				range.setEnd(node, to);
				const span = document.createElement("span");
				span.className = "stream-fade";
				span.style.animationDelay = `${-(now - time)}ms`;
				range.surroundContents(span);
			}
		}
	}, [html, live]);
}
