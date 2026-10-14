/**
 * `#modelMenu`: one panel for model and thinking effort, in two views
 * (legacy app.js 2558-2826, `populateModels` 2987-2990).
 *
 * They are chosen together — effort is a property of a model, and the kernel
 * only exposes the levels a given model supports — so splitting them into two
 * popovers meant guessing the effort before knowing the model.
 *
 * The default view stays short: a few models, the effort as a segmented
 * control, and a "more models" row. Search and pinning live behind that row,
 * because a catalog of five needs neither and a catalog of fifty needs both.
 */

import { useEffect, useState } from "react";
import { useT } from "../../i18n";
import { useAppStore } from "../../state/store";
import { selectEffort, selectModel } from "./actions";
import { ControlMenu } from "./ControlOption";
import { ModelPanel, type ModelPanelView } from "./ModelPanel";
import { EMPTY_MODEL_SOURCE, type ModelSource, modelLabel, readPinnedModels, togglePinnedModel } from "./models";
import type { ComposerMenuProps } from "./PolicyMenu";

export function ModelMenu({ open, onOpen, onClose }: ComposerMenuProps) {
	const t = useT();
	const current = useAppStore((state) => state.current);
	const [view, setView] = useState<ModelPanelView>("compact");
	const [query, setQuery] = useState("");
	/** Bumped whenever legacy rebuilt (and refocused) the search field. */
	const [searchEpoch, setSearchEpoch] = useState(0);
	const [pinned, setPinned] = useState<readonly string[]>(readPinnedModels);
	/**
	 * Legacy painted `#modelLabel` from the last snapshot handed to
	 * `renderModelPicker`: every rendered session snapshot, and `{ models: [] }`
	 * when the panel was opened in a draft. A draft therefore keeps the previous
	 * session's label until the panel opens. Before any of that the static
	 * markup said 默认模型.
	 */
	const [labelSource, setLabelSource] = useState<ModelSource | null>(null);
	useEffect(() => {
		if (current) setLabelSource(current);
	}, [current]);
	const source: ModelSource = current ?? EMPTY_MODEL_SOURCE;
	const shownLabelSource = current ?? labelSource;

	const resetSearch = () => {
		setQuery("");
		setSearchEpoch((epoch) => epoch + 1);
	};

	return (
		<ControlMenu
			id="modelMenu"
			triggerId="modelTrigger"
			triggerClassName="model-control"
			title="模型与思考强度"
			icon="cube"
			labelId="modelLabel"
			label={shownLabelSource ? modelLabel(t, shownLabelSource) : "默认模型"}
			popoverId="modelPopover"
			open={open}
			onOpen={() => {
				// Always open on the short view; "more models" is a deliberate step.
				setView("compact");
				setQuery("");
				setPinned(readPinnedModels());
				if (!current) setLabelSource(EMPTY_MODEL_SOURCE);
				onOpen();
			}}
			onClose={onClose}
		>
			<ModelPanel
				source={source}
				view={view}
				query={query}
				searchEpoch={searchEpoch}
				pinned={pinned}
				onQuery={setQuery}
				onView={(next) => {
					setView(next);
					resetSearch();
				}}
				onPin={(key) => setPinned(togglePinnedModel(key))}
				onSelectModel={(value) => {
					// Applying a model repaints the panel rather than closing it, so the
					// effort list immediately reflects the model just chosen.
					void selectModel(value).then((applied) => {
						if (applied) resetSearch();
					});
				}}
				onSelectEffort={(level) => {
					void selectEffort(level).then((applied) => {
						if (applied) onClose();
					});
				}}
			/>
		</ControlMenu>
	);
}
