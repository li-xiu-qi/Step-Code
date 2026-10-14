import type { KeyboardEvent, MouseEvent } from "react";
import { formatRelativeTime, useT } from "../../i18n";
import { cx } from "../../lib/format";
import { openSession, sessionTitle, taskStatus } from "../../state/session";
import { mapWith, setState, shallowEqual, useAppStore } from "../../state/store";
import type { SessionSummary } from "../../state/types";
import { Icon, LEGACY_ICONS } from "../../ui";
import { applyTagFilter, openSessionMenu, openTagPicker } from "./actions";
import { cssVar, groupName, TAG_COLORS } from "./tags";

export interface SessionRowProps {
	readonly session: SessionSummary;
	/** Rows of the grouped view have no tag button (legacy `buildSessionRow(session, true)`). */
	readonly grouped?: boolean;
	/** Hidden by the project view's tag filter (legacy `row.style.display = "none"`). */
	readonly filteredOut?: boolean;
}

/** One conversation row (legacy `buildSessionRow`, 760-819). */
export function SessionRow({ session, grouped = false, filteredOut = false }: SessionRowProps) {
	const t = useT();
	const row = useAppStore((state) => {
		const tag = state.tags.get(session.id);
		return {
			status: taskStatus(state, session),
			unread: state.unreadById.get(session.id) === true,
			active: state.current?.id === session.id,
			tag,
			tagName: tag ? groupName(state.groups, tag) : "",
			view: state.currentView,
			filter: state.currentFilter,
		};
	}, shallowEqual);
	const { status, tag } = row;

	const open = () => {
		setState((state) => ({ unreadById: mapWith(state.unreadById, session.id, false) }));
		void openSession(session.id);
	};
	const onClick = (event: MouseEvent<HTMLDivElement>) => {
		if ((event.target as Element).closest(".session-menu-button,.session-tag-button,.session-tag")) return;
		open();
	};
	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		// Only the row itself: Enter on a nested button must activate that button.
		if (event.target !== event.currentTarget) return;
		if (event.key === "Enter" || event.key === " ") {
			event.preventDefault();
			open();
		}
	};
	const onContextMenu = (event: MouseEvent<HTMLDivElement>) => {
		event.preventDefault();
		openSessionMenu(session.id, event.clientX, event.clientY);
	};
	const onMenuClick = (event: MouseEvent<HTMLButtonElement>) => {
		event.stopPropagation();
		const rect = event.currentTarget.getBoundingClientRect();
		openSessionMenu(session.id, rect.right, rect.bottom + 4);
	};
	const onTagButtonClick = (event: MouseEvent<HTMLButtonElement>) => {
		event.stopPropagation();
		openTagPicker(session.id, event.currentTarget);
	};
	const onTagClick = (event: MouseEvent<HTMLButtonElement>) => {
		event.stopPropagation();
		if (row.view === "project" && tag) applyTagFilter(row.filter === tag ? null : tag);
	};

	return (
		// biome-ignore lint/a11y/useSemanticElements: the legacy row is a div[role=button] holding its own buttons, which a <button> cannot contain.
		<div
			className={cx("session-row", status, row.active && "active", row.unread && "unread")}
			role="button"
			tabIndex={0}
			data-session-id={session.id}
			style={filteredOut ? { display: "none" } : undefined}
			onClick={onClick}
			onKeyDown={onKeyDown}
			onContextMenu={onContextMenu}
		>
			<i className="session-dot" aria-hidden="true" />
			<span className="session-title-wrap">
				<span className="session-title">{sessionTitle(session)}</span>
			</span>
			<span className="session-meta">
				{status === "running" || status === "waiting" || status === "failed" ? (
					<span className={cx("session-badge", status)}>{t(status)}</span>
				) : null}
				<time className="session-time">{formatRelativeTime(session.modified)}</time>
				{grouped ? null : (
					<button
						className="session-tag-button"
						type="button"
						title={t("groups")}
						aria-label={t("groups")}
						onClick={onTagButtonClick}
					>
						<Icon {...LEGACY_ICONS.tag} />
					</button>
				)}
				<button
					className="session-menu-button"
					type="button"
					title={t("settings")}
					aria-label={t("settings")}
					onClick={onMenuClick}
				>
					<Icon {...LEGACY_ICONS.more} />
				</button>
				{tag ? (
					<button
						className="tag-diamond session-tag"
						type="button"
						style={cssVar("--tag-color", TAG_COLORS[tag])}
						title={row.tagName}
						aria-label={row.tagName}
						onClick={onTagClick}
					/>
				) : null}
			</span>
		</div>
	);
}
