import { type ReactNode, useState } from "react";
import { type TagColor, useT } from "../../i18n";
import { cx } from "../../lib/format";
import { shallowEqual, useAppStore } from "../../state/store";
import type { SessionSummary } from "../../state/types";
import { EmptyState, Icon, LEGACY_ICONS } from "../../ui";
import { SessionRow } from "./SessionRow";
import { cssVar, TAG_COLOR_KEYS, TAG_COLORS } from "./tags";

interface GroupedSectionProps {
	readonly name: string;
	readonly color: TagColor | null;
	readonly sessions: readonly SessionSummary[];
	readonly archived?: boolean;
}

/** One coloured section of the grouped view (legacy `buildGroupedSection`, 992-1012). */
function GroupedSection({ name, color, sessions, archived = false }: GroupedSectionProps) {
	const [folded, setFolded] = useState(false);
	const groupColor = archived ? "var(--ink-3)" : color ? TAG_COLORS[color] : "var(--line)";
	return (
		<section
			className={cx("group-section", archived && "archived-group", folded && "folded")}
			style={cssVar("--group-color", groupColor)}
		>
			{/* biome-ignore lint/a11y/noStaticElementInteractions: legacy heading is a plain clickable div. */}
			{/* biome-ignore lint/a11y/useKeyWithClickEvents: see above. */}
			<div className="group-heading" onClick={() => setFolded((value) => !value)}>
				{archived ? (
					<Icon {...LEGACY_ICONS.archive} />
				) : (
					<span
						className="tag-diamond"
						style={cssVar("--tag-color", color ? TAG_COLORS[color] : "var(--line-strong)")}
					/>
				)}
				<span>{name}</span>
			</div>
			<i className="group-spine" />
			<div className="group-sessions">
				{sessions.map((session) => (
					<SessionRow key={session.id} session={session} grouped />
				))}
			</div>
		</section>
	);
}

/** `#groupedView` (legacy `renderGroupedView`, 957-990). */
export function GroupedView() {
	const t = useT();
	const view = useAppStore(
		(state) => ({
			sessions: state.sessions,
			groups: state.groups,
			tags: state.tags,
			hidden: state.currentView !== "group",
		}),
		shallowEqual,
	);
	const visible = view.sessions.filter((session) => !session.archived);
	const archived = view.sessions.filter((session) => session.archived);
	const sections: ReactNode[] = [];
	for (const color of TAG_COLOR_KEYS) {
		const group = view.groups.find((candidate) => candidate.key === color);
		if (!group) continue;
		const sessions = visible.filter((session) => view.tags.get(session.id) === color);
		if (!sessions.length) continue;
		sections.push(<GroupedSection key={color} name={group.name} color={color} sessions={sessions} />);
	}
	const ungrouped = visible.filter((session) => !view.tags.has(session.id));
	if (ungrouped.length) {
		sections.push(<GroupedSection key="ungrouped" name={t("ungrouped")} color={null} sessions={ungrouped} />);
	}
	if (archived.length) {
		sections.push(
			<GroupedSection key="archived" name={t("archivedConversations")} color={null} sessions={archived} archived />,
		);
	}
	return (
		<div className="grouped-view" id="groupedView" hidden={view.hidden}>
			{sections.length ? sections : <EmptyState>{t("noGroupedConversations")}</EmptyState>}
		</div>
	);
}
