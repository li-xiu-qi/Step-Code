/**
 * Composer state changes, ported from legacy app.js. Each function updates the
 * store (and the server); the composer components re-render from the store.
 */

import { t } from "../../i18n";
import { api, apiSend, errorMessage } from "../../lib/api";
import { createSessionIfNeeded, renderSnapshot, showError } from "../../state/session";
import { getState, type ModeId, setState } from "../../state/store";
import type { Attachment, ClarificationReply, ClarificationRequest, SessionSnapshot } from "../../state/types";

export async function replyToClarification(
	request: ClarificationRequest,
	answers: readonly ClarificationReply[],
	cancelled = false,
): Promise<boolean> {
	try {
		await apiSend(`/api/v1/sessions/${request.sessionId}/clarifications/response`, "POST", {
			id: request.id,
			answers,
			cancelled,
		});
		return true;
	} catch (error) {
		showError(errorMessage(error));
		return false;
	}
}

/* ── Permission policy (legacy renderPolicies onSelect 2534-2541, `policychange` 3509-3522) ── */

/** Make `preset` the draft policy and, with a session open, apply it there. */
export async function selectPolicy(preset: string): Promise<void> {
	setState({ draftPolicy: preset });
	const current = getState().current;
	if (!current) return;
	try {
		renderSnapshot(await apiSend<SessionSnapshot>(`/api/v1/sessions/${current.id}/policy`, "PATCH", { preset }));
	} catch (error) {
		showError(errorMessage(error));
	}
}

/* ── Model and thinking effort (legacy selectModel / selectEffort, 2746-2776) ── */

/**
 * Apply a model (`${provider}\u0000${id}`). Resolves true when the server
 * returned a new snapshot, so the open panel can repaint as legacy did.
 */
export async function selectModel(value: string): Promise<boolean> {
	const [provider, modelId] = value.split("\u0000");
	setState({ draftModel: value });
	const current = getState().current;
	if (!current) return false;
	try {
		renderSnapshot(
			await apiSend<SessionSnapshot>(`/api/v1/sessions/${current.id}/model`, "PATCH", { provider, modelId }),
		);
		return true;
	} catch (error) {
		showError(errorMessage(error));
		return false;
	}
}

/** Apply a thinking level. Resolves true on success (the panel then closes). */
export async function selectEffort(level: string): Promise<boolean> {
	const current = getState().current;
	if (!current) return false;
	try {
		renderSnapshot(await apiSend<SessionSnapshot>(`/api/v1/sessions/${current.id}/thinking`, "PATCH", { level }));
		return true;
	} catch (error) {
		showError(errorMessage(error));
		return false;
	}
}

/* ── Session modes (legacy toggleMode, 2879-2903) ─────────────────────────── */

function setMode(id: ModeId, enabled: boolean): void {
	setState((state) => ({ modes: { ...state.modes, [id]: enabled } }));
}

/**
 * Flip one mode. Returns whether the mode panel should close: switching goal
 * on keeps it open so the goal can be typed, and sends nothing yet.
 */
export function toggleMode(id: ModeId): boolean {
	const next = !getState().modes[id];
	setMode(id, next);
	if (id === "goal" && next) return false;
	void sendModeToggle(id, next);
	return true;
}

async function sendModeToggle(id: ModeId, next: boolean): Promise<void> {
	const current = getState().current;
	if (!current) return;
	try {
		// The server accepts the toggle and runs the slash command in the
		// background, so there is no snapshot to render from the response.
		await apiSend(`/api/v1/sessions/${current.id}/mode`, "PATCH", {
			mode: id,
			enabled: next,
			goal: getState().goalDraft,
		});
		if (id === "goal" && next) setState({ goalDraft: "" });
	} catch (error) {
		setMode(id, !next);
		showError(errorMessage(error));
	}
}

/* ── Attachments (legacy 2919-2985) ──────────────────────────────────────── */

/** Attachments staged for the next message, cleared once it is sent. */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

function readFileAsBase64(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			const result = String(reader.result);
			resolve(result.slice(result.indexOf(",") + 1));
		};
		reader.onerror = () => reject(reader.error ?? new Error(t("attachmentUnreadable")));
		reader.readAsDataURL(file);
	});
}

/** Read each file (up to 5 MB) and stage it; oversized or unreadable files raise a toast. */
export async function addAttachments(files: readonly File[]): Promise<void> {
	for (const file of files) {
		if (file.size > MAX_ATTACHMENT_BYTES) {
			showError(t("attachmentTooLarge"));
			continue;
		}
		try {
			const attachment: Attachment = {
				name: file.name,
				mimeType: file.type || "application/octet-stream",
				data: await readFileAsBase64(file),
				kind: file.type.startsWith("image/") ? "image" : "text",
			};
			setState((state) => ({ attachments: [...state.attachments, attachment] }));
		} catch (error) {
			showError((error instanceof Error && error.message) || t("attachmentUnreadable"));
		}
	}
}

export function removeAttachment(index: number): void {
	setState((state) => ({ attachments: state.attachments.filter((_, position) => position !== index) }));
}

/* ── Sending (legacy `#composer` submit, 3523-3549) ──────────────────────── */

/**
 * Send `text` with the staged attachments, creating the session first when
 * this is a draft. The caller has already cleared the prompt; on failure the
 * attachments are restored here and false is returned so the caller can put
 * the text back.
 */
export async function sendMessage(text: string): Promise<boolean> {
	// Attachments are sent with the message and dropped afterwards, so a failed
	// send has to put both back.
	const attachments = getState().attachments;
	setState({ attachments: [] });
	try {
		const session = await createSessionIfNeeded();
		const endpoint = session.status === "running" ? "steer" : "messages";
		await api(`/api/v1/sessions/${session.id}/${endpoint}`, {
			method: "POST",
			body: JSON.stringify({ text, attachments }),
		});
		return true;
	} catch (error) {
		setState({ attachments });
		showError(errorMessage(error));
		return false;
	}
}
