import { type KeyboardEvent, type MouseEvent, useEffect, useState } from "react";
import { useT } from "../../i18n";
import { useAppStore } from "../../state/store";
import { Icon } from "../../ui";
import { bannerCountsFromTimeline, type PanelRow, type PanelRowState, taskPanelRowsFromTimeline } from "./task-counts";

/** Status circle of a panel row (legacy `panelStateOf`). */
function RowState({ state }: { readonly state: PanelRowState }) {
	if (state === "done") {
		return (
			<span className="row-state done">
				<Icon name="check" size="sm" />
			</span>
		);
	}
	return <span className="row-state wip" />;
}

/** `#taskPanelBody` contents (legacy `renderTaskPanel`, app.js 3743-3769). */
function TaskPanelBody() {
	const t = useT();
	const items = useAppStore((state) => state.timelineItems);
	const { tasks, agents } = taskPanelRowsFromTimeline(items, t);
	const done = tasks.filter((row) => row.state === "done").length;
	const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
	const row = (entry: PanelRow, index: number, meta: string) => (
		<div className="panel-row" key={index}>
			<RowState state={entry.state} />
			<span className="row-name">{entry.name}</span>
			<span className="row-meta">{meta}</span>
		</div>
	);
	return (
		<>
			{tasks.length ? <div className="panel-section">{t("tasks")}</div> : null}
			{tasks.map((task, index) => row(task, index, task.state === "done" ? t("done") : t("running")))}
			{agents.length ? <div className="panel-section">{t("subagents")}</div> : null}
			{agents.map((agent, index) => row(agent, index, agent.state === "wip" ? t("running") : t("returned")))}
			{!tasks.length && !agents.length ? (
				<div className="panel-row">
					<span className="row-name">{t("noTasks")}</span>
				</div>
			) : null}
			<div className="panel-progress-track">
				<div className="panel-progress-fill" style={{ width: `${pct}%` }} />
			</div>
		</>
	);
}

/**
 * `#taskBanner` (legacy index.html 810-832; app.js 3662-3816): top-right of the
 * main pane, one element with two states (collapsed pill / expanded panel).
 * Hidden until the timeline shows task or subagent activity.
 */
export function TaskBanner() {
	const t = useT();
	const items = useAppStore((state) => state.timelineItems);
	const [expanded, setExpanded] = useState(false);
	const data = bannerCountsFromTimeline(items, t);
	useEffect(() => {
		if (!expanded) return;
		const onKeyDown = (event: globalThis.KeyboardEvent) => {
			if (event.key === "Escape") setExpanded(false);
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [expanded]);
	// The banner is role="button" in the legacy markup; Enter and Space toggle it like a click on its head.
	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
		event.preventDefault();
		setExpanded((open) => !open);
	};
	// Legacy listened on #bannerHead only: clicks inside the expanded panel do not fold it.
	const onClick = (event: MouseEvent<HTMLDivElement>) => {
		if (event.target instanceof Element && event.target.closest("#bannerHead")) setExpanded((open) => !open);
	};
	const classes = ["task-banner", data?.running && "running", expanded && "expanded"].filter(Boolean).join(" ");
	return (
		// biome-ignore lint/a11y/useSemanticElements: legacy #taskBanner is div[role=button]; it wraps block content a <button> cannot hold.
		<div
			className={classes}
			id="taskBanner"
			role="button"
			tabIndex={0}
			aria-expanded={expanded}
			aria-label="任务与子智能体状态,点击展开或收起"
			hidden={!data}
			onClick={onClick}
			onKeyDown={onKeyDown}
		>
			<div className="banner-head" id="bannerHead">
				<span className="banner-dot" id="bannerDot" />
				<span className="banner-title" id="bannerTitle">
					{data?.title ?? "就绪"}
				</span>
				<span className="banner-metrics">
					<span className="banner-chip" id="bannerSteps" hidden={!data || data.steps[1] <= 0}>
						{`${t("steps")} `}
						<b>{data?.steps[0] ?? 0}</b>/{data?.steps[1] ?? 0}
					</span>
					<span className="banner-chip" id="bannerAgents" hidden={!data || data.agents <= 0}>
						{`${t("subagents")} `}
						<b>{data?.agents ?? 0}</b>
					</span>
				</span>
				<Icon name="chevronDown" size="sm" className="banner-caret" />
			</div>
			<div className="banner-detail" id="bannerDetail">
				<div className="task-panel-body" id="taskPanelBody">
					{expanded ? <TaskPanelBody /> : null}
				</div>
			</div>
		</div>
	);
}
