import type { MouseEvent } from "react";
import { useT } from "../../i18n";
import { basename, cx } from "../../lib/format";
import { startDraft } from "../../state/session";
import type { SessionSummary } from "../../state/types";
import { EmptyState, Icon, IconButton, LEGACY_ICONS } from "../../ui";
import { openTree } from "../files/actions";
import { requestWorkspaceRemoval } from "../workspace/actions";
import { toggleProjectFolded } from "./actions";
import { SessionRow } from "./SessionRow";

export interface ProjectGroupProps {
	readonly cwd: string;
	readonly sessions: readonly SessionSummary[];
	readonly folded: boolean;
	/** Session ids hidden by the tag filter. */
	readonly hiddenIds: ReadonlySet<string>;
	/** The whole group is hidden by the tag filter. */
	readonly filteredOut: boolean;
}

/** `section.project-group[data-cwd]` (legacy `renderSessionLists`, 848-885). */
export function ProjectGroup({ cwd, sessions, folded, hiddenIds, filteredOut }: ProjectGroupProps) {
	const t = useT();
	const action = (run: () => void) => (event: MouseEvent<HTMLButtonElement>) => {
		event.stopPropagation();
		run();
	};
	return (
		<section
			className={cx("project-group", folded && "folded")}
			data-cwd={cwd}
			style={filteredOut ? { display: "none" } : undefined}
		>
			{/* The whole bar toggles the group; no separate disclosure control (legacy markup). */}
			{/* biome-ignore lint/a11y/noStaticElementInteractions: legacy header is a plain clickable div; its buttons stay keyboard reachable. */}
			{/* biome-ignore lint/a11y/useKeyWithClickEvents: see above. */}
			<div className="project-header" onClick={() => toggleProjectFolded(cwd)}>
				<Icon {...LEGACY_ICONS.folder} />
				<span className="project-name">{basename(cwd)}</span>
				<span className="project-actions">
					<IconButton
						className="project-action tree-button"
						data-tooltip={t("fileTree")}
						aria-label={t("fileTree")}
						onClick={action(() => void openTree({ cwd }))}
					>
						<Icon {...LEGACY_ICONS.tree} />
					</IconButton>
					<IconButton
						className="project-action new-project-session"
						data-tooltip={t("newConversationInWorkspace")}
						aria-label={t("newConversationInWorkspace")}
						onClick={action(() => startDraft(cwd))}
					>
						<Icon {...LEGACY_ICONS.plus} />
					</IconButton>
					<IconButton
						className="project-action remove-workspace"
						data-tooltip={t("removeWorkspace")}
						aria-label={t("removeWorkspace")}
						onClick={action(() => requestWorkspaceRemoval(cwd))}
					>
						<Icon name="close-sm" size="sm" />
					</IconButton>
				</span>
			</div>
			<div className="project-sessions">
				<div>
					{sessions.map((session) => (
						<SessionRow key={session.id} session={session} filteredOut={hiddenIds.has(session.id)} />
					))}
					{sessions.length ? null : <EmptyState>{t("noConversationsYet")}</EmptyState>}
				</div>
			</div>
		</section>
	);
}
