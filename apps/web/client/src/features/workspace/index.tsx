/**
 * Workspace feature slots, mounted by App.tsx at their legacy DOM positions:
 * `WorkspaceControl` inside the composer form and `WorkspaceBrowserModal`
 * after `.app`. Cross-feature actions live in ./actions.ts. See client/MIGRATION_MAP.md.
 */

import "./workspace.css";

export { WorkspaceBrowserModal } from "./WorkspaceBrowserModal";
export { WorkspaceControl } from "./WorkspaceControl";
