/**
 * Pure derivations behind the task banner (legacy app.js 3668-3753). Both read
 * the session timeline directly, so the banner reflects the tools the session
 * actually ran.
 */

import type { TranslateFn } from "../../i18n";
import { compact } from "../../lib/format";
import type { TimelineItem } from "../../state/types";

export interface BannerCounts {
	readonly title: string;
	/** [done, total] task_create / task_update calls. */
	readonly steps: readonly [number, number];
	readonly agents: number;
	readonly running: boolean;
}

export type PanelRowState = "wip" | "done";

export interface PanelRow {
	readonly name: string;
	readonly state: PanelRowState;
}

const isTaskWrite = (name: string) => name === "task_create" || name === "task_update";
const isSubagent = (name: string) => name === "subagent" || name === "agent_send";

/** Collapsed-pill numbers, or null when the session has no task or subagent activity (legacy `bannerCountsFromTimeline`). */
export function bannerCountsFromTimeline(items: readonly TimelineItem[], t: TranslateFn): BannerCounts | null {
	let taskName: string | null = null;
	let taskDone = 0;
	let taskTotal = 0;
	let taskPending = 0;
	let subagents = 0;
	let subagentsPending = 0;
	for (const item of items) {
		if (item.kind !== "tool") continue;
		const name = String(item.toolName ?? "");
		const pending = item.state === "pending";
		if (isTaskWrite(name)) {
			taskTotal += 1;
			if (pending) taskPending += 1;
			else taskDone += 1;
			if (!taskName && item.inputSummary) taskName = compact(item.inputSummary, 42);
		}
		if (isSubagent(name)) {
			subagents += 1;
			if (pending) subagentsPending += 1;
		}
	}
	// Nothing to report: the banner stays hidden rather than inventing a task.
	if (!taskName && taskTotal === 0 && subagents === 0) return null;
	return {
		title: taskName ?? t("currentTask"),
		steps: [taskDone, taskTotal],
		agents: subagentsPending || subagents,
		running: taskPending > 0 || subagentsPending > 0,
	};
}

/** Rows of the expanded panel (legacy `taskPanelRowsFromTimeline`). */
export function taskPanelRowsFromTimeline(
	items: readonly TimelineItem[],
	t: TranslateFn,
): { tasks: PanelRow[]; agents: PanelRow[] } {
	const tasks: PanelRow[] = [];
	const agents: PanelRow[] = [];
	for (const item of items) {
		if (item.kind !== "tool") continue;
		const name = String(item.toolName ?? "");
		const state: PanelRowState = item.state === "pending" ? "wip" : "done";
		if (isTaskWrite(name)) tasks.push({ name: compact(item.inputSummary || t("task"), 46), state });
		if (isSubagent(name)) agents.push({ name: compact(item.inputSummary || t("subagent"), 46), state });
	}
	return { tasks, agents };
}
