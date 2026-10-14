/**
 * `.user-area` at the foot of the sidebar: the settings gear and its popover
 * (legacy index.html 675-769; behaviour app.js 528-549, 3195-3243, 3427-3454,
 * 3590-3595).
 */

import { type MouseEvent, useRef } from "react";
import { type TranslateFn, useT } from "../../i18n";
import type { Locale } from "../../i18n/messages";
import { shallowEqual, type ThemeChoice, useAppStore } from "../../state/store";
import { Icon, MenuDivider, MenuItem, useDismiss } from "../../ui";
import {
	applyLocale,
	applyTheme,
	closePreferenceSubmenus,
	logout,
	type PreferenceSubmenu,
	togglePreferenceSubmenu,
	toggleUserMenu,
} from "./actions";

const STEP_PLAN_URL = "https://platform.stepfun.com/step-plan";

const THEME_CHOICES: ReadonlyArray<{ readonly value: ThemeChoice; readonly label: string }> = [
	{ value: "system", label: "themeSystem" },
	{ value: "light", label: "themeLight" },
	{ value: "dark", label: "themeDark" },
];

/** Language names are shown in their own language, never translated (legacy index.html 738-743). */
const LANGUAGE_CHOICES: ReadonlyArray<{ readonly value: Locale; readonly label: string }> = [
	{ value: "zh-CN", label: "简体中文" },
	{ value: "en-US", label: "English" },
];

function themeLabel(t: TranslateFn, theme: ThemeChoice): string {
	return t(theme === "system" ? "themeSystem" : theme === "dark" ? "themeDark" : "themeLight");
}

export function UserArea() {
	const t = useT();
	const view = useAppStore(
		(state) => ({
			open: state.ui.userMenuOpen,
			submenu: state.ui.preferenceSubmenu,
			theme: state.theme,
			locale: state.locale,
		}),
		shallowEqual,
	);
	const popoverRef = useRef<HTMLDivElement>(null);
	const buttonRef = useRef<HTMLButtonElement>(null);

	// Legacy document click handler (3590-3595): any click outside the popover,
	// the gear and the submenus (both inside the popover here) closes it.
	// Escape is the shell's central chain (ShellEffects), not this hook.
	useDismiss({
		enabled: view.open,
		insideRefs: [popoverRef, buttonRef],
		event: "click",
		escape: false,
		onDismiss: () => toggleUserMenu(false),
	});

	// The legacy rows stopped propagation so their own click could not reach
	// the document handlers that close this and the other open menus (3427-3441).
	const onGearClick = (event: MouseEvent) => {
		event.stopPropagation();
		toggleUserMenu();
	};
	const onSubmenuClick = (kind: PreferenceSubmenu) => (event: MouseEvent) => {
		event.stopPropagation();
		togglePreferenceSubmenu(kind);
	};

	return (
		<div className="user-area">
			<div className="user-popover" id="userPopover" ref={popoverRef} hidden={!view.open}>
				<a
					className="user-menu-item"
					id="stepPlanLink"
					href={STEP_PLAN_URL}
					target="_blank"
					rel="noopener noreferrer"
				>
					<Icon name="external" />
					<span>{t("upgrade")}</span>
					<Icon name="upgrade" size="xs" className="menu-trailing" />
				</a>
				<MenuItem
					bare
					className="user-menu-item"
					id="themeMenuItem"
					icon="theme"
					aria-expanded={view.submenu === "theme"}
					onClick={onSubmenuClick("theme")}
				>
					<span>{t("appearance")}</span>
					<small id="themeValue">{themeLabel(t, view.theme)}</small>
					<Icon name="chevronRight" size="menu" className="menu-chevron" />
				</MenuItem>
				<div className="user-submenu theme-submenu" id="themeSubmenu" hidden={view.submenu !== "theme"}>
					{THEME_CHOICES.map((choice) => (
						<button
							key={choice.value}
							type="button"
							className={view.theme === choice.value ? "active" : undefined}
							data-theme-choice={choice.value}
							onClick={() => {
								applyTheme(choice.value);
								closePreferenceSubmenus();
							}}
						>
							<span>{t(choice.label)}</span>
							<i />
						</button>
					))}
				</div>
				<MenuItem
					bare
					className="user-menu-item"
					id="languageMenuItem"
					icon="language"
					aria-expanded={view.submenu === "language"}
					onClick={onSubmenuClick("language")}
				>
					<span>{t("language")}</span>
					<small id="languageValue">{view.locale === "en-US" ? "English" : "简体中文"}</small>
					<Icon name="chevronRight" size="menu" className="menu-chevron" />
				</MenuItem>
				<div className="user-submenu language-submenu" id="languageSubmenu" hidden={view.submenu !== "language"}>
					{LANGUAGE_CHOICES.map((choice) => (
						<button
							key={choice.value}
							type="button"
							className={view.locale === choice.value ? "active" : undefined}
							data-language-choice={choice.value}
							onClick={() => {
								applyLocale(choice.value);
								closePreferenceSubmenus();
							}}
						>
							<span>{choice.label}</span>
							<i />
						</button>
					))}
				</div>
				<MenuDivider bare className="user-menu-divider" />
				<MenuItem
					bare
					danger
					className="user-menu-item"
					id="logoutMenuItem"
					icon="logout"
					onClick={() => void logout()}
				>
					<span>{t("logout")}</span>
				</MenuItem>
			</div>
			<button
				className="user-button"
				id="userMenuButton"
				ref={buttonRef}
				type="button"
				aria-expanded={view.open}
				aria-haspopup="menu"
				onClick={onGearClick}
			>
				<Icon name="settings" />
				<span className="user-name">{t("settings")}</span>
			</button>
		</div>
	);
}
