import { useEffect, useRef } from "react";
import { useT } from "../../i18n";
import { IconButton, Modal } from "../../ui";
import {
	closeFeedback,
	FEEDBACK_TOPIC_LABELS,
	FEEDBACK_TOPICS,
	setFeedbackComment,
	submitFeedback,
	toggleFeedbackTopic,
	useFeedbackState,
} from "./feedback";

/**
 * `#feedbackModal` (legacy index.html 1116-1157; app.js 2128-2185, 3390-3397):
 * topic chips, a free-text box and one submit button. Closes on the close
 * button, a backdrop click or Escape.
 */
export function FeedbackModal() {
	const t = useT();
	const feedback = useFeedbackState();
	const commentRef = useRef<HTMLTextAreaElement>(null);
	useEffect(() => {
		if (!feedback.openSeq) return;
		const frame = requestAnimationFrame(() => commentRef.current?.focus());
		return () => cancelAnimationFrame(frame);
	}, [feedback.openSeq]);
	return (
		<Modal
			open={feedback.open}
			onClose={closeFeedback}
			id="feedbackModal"
			overlayClassName="feedback-overlay"
			className="feedback-dialog"
			labelledBy="feedbackTitle"
			closeOnEscape
		>
			<header>
				<h2 id="feedbackTitle">{t("submitFeedback")}</h2>
				<IconButton id="feedbackClose" icon="close-sm" title="关闭" aria-label="关闭" onClick={closeFeedback} />
			</header>
			{/* biome-ignore lint/a11y/useSemanticElements: legacy markup is div[role=group]; a fieldset would change the chip layout. */}
			<div className="feedback-topics" id="feedbackTopics" role="group" aria-label="反馈主题">
				{FEEDBACK_TOPICS.map((topic) => {
					const key = `feedbackTopic.${topic}`;
					const label = t(key) === key ? FEEDBACK_TOPIC_LABELS[topic] : t(key);
					return (
						<button
							key={topic}
							className="feedback-topic"
							type="button"
							aria-pressed={feedback.topic === topic}
							onClick={() => toggleFeedbackTopic(topic)}
						>
							{label}
						</button>
					);
				})}
			</div>
			<textarea
				id="feedbackComment"
				ref={commentRef}
				rows={5}
				placeholder={t("feedbackCommentPlaceholder")}
				value={feedback.comment}
				onChange={(event) => setFeedbackComment(event.target.value)}
			/>
			<button
				className="feedback-submit"
				id="feedbackSubmit"
				type="button"
				disabled={feedback.submitting}
				onClick={() => void submitFeedback()}
			>
				{t("submit")}
			</button>
		</Modal>
	);
}
