/**
 * Shell actions with fixed names, callable from any feature. The shell feature
 * owns this file; legacy app.js line numbers are noted per function.
 */

import { t } from "../../i18n";
import type { Locale } from "../../i18n/messages";
import { api, errorMessage } from "../../lib/api";
import { STORAGE_KEYS, writeStorage } from "../../lib/storage";
import { closeStream, showError } from "../../state/session";
import { getState, setState, setUi, type ThemeChoice } from "../../state/store";

const THEMES: readonly ThemeChoice[] = ["system", "light", "dark"];

/** Settings submenus that unfold inside `#userPopover`. */
export type PreferenceSubmenu = "theme" | "language";

function systemPrefersDark(): boolean {
	return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
}

/** "light" or "dark" for a theme choice (legacy `resolvedTheme`, 524-526). */
export function resolvedTheme(theme: ThemeChoice = getState().theme): "light" | "dark" {
	return theme === "system" ? (systemPrefersDark() ? "dark" : "light") : theme;
}

/**
 * Apply and (by default) persist a theme choice (legacy `applyTheme`, 559-564).
 * Writes `<html data-theme>` directly so the first paint is already themed.
 * `renderPreferenceControls` is gone: `UserArea` re-renders from the store.
 */
export function applyTheme(theme: string, persist = true): void {
	const next: ThemeChoice = THEMES.includes(theme as ThemeChoice) ? (theme as ThemeChoice) : "system";
	setState({ theme: next });
	document.documentElement.dataset.theme = resolvedTheme(next);
	if (persist) writeStorage(STORAGE_KEYS.theme, next);
}

/**
 * Apply and (by default) persist a locale (legacy `applyLocale`, 566-601).
 * Re-translating the page is automatic: components read the locale from the store.
 */
export function applyLocale(locale: string, persist = true): void {
	const next: Locale = locale === "en-US" ? "en-US" : "zh-CN";
	setState({ locale: next });
	document.documentElement.lang = next;
	if (persist) writeStorage(STORAGE_KEYS.locale, next);
}

/**
 * Open, close (`force`) or toggle the settings popover (legacy `toggleUserMenu`,
 * 3195-3201). Closing it also folds the theme/language submenus.
 */
export function toggleUserMenu(force?: boolean): void {
	setUi((ui) => {
		const open = force ?? !ui.userMenuOpen;
		return open ? { userMenuOpen: true } : { userMenuOpen: false, preferenceSubmenu: null };
	});
}

/** Fold both settings submenus (legacy `closePreferenceSubmenus`, 3203-3208). */
export function closePreferenceSubmenus(): void {
	setUi({ preferenceSubmenu: null });
}

/**
 * Unfold one settings submenu and fold the other, or fold it when it is
 * already open (legacy `togglePreferenceSubmenu`, 3210-3222).
 */
export function togglePreferenceSubmenu(kind: PreferenceSubmenu): void {
	setUi((ui) => ({ preferenceSubmenu: ui.preferenceSubmenu === kind ? null : kind }));
}

/** Show or hide the sidebar (legacy `.app.classList.toggle("sidebar-hidden")`, 3383-3388, 3627). */
export function toggleSidebar(): void {
	setUi((ui) => ({ sidebarHidden: !ui.sidebarHidden }));
}

/**
 * Log out after a confirm, close the live stream and cover the page with the
 * logged-out overlay (legacy `logout`, 3233-3243).
 */
export async function logout(): Promise<void> {
	if (!window.confirm(t("confirmLogout"))) return;
	try {
		await api("/auth/logout", { method: "POST", body: "{}" });
		closeStream();
		toggleUserMenu(false);
		setUi({ loggedOut: true });
	} catch (error) {
		showError(errorMessage(error));
	}
}

/**
 * Follow the OS theme while the choice is "system" (legacy 3647-3649).
 * Returns the cleanup function.
 */
export function watchSystemTheme(): () => void {
	if (typeof matchMedia !== "function") return () => {};
	const query = matchMedia("(prefers-color-scheme: dark)");
	const onChange = () => {
		if (getState().theme === "system") applyTheme("system", false);
	};
	query.addEventListener("change", onChange);
	return () => query.removeEventListener("change", onChange);
}
