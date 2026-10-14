/**
 * Files feature slots, mounted by App.tsx at their legacy DOM positions:
 * `#fileTree` in the sidebar, `#previewShow` in the main column and
 * `aside#previewPanel`. Cross-feature entry points live in ./actions.ts.
 */

import "./files.css";

export { FileTreePanel } from "./FileTreePanel";
export { PreviewPanel, PreviewShowButton } from "./PreviewPanel";
