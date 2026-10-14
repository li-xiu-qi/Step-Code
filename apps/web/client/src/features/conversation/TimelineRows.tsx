import { memo, useState } from "react";
import { useT } from "../../i18n";
import { cx } from "../../lib/format";
import type { ToolTimelineItem } from "../../state/types";
import { Icon, LEGACY_ICONS } from "../../ui";

export { ApprovalCard } from "./ApprovalCard";

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
