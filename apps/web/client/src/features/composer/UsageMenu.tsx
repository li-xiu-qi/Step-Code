/**
 * `#usageMenu`: session token usage (legacy app.js 3818-3885).
 *
 * Sums the usage the provider reported on each assistant turn. A session with
 * no reported usage has nothing to show, so the trigger hides itself rather
 * than displaying a placeholder figure.
 */

import { useEffect, useRef, useState } from "react";
import { useT } from "../../i18n";
import { formatTokens } from "../../lib/format";
import { shallowEqual, useAppStore } from "../../state/store";
import type { TimelineItem } from "../../state/types";
import { Icon } from "../../ui";

interface SessionUsage {
	readonly input: number;
	readonly output: number;
	readonly total: number;
	readonly turns: number;
}

function sessionUsage(items: readonly TimelineItem[]): SessionUsage {
	let input = 0;
	let output = 0;
	let turns = 0;
	for (const item of items ?? []) {
		if (item.kind !== "message" || item.role !== "assistant" || !item.usage) continue;
		input += item.usage.input ?? 0;
		output += item.usage.output ?? 0;
		turns += 1;
	}
	return { input, output, total: input + output, turns };
}

export function UsageMenu() {
	const t = useT();
	const usage = useAppStore((state) => sessionUsage(state.timelineItems), shallowEqual);
	const [open, setOpen] = useState(false);
	const menu = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (!open) return;
		// Capture phase, as legacy: a click anywhere outside `#usageMenu` closes,
		// even one whose handler stops propagation.
		const onClick = (event: MouseEvent) => {
			const target = event.target;
			if (!(target instanceof Element)) return;
			if (menu.current?.contains(target)) return;
			setOpen(false);
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") setOpen(false);
		};
		document.addEventListener("click", onClick, true);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("click", onClick, true);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [open]);

	const inputPct = usage.total ? Math.round((usage.input / usage.total) * 100) : 0;
	return (
		<div className="control-menu" id="usageMenu" ref={menu}>
			<button
				className="control-select usage-control"
				id="usageTrigger"
				type="button"
				aria-haspopup="dialog"
				aria-expanded={open ? "true" : "false"}
				title="token 用量"
				// No reported usage yet: keep the control out of the composer.
				hidden={usage.total === 0}
				onClick={() => setOpen((value) => !value)}
			>
				<Icon name="gauge" />
			</button>
			<div
				className="control-popover usage-popover"
				id="usagePopover"
				role="dialog"
				aria-label="token 用量详情"
				hidden={!open}
			>
				<div className="usage-head">{t("usageTitle")}</div>
				<div className="usage-total">
					<b>{formatTokens(usage.total)}</b>
					<span>{t("usageCumulative")}</span>
				</div>
				<div className="usage-bars">
					<div className="usage-bar-row">
						<span>{t("usageInput")}</span>
						<span className="bar">
							<i style={{ width: `${inputPct}%`, background: "#2f7fbf" }} />
						</span>
						<span className="val">{formatTokens(usage.input)}</span>
					</div>
					<div className="usage-bar-row">
						<span>{t("usageOutput")}</span>
						<span className="bar">
							<i style={{ width: `${100 - inputPct}%`, background: "#a8734a" }} />
						</span>
						<span className="val">{formatTokens(usage.output)}</span>
					</div>
				</div>
				<div className="usage-recent">
					<div className="panel-section">{t("usageTurns")}</div>
					<div className="row">
						<span className="n">{t("usageAssistantTurns")}</span>
						<span className="v">{usage.turns}</span>
					</div>
				</div>
			</div>
		</div>
	);
}
