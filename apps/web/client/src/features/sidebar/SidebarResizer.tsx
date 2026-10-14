import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { useT } from "../../i18n";
import { readStoredInt, STORAGE_KEYS, writeStorage } from "../../lib/storage";
import { getState, setUi } from "../../state/store";
import { ResizeHandle } from "../../ui";

/* Legacy app.js 3275-3280. */
const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 480;
const SIDEBAR_DEFAULT = 260;
const SIDEBAR_KEYBOARD_STEP = 8;
const SIDEBAR_KEYBOARD_STEP_LARGE = 32;

function sidebarMaxWidth(): number {
	return Math.min(SIDEBAR_MAX, Math.round(window.innerWidth * 0.6));
}

function clampSidebarWidth(width: number): number {
	return Math.min(sidebarMaxWidth(), Math.max(SIDEBAR_MIN, Math.round(width)));
}

/**
 * The width actually applied, *not* re-clamped. Callers compare this against a
 * freshly clamped value to decide whether anything changed, so clamping here
 * would hide a width that has grown past the current viewport limit.
 * Without an inline width it is the CSS value (260px, 222px on narrow viewports).
 */
function currentSidebarWidth(): number {
	const applied = getState().ui.sidebarWidth;
	if (applied !== null) return applied;
	const app = document.querySelector(".app");
	const parsed = app ? Number.parseInt(getComputedStyle(app).getPropertyValue("--sidebar-width"), 10) : Number.NaN;
	return Number.isFinite(parsed) ? parsed : SIDEBAR_DEFAULT;
}

/** `#sidebarResizer` (legacy index.html 772-783, `initSidebarResizer` 3275-3381). */
export function SidebarResizer() {
	const t = useT();
	// Legacy markup starts at 260 / 480; applySidebarWidth keeps both in step afterwards.
	const [aria, setAria] = useState({ now: SIDEBAR_DEFAULT, max: SIDEBAR_MAX });

	const applySidebarWidth = useCallback((width: number, persist = true) => {
		const resolved = clampSidebarWidth(width);
		setUi({ sidebarWidth: resolved });
		setAria({ now: resolved, max: sidebarMaxWidth() });
		if (persist) writeStorage(STORAGE_KEYS.sidebarWidth, String(resolved));
		return resolved;
	}, []);

	useLayoutEffect(() => {
		const stored = readStoredInt(STORAGE_KEYS.sidebarWidth);
		if (stored !== undefined) applySidebarWidth(stored, false);
	}, [applySidebarWidth]);

	// A width remembered on a wide window must not survive into a narrow one, and
	// the narrow-viewport media query cannot win against the inline variable.
	useEffect(() => {
		const onResize = () => {
			const current = currentSidebarWidth();
			const clamped = clampSidebarWidth(current);
			if (clamped !== current) applySidebarWidth(clamped, false);
		};
		window.addEventListener("resize", onResize);
		return () => window.removeEventListener("resize", onResize);
	}, [applySidebarWidth]);

	return (
		<ResizeHandle
			bare
			className="sidebar-resizer"
			id="sidebarResizer"
			aria-valuemin={SIDEBAR_MIN}
			aria-valuemax={aria.max}
			value={aria.now}
			title={t("resizeSidebar")}
			aria-label={t("resizeSidebar")}
			getSize={currentSidebarWidth}
			onResize={(width) => applySidebarWidth(width, false)}
			onCommit={(width) => applySidebarWidth(width)}
			onReset={() => applySidebarWidth(SIDEBAR_DEFAULT)}
			onDraggingChange={(dragging) => {
				setUi({ resizing: dragging });
				document.body.style.cursor = dragging ? "col-resize" : "";
			}}
			step={SIDEBAR_KEYBOARD_STEP}
			largeStep={SIDEBAR_KEYBOARD_STEP_LARGE}
			min={SIDEBAR_MIN}
			max={sidebarMaxWidth}
		/>
	);
}
