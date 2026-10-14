import { useRef } from "react";
import { useT } from "../../i18n";
import { basename } from "../../lib/format";
import { knownWorkspaces, startDraft } from "../../state/session";
import { shallowEqual, useAppStore } from "../../state/store";
import { EmptyState, Icon, LEGACY_ICONS, Popover } from "../../ui";
import { chooseWorkspaceFolder, closeWorkspacePopover, openWorkspacePopover } from "./actions";

/**
 * `#workspaceControl` inside the composer form (legacy index.html 979-1006,
 * `renderWorkspaceOptions` 1097-1123, wiring 3461-3465 and 3596-3597).
 *
 * Hidden while a session is open. Before bootstrap there is no folder yet, and
 * `basename()` would render its "recent" placeholder as if it were a workspace
 * name, so the neutral "Workspace" label stays until a real path arrives.
 */
export function WorkspaceControl() {
	const t = useT();
	const buttonRef = useRef<HTMLButtonElement | null>(null);
	const view = useAppStore(
		(state) => ({
			hidden: Boolean(state.current),
			cwd: state.draftCwd || state.bootstrapCwd,
			draftCwd: state.draftCwd,
			open: state.ui.workspacePopoverOpen,
		}),
		shallowEqual,
	);
	const workspaces = useAppStore(knownWorkspaces, shallowEqual);
	return (
		<div className="workspace-control" id="workspaceControl" hidden={view.hidden}>
			<Icon name="folder" size="md" />
			<button
				ref={buttonRef}
				id="workspaceButton"
				type="button"
				aria-expanded={view.open}
				onClick={() => openWorkspacePopover()}
			>
				<span id="workspaceButtonName">{view.cwd ? basename(view.cwd) : "Workspace"}</span>
			</button>
			<Icon name="chevron" size="2xs" className="chevron" />
			<Popover
				bare
				className="workspace-popover"
				id="workspacePopover"
				open={view.open}
				onClose={() => closeWorkspacePopover()}
				ignoreRefs={[buttonRef]}
				dismissOn="click"
				closeOnEscape={false}
			>
				<div className="workspace-popover-title">{t("recentFolders")}</div>
				<div id="workspaceRecentList">
					{workspaces.map((path) => (
						<RecentItem key={path} path={path} selected={path === view.draftCwd} />
					))}
					{workspaces.length ? null : <EmptyState>{t("emptyDirectory")}</EmptyState>}
				</div>
				<div className="workspace-popover-divider" />
				<button
					className="workspace-browse-button"
					id="workspaceBrowseButton"
					type="button"
					onClick={() => {
						closeWorkspacePopover();
						void chooseWorkspaceFolder();
					}}
				>
					<Icon name="folderPlus" size="md" />
					<span>{t("chooseFolder")}</span>
				</button>
			</Popover>
		</div>
	);
}

function RecentItem({ path, selected }: { readonly path: string; readonly selected: boolean }) {
	return (
		<button
			type="button"
			className={`workspace-recent-item${selected ? " selected" : ""}`}
			onClick={() => {
				startDraft(path);
				closeWorkspacePopover();
			}}
		>
			<Icon {...LEGACY_ICONS.folder} />
			<span>
				<strong>{basename(path)}</strong>
				<small>{path}</small>
			</span>
			{selected ? <span className="workspace-check">✓</span> : null}
		</button>
	);
}
