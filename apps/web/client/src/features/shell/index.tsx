/**
 * Shell feature slots, mounted by App.tsx at their legacy DOM positions:
 * `UserArea` (`.user-area`), `SidebarShowButton` (`#sidebarShow`),
 * `ErrorToast` (`#errorToast`), `AuthBanner` (`#authBanner`),
 * `LoggedOutOverlay` (`#loggedOutOverlay`) and `ShellEffects` (document
 * listeners). See client/MIGRATION_MAP.md.
 */

import "./shell.css";

export { ShellEffects } from "./ShellEffects";
export { AuthBanner, ErrorToast, LoggedOutOverlay, SidebarShowButton } from "./Surfaces";
export { UserArea } from "./UserArea";
