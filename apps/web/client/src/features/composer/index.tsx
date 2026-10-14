/**
 * Composer feature slot, mounted by App.tsx inside `.composer-zone`:
 * `form#composer.composer` (legacy index.html 847-1007, app.js 2354-2985,
 * 3256-3273, 3508-3549, 3576-3583, 3818-3885).
 */

import "./composer.css";

import { type FormEvent, type ReactNode, useRef, useState } from "react";
import { interruptCurrent } from "../../state/session";
import { useAppStore } from "../../state/store";
import { Icon } from "../../ui";
import { AttachControls, AttachmentList } from "./Attachments";
import { sendMessage } from "./actions";
import { ClarificationPanel } from "./ClarificationPanel";
import { ModelMenu } from "./ModelMenu";
import { ModeMenu } from "./ModeMenu";
import { PolicyMenu } from "./PolicyMenu";
import { PromptInput, resizePrompt } from "./PromptInput";
import { UsageMenu } from "./UsageMenu";

export interface ComposerProps {
	/**
	 * `#workspaceControl` from the workspace feature. Legacy markup nests it in
	 * the form after `.composer-card` (index.html 979-1006); App passes it in so
	 * the composer does not import the workspace feature.
	 */
	readonly workspaceControl?: ReactNode;
}

/** The three listbox popovers; only one is open at a time (legacy `setupPopover` `open()`). */
type ComposerMenu = "policy" | "mode" | "model";

export function Composer({ workspaceControl }: ComposerProps) {
	const form = useRef<HTMLFormElement | null>(null);
	const prompt = useRef<HTMLTextAreaElement | null>(null);
	const [openMenu, setOpenMenu] = useState<ComposerMenu | null>(null);
	const status = useAppStore((state) => state.current?.status);
	const waiting = status === "waiting";

	const menu = (name: ComposerMenu) => ({
		open: openMenu === name,
		onOpen: () => setOpenMenu(name),
		onClose: () => setOpenMenu((value) => (value === name ? null : value)),
	});

	const submit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const textarea = prompt.current;
		if (!textarea) return;
		const text = textarea.value.trim();
		if (!text) return;
		textarea.value = "";
		resizePrompt(textarea);
		void sendMessage(text).then((sent) => {
			if (sent) return;
			textarea.value = text;
			resizePrompt(textarea);
		});
	};

	return (
		<form className="composer" id="composer" ref={form} onSubmit={submit}>
			<ClarificationPanel />
			<div className="composer-card">
				<PromptInput promptRef={prompt} disabled={waiting} onSubmit={() => form.current?.requestSubmit()} />
				<AttachmentList />
				<div className="composer-controls">
					<AttachControls />
					<PolicyMenu {...menu("policy")} />
					<ModeMenu {...menu("mode")} />
					<div className="composer-right">
						<UsageMenu />
						<ModelMenu {...menu("model")} />
						<button
							className="stop-button"
							type="button"
							id="stopRun"
							hidden={status !== "running"}
							onClick={() => void interruptCurrent()}
						>
							停止
						</button>
						<button
							className="send-button"
							id="sendButton"
							type="submit"
							title="发送"
							aria-label="发送"
							disabled={waiting}
						>
							<Icon name="send" />
						</button>
					</div>
				</div>
			</div>
			{workspaceControl}
		</form>
	);
}
