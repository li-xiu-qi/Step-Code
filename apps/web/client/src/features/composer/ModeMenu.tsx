/**
 * `#modeMenu`: session modes (legacy app.js 2828-2909).
 *
 * Each mode is independent, so the picker is a set of toggles rather than a
 * radio group: goal + plan + ultraloop can all be on at once. `state.modes` is
 * the UI's record of what the user asked for. The extensions own the real
 * state but expose no query API to an embedder, so the UI cannot read it back:
 * a session restored from disk starts with everything off.
 */

import { useT } from "../../i18n";
import type { ModeId } from "../../state/store";
import { setState, useAppStore } from "../../state/store";
import type { IconName } from "../../ui";
import { toggleMode } from "./actions";
import { ControlMenu, ControlOption, PopoverGroupLabel } from "./ControlOption";
import type { ComposerMenuProps } from "./PolicyMenu";

const MODES: ReadonlyArray<{
	readonly id: ModeId;
	readonly icon: IconName;
	readonly labelKey: string;
	readonly descKey: string;
}> = [
	{ id: "goal", icon: "target", labelKey: "modeGoal", descKey: "modeGoalDesc" },
	{ id: "plan", icon: "listCheck", labelKey: "modePlan", descKey: "modePlanDesc" },
	{ id: "ultraloop", icon: "orbit", labelKey: "modeUltraloop", descKey: "modeUltraloopDesc" },
];

export function ModeMenu({ open, onOpen, onClose }: ComposerMenuProps) {
	const t = useT();
	const modes = useAppStore((state) => state.modes);
	const goalDraft = useAppStore((state) => state.goalDraft);
	const active = MODES.filter((mode) => modes[mode.id]);
	return (
		<ControlMenu
			id="modeMenu"
			triggerId="modeTrigger"
			triggerClassName="mode-control"
			title="模式"
			icon="layers"
			labelId="modeLabel"
			label={active.length ? active.map((mode) => t(mode.labelKey)).join(" + ") : t("modes")}
			popoverId="modePopover"
			open={open}
			onOpen={onOpen}
			onClose={onClose}
		>
			<PopoverGroupLabel>{t("modes")}</PopoverGroupLabel>
			{MODES.map((mode) => (
				<ControlOption
					key={mode.id}
					id={mode.id}
					icon={mode.icon}
					title={t(mode.labelKey)}
					description={t(mode.descKey)}
					selected={Boolean(modes[mode.id])}
					onSelect={(id) => {
						// Goal needs text: switching it on keeps the panel open.
						if (toggleMode(id)) onClose();
					}}
				/>
			))}
			<PopoverGroupLabel>{t("modeHint")}</PopoverGroupLabel>
			{modes.goal ? (
				<div className="control-popover-goal">
					{/*
					 * Legacy wired only `input` here. Enter falls through to the
					 * browser's implicit submission of `#composer`, as before.
					 */}
					<input
						type="text"
						placeholder={t("goalPlaceholder")}
						value={goalDraft ?? ""}
						onChange={(event) => setState({ goalDraft: event.target.value })}
					/>
				</div>
			) : null}
		</ControlMenu>
	);
}
