import { useLayoutEffect, useRef } from "react";
import { useLocale, useT } from "../../i18n";
import { useAppStore } from "../../state/store";
import type { TimelineItem } from "../../state/types";
import { MessageItem } from "./MessageItem";
import { ApprovalCard, ToolRow } from "./TimelineRows";

/** Shown while the timeline is empty (legacy index.html 835-842, `renderTimeline`). */
function EmptyConversation() {
	const t = useT();
	return (
		<div className="empty-state">
			<div className="empty-wordmark">
				<span>STEP</span>
				<strong>CODE</strong>
			</div>
			<p>{t("emptyConversation")}</p>
		</div>
	);
}

/**
 * React key of a timeline row. Item ids are unique in practice, but a live
 * `tool_execution_start` can repeat a tool already in the snapshot, so a
 * repeated id gets its position appended instead of colliding.
 */
function itemKeys(items: readonly TimelineItem[]): string[] {
	const seen = new Set<string>();
	return items.map((item, index) => {
		if (!seen.has(item.itemId)) {
			seen.add(item.itemId);
			return item.itemId;
		}
		return `${item.itemId}#${index}`;
	});
}

/**
 * `#stream > #streamInner`: the session timeline (legacy `renderTimeline`,
 * app.js 2246-2281). Like the legacy renderer it jumps to the bottom every time
 * the timeline (or the language) changes. The task banner and usage trigger the
 * legacy function refreshed afterwards derive from the store on their own.
 */
export function ConversationStream() {
	const items = useAppStore((state) => state.timelineItems);
	const locale = useLocale();
	const streamRef = useRef<HTMLDivElement>(null);
	const keys = itemKeys(items);
	// biome-ignore lint/correctness/useExhaustiveDependencies: legacy renderTimeline scrolled to the bottom on every redraw; items and locale are the redraw triggers.
	useLayoutEffect(() => {
		const stream = streamRef.current;
		if (stream) stream.scrollTop = stream.scrollHeight;
	}, [items, locale]);
	return (
		<div className="stream" id="stream" ref={streamRef}>
			<div className="stream-inner" id="streamInner">
				{items.length ? (
					items.map((item, index) => {
						const key = keys[index];
						if (item.kind === "message") return <MessageItem key={key} item={item} />;
						if (item.kind === "tool") return <ToolRow key={key} item={item} />;
						return <ApprovalCard key={key} approval={item.approval} />;
					})
				) : (
					<EmptyConversation />
				)}
			</div>
		</div>
	);
}
