/**
 * Conversation actions that call the host API (legacy app.js 2187-2204, 2315-2343).
 */

import { t } from "../../i18n";
import { apiSend, errorMessage } from "../../lib/api";
import { forgetApproval, openSession, refreshSessions, showError } from "../../state/session";
import { getState } from "../../state/store";

export type ApprovalVerdict = "deny" | "approve" | "approve_for_session";

/** Branch the current session at `entryId` (or at its end) and follow the fork (legacy `forkAtEntry`). */
export async function forkAtEntry(entryId: string | undefined): Promise<void> {
	const current = getState().current;
	if (!current) return;
	try {
		const result = await apiSend<{ cancelled?: boolean; sessionId: string }>(
			`/api/v1/sessions/${current.id}/fork`,
			"POST",
			{ ...(entryId ? { entryId } : {}) },
		);
		if (result.cancelled) {
			showError(t("forkCancelled"));
			return;
		}
		// The fork binds a new session underneath; follow it.
		await openSession(result.sessionId);
		await refreshSessions();
	} catch (error) {
		showError(errorMessage(error));
	}
}

/**
 * Send an approval verdict for the current session. Resolves true when the
 * server accepted it; errors are reported in the toast (legacy `buildApproval` click handler).
 */
export async function decideApproval(approvalId: string, verdict: ApprovalVerdict): Promise<boolean> {
	try {
		const current = getState().current;
		if (!current) throw new Error("No current session");
		await apiSend(`/api/v1/sessions/${current.id}/approvals/decision`, "POST", { id: approvalId, verdict });
		forgetApproval(approvalId);
		return true;
	} catch (error) {
		showError(errorMessage(error));
		return false;
	}
}
