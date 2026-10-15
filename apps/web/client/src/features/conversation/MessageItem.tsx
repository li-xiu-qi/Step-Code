import { memo, useMemo, useRef, useState } from "react";
import { formatRelativeTime, useT } from "../../i18n";
import { formatTokens } from "../../lib/format";
import { renderMarkdown, skillInvocation } from "../../lib/markdown";
import { copyText } from "../../state/session";
import type { MessageTimelineItem } from "../../state/types";
import { Icon, LEGACY_ICONS, MarkdownView } from "../../ui";
import { forkAtEntry } from "./actions";
import { openFeedback, type Sentiment } from "./feedback";
import { useFadeIn, useSmoothText } from "./streaming";
import { ThinkingIndicator } from "./ThinkingIndicator";

/**
 * One chat message (legacy `renderTimeline` message branch, app.js 2253-2261).
 * `data-content` and `data-entry-id` are kept from the legacy markup.
 */
export const MessageItem = memo(function MessageItem({
	item,
	showActions = false,
}: {
	readonly item: MessageTimelineItem;
	/** The action row goes under the last reply of a finished turn only. */
	readonly showActions?: boolean;
}) {
	const t = useT();
	const role = item.role === "user" ? "user" : "assistant";
	const live = item.itemId === "message-live";
	const codeLabel = t("code");
	const copyLabel = t("copy");
	const bodyRef = useRef<HTMLDivElement>(null);
	const skill = role === "user" ? skillInvocation(item.content) : null;
	const content = useSmoothText(skill ? skill.request : item.content, live);
	// Memoised: a streaming turn re-renders the timeline per frame, and parsing every earlier message each time made long sessions crawl.
	const html = useMemo(
		() => renderMarkdown(content, { code: codeLabel, copy: copyLabel }),
		[content, codeLabel, copyLabel],
	);
	useFadeIn(bodyRef, html, live);
	// The live turn before its first text (reasoning, or waiting on the first token).
	if (role === "assistant" && !content) return <ThinkingIndicator />;
	return (
		<article className={`message ${role}`} data-content={item.content || ""} data-entry-id={item.entryId}>
			{skill ? (
				<span className="message-skill" title={skill.name}>
					<Icon name="cube" size="xs" />
					{skill.name}
				</span>
			) : null}
			{content ? (
				<MarkdownView
					ref={bodyRef}
					className="message-body"
					html={html}
					onCopyCode={(code) => void copyText(code)}
				/>
			) : null}
			{item.role === "assistant" && showActions ? <MessageActions item={item} /> : null}
		</article>
	);
});

/**
 * The row under an assistant turn: copy, vote, fork, then what the turn cost and
 * when it happened (legacy `messageActions` + `wireMessageActions`, 2206-2302).
 *
 * Voting opens the feedback dialog rather than firing a silent request — a
 * thumbs-down with no detail is much less useful than one with a topic.
 */
function MessageActions({ item }: { readonly item: MessageTimelineItem }) {
	const t = useT();
	const [vote, setVote] = useState<Sentiment | null>(null);
	const tokens = item.usage ? item.usage.input + item.usage.output : 0;
	const onVote = (sentiment: Sentiment) => {
		// One vote visible at a time; clicking the active one clears it.
		setVote((already) => (already === sentiment ? null : sentiment));
		openFeedback(sentiment);
	};
	return (
		<div className="message-actions">
			<button
				className="message-action copy-message"
				type="button"
				title={t("copy")}
				aria-label={t("copy")}
				onClick={() => void copyText(item.content || "")}
			>
				<Icon {...LEGACY_ICONS.copy} />
			</button>
			<button
				className="message-action vote-up"
				type="button"
				aria-pressed={vote === "up"}
				title={t("feedbackGood")}
				aria-label={t("feedbackGood")}
				onClick={() => onVote("up")}
			>
				<Icon name="thumbsUp" size="sm" />
			</button>
			<button
				className="message-action vote-down"
				type="button"
				aria-pressed={vote === "down"}
				title={t("feedbackBad")}
				aria-label={t("feedbackBad")}
				onClick={() => onVote("down")}
			>
				<Icon name="thumbsDown" size="sm" />
			</button>
			<button
				className="message-action fork-message"
				type="button"
				title={t("forkHere")}
				aria-label={t("forkHere")}
				onClick={() => void forkAtEntry(item.entryId)}
			>
				<Icon name="fork" size="sm" />
			</button>
			{tokens ? (
				<span className="message-usage">
					<Icon name="gauge" size="xs" />
					{`${t("usage")} ${formatTokens(tokens)} tok`}
				</span>
			) : null}
			{item.timestamp ? <span className="message-time">{formatRelativeTime(item.timestamp)}</span> : null}
		</div>
	);
}
