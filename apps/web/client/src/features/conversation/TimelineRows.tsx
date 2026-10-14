import { memo, useState } from "react";
import { useT } from "../../i18n";
import { compact, cx } from "../../lib/format";
import type { ApprovalRequest, ToolTimelineItem } from "../../state/types";
import { Icon, LEGACY_ICONS } from "../../ui";
import { type ApprovalVerdict, decideApproval } from "./actions";

/**
 * A tool call in the stream (legacy `renderTimeline` tool branch, app.js 2263-2271).
 * The one-line summary toggles the full arguments and result below it.
 */
export const ToolRow = memo(function ToolRow({ item }: { readonly item: ToolTimelineItem }) {
	const t = useT();
	const [open, setOpen] = useState(false);
	const output = item.outputDetail || item.outputSummary;
	return (
		<>
			<button
				type="button"
				className={cx("tool-row", item.state, open && "open")}
				aria-expanded={open}
				onClick={() => setOpen((value) => !value)}
			>
				<Icon {...LEGACY_ICONS.tool} />
				<span className="tool-name">{item.toolName}</span>
				<span>·</span>
				<span>{item.inputSummary || "无输入摘要"}</span>
				{item.outputSummary ? (
					<>
						<span>·</span>
						<span>{item.outputSummary}</span>
					</>
				) : null}
			</button>
			{open ? (
				<div className="tool-detail">
					<div className="tool-detail-label">{t("toolInput")}</div>
					<pre>{item.inputDetail || item.inputSummary || "无输入摘要"}</pre>
					<div className="tool-detail-label">{t("toolOutput")}</div>
					<pre>{output || (item.state === "pending" ? t("toolRunning") : "")}</pre>
				</div>
			) : null}
		</>
	);
});

/** Text of the approval body: the message plus the edit preview, if any (legacy `buildApproval`). */
function approvalText(approval: ApprovalRequest): string {
	const preview = approval.preview
		? `\n${approval.preview.path ? `路径：${approval.preview.path}\n` : ""}${approval.preview.before ? `修改前：${compact(approval.preview.before, 240)}\n` : ""}${approval.preview.after ? `修改后：${compact(approval.preview.after, 240)}` : ""}`
		: "";
	return `${approval.message}${preview}`;
}

/**
 * A pending tool approval (legacy `buildApproval`, app.js 2315-2343). Once the
 * server accepts a verdict the buttons go and the heading states the outcome.
 */
export function ApprovalCard({ approval }: { readonly approval: ApprovalRequest }) {
	const t = useT();
	const [decided, setDecided] = useState<ApprovalVerdict | null>(null);
	const decide = async (verdict: ApprovalVerdict) => {
		if (await decideApproval(approval.id, verdict)) setDecided(verdict);
	};
	const heading =
		decided === null
			? `${approval.toolName} · ${t("approvalWaiting")}`
			: `${approval.toolName} · ${decided === "deny" ? t("denied") : t("approved")}`;
	return (
		<div className="approval">
			<strong>{heading}</strong>
			<p>{approvalText(approval)}</p>
			<div className="approval-actions">
				{decided === null ? (
					<>
						<button data-verdict="deny" type="button" onClick={() => void decide("deny")}>
							{t("deny")}
						</button>
						<button data-verdict="approve" type="button" onClick={() => void decide("approve")}>
							{t("approveOnce")}
						</button>
						<button
							className="approve"
							data-verdict="approve_for_session"
							type="button"
							onClick={() => void decide("approve_for_session")}
						>
							{t("approveSession")}
						</button>
					</>
				) : null}
			</div>
		</div>
	);
}
