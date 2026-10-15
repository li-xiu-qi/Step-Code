import { useEffect, useRef } from "react";
import { useT } from "../../i18n";
import { basename } from "../../lib/format";
import { useAppStore } from "../../state/store";
import { Button, IconButton, Modal } from "../../ui";
import { closeWorkspaceRemoval, removeWorkspace } from "./actions";

/** Workspace removal changes navigation only. Escape belongs to ShellEffects. */
export function RemoveWorkspaceModal() {
	const t = useT();
	const removal = useAppStore((state) => state.ui.workspaceRemoval);
	const cancelRef = useRef<HTMLButtonElement>(null);
	const dialogRef = useRef<HTMLElement>(null);
	const path = removal?.path;
	const pending = removal?.pending ?? false;
	useEffect(() => {
		if (!path) return;
		const previous = document.activeElement;
		cancelRef.current?.focus();
		return () => {
			if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
			else document.getElementById("prompt")?.focus();
		};
	}, [path]);
	useEffect(() => {
		if (!path) return;
		// Disabling every button must not send keyboard focus behind the modal.
		if (pending) dialogRef.current?.focus();
		else cancelRef.current?.focus();
	}, [path, pending]);
	return (
		<Modal
			id="removeWorkspaceModal"
			className="remove-workspace-dialog"
			open={Boolean(removal)}
			labelledBy="removeWorkspaceTitle"
			onClose={closeWorkspaceRemoval}
			dialogProps={{
				ref: dialogRef,
				"aria-describedby": "removeWorkspaceDescription",
				"aria-busy": pending,
				tabIndex: -1,
				onKeyDown: (event) => {
					if (event.key !== "Tab") return;
					const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
					const first = buttons[0];
					const last = buttons[buttons.length - 1];
					if (!first) {
						event.preventDefault();
						event.currentTarget.focus();
					} else if (event.shiftKey && document.activeElement === first) {
						event.preventDefault();
						last?.focus();
					} else if (!event.shiftKey && document.activeElement === last) {
						event.preventDefault();
						first.focus();
					}
				},
			}}
		>
			<header>
				<h2 id="removeWorkspaceTitle">{t("removeWorkspaceTitle", { name: path ? basename(path) : "" })}</h2>
				<IconButton
					icon="close"
					aria-label={t("closeRemoveWorkspace")}
					disabled={pending}
					onClick={closeWorkspaceRemoval}
				/>
			</header>
			<p id="removeWorkspaceDescription">{t("removeWorkspaceDescription")}</p>
			<footer>
				<Button ref={cancelRef} id="removeWorkspaceCancel" disabled={pending} onClick={closeWorkspaceRemoval}>
					{t("cancel")}
				</Button>
				<Button id="removeWorkspaceConfirm" disabled={pending} onClick={() => void removeWorkspace()}>
					{t("removeWorkspaceConfirm")}
				</Button>
			</footer>
		</Modal>
	);
}
