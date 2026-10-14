import type { MouseEvent } from "react";
import { t, useT } from "../../i18n";
import { apiSend, errorMessage } from "../../lib/api";
import { refreshSessions, sessionTitle, showError, startDraft } from "../../state/session";
import { getState, useAppStore } from "../../state/store";
import type { SessionSummary } from "../../state/types";
import { ContextMenu } from "../../ui";
import { closeSessionMenu } from "./actions";
import { useOutsideClick } from "./useOutsideClick";

type SessionAction = "rename" | "archive" | "delete";

/** Rename / archive / delete one session (legacy `openSessionMenu` click handler, 1297-1328). */
async function runSessionAction(action: SessionAction, session: SessionSummary): Promise<void> {
	try {
		if (action === "rename") {
			const name = window.prompt(t("rename"), sessionTitle(session));
			if (name?.trim()) await apiSend(`/api/v1/sessions/${session.id}/name`, "PATCH", { name: name.trim() });
		}
		if (action === "archive") {
			await apiSend(`/api/v1/sessions/${session.id}/archive`, "PATCH", { archived: !session.archived });
		}
		if (action === "delete" && window.confirm(t("confirmDelete", { name: sessionTitle(session) }))) {
			await apiSend(`/api/v1/sessions/${session.id}`, "DELETE");
			const state = getState();
			if (state.current?.id === session.id) startDraft(state.bootstrapCwd);
		}
		await refreshSessions();
	} catch (error) {
		showError(errorMessage(error));
	}
}

/** `#sessionMenu`, the per-session context menu (legacy index.html 1010, app.js 1287-1329). */
export function SessionMenu() {
	const translate = useT();
	const menu = useAppStore((state) => state.ui.sessionMenu);
	const session = useAppStore((state) =>
		menu ? state.sessions.find((candidate) => candidate.id === menu.sessionId) : undefined,
	);
	useOutsideClick(Boolean(menu), "#sessionMenu,.session-menu-button", closeSessionMenu);

	const onClick = (event: MouseEvent<HTMLDivElement>) => {
		const action = (event.target as Element).closest<HTMLElement>("[data-action]")?.dataset.action;
		if (!action || !session) return;
		closeSessionMenu();
		void runSessionAction(action as SessionAction, session);
	};

	return (
		<ContextMenu
			bare
			className="context-menu"
			id="sessionMenu"
			open={Boolean(menu && session)}
			x={menu?.x ?? 0}
			y={menu?.y ?? 0}
			onClick={onClick}
		>
			{session ? (
				<>
					<button type="button" data-action="rename">
						{translate("rename")}
					</button>
					<button type="button" data-action="archive">
						{session.archived ? translate("restore") : translate("archive")}
					</button>
					<button className="danger" type="button" data-action="delete">
						{translate("delete")}
					</button>
				</>
			) : null}
		</ContextMenu>
	);
}
