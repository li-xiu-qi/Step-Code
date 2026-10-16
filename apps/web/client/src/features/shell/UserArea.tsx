/**
 * `.user-area` at the foot of the sidebar: the signed-in account on the left,
 * and two icon buttons on the right. The phone button is a placeholder for
 * mobile remote control (not available yet); the gear opens the settings view.
 */

import { type TranslateFn, useT } from "../../i18n";
import { useAppStore } from "../../state/store";
import type { LoginReport } from "../../state/types";
import { Icon } from "../../ui";
import { openSettings } from "../settings/actions";

function accountName(t: TranslateFn, login: LoginReport | null): string {
	if (!login?.configured) return t("footerSignedOut");
	if (login.source === "environment") return t("footerApiKey");
	return login.profile?.startsWith("step_plan") ? "Step Plan" : t("footerApiKey");
}

export function UserArea() {
	const t = useT();
	const login = useAppStore((state) => state.login);
	const name = accountName(t, login);
	return (
		<div className="user-area">
			<button
				type="button"
				className="user-account"
				id="userAccountButton"
				aria-label={t("footerAccount", { name })}
				onClick={() => openSettings("general")}
			>
				<span className="user-avatar" aria-hidden="true">
					{name.slice(0, 1).toUpperCase()}
				</span>
				<span className="user-name">{name}</span>
			</button>
			<div className="user-actions">
				<span className="footer-tip-anchor">
					<button
						type="button"
						className="footer-icon-button"
						id="remoteControlButton"
						aria-label={t("remoteControl")}
						aria-describedby="remoteControlTip"
						aria-disabled="true"
					>
						<Icon name="phone" size="md" />
					</button>
					<span className="footer-tooltip" id="remoteControlTip" role="tooltip">
						<strong>{t("remoteControl")}</strong>
						<span>{t("remoteControlOff")}</span>
					</span>
				</span>
				<span className="footer-tip-anchor">
					<button
						type="button"
						className="footer-icon-button"
						id="settingsButton"
						aria-label={t("settings")}
						aria-describedby="settingsButtonTip"
						onClick={() => openSettings()}
					>
						<Icon name="cog" size="md" />
					</button>
					<span className="footer-tooltip compact" id="settingsButtonTip" role="tooltip">
						<strong>{t("settings")}</strong>
					</span>
				</span>
			</div>
		</div>
	);
}
