/**
 * `#fileTree`: the workspace file tree that slides over the conversation list
 * (legacy index.html 642-673; app.js 3496-3507 wiring).
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useT } from "../../i18n";
import { basename, cx } from "../../lib/format";
import { useAppStore } from "../../state/store";
import { IconButton, SearchInput } from "../../ui";
import { closeTree, refreshTree, searchTree, subscribeTreeSignals } from "./actions";
import { FileTreeRows } from "./FileTreeRows";

export function FileTreePanel() {
	const t = useT();
	const open = useAppStore((state) => state.ui.fileTreeOpen);
	const cwd = useAppStore((state) => state.tree.cwd);
	const searchRef = useRef<HTMLInputElement>(null);
	const bodyRef = useRef<HTMLDivElement>(null);
	// A revealed row is focused after React has drawn it, not when the signal arrives.
	const [reveal, setReveal] = useState<{ readonly path: string } | null>(null);
	// Likewise the search field: the panel is `display: none` until React has applied `.open`,
	// and a hidden input cannot take focus (legacy added the class and focused in one go).
	const [focusSearch, setFocusSearch] = useState(false);

	useEffect(
		() =>
			subscribeTreeSignals((signal) => {
				if (signal.type === "reveal") {
					setReveal({ path: signal.path });
					return;
				}
				const input = searchRef.current;
				if (!input) return;
				input.value = "";
				if (signal.focus) setFocusSearch(true);
			}),
		[],
	);

	// A native listener: tests (and scripts) dispatch a non-bubbling `input` event, which React's
	// root-delegated onInput never sees (legacy app.js 3499-3501 listened on the element).
	useEffect(() => {
		const input = searchRef.current;
		if (!input) return;
		const onInput = () => searchTree(input.value);
		input.addEventListener("input", onInput);
		return () => input.removeEventListener("input", onInput);
	}, []);

	useLayoutEffect(() => {
		if (!focusSearch || !open) return;
		searchRef.current?.focus();
		setFocusSearch(false);
	}, [focusSearch, open]);

	useLayoutEffect(() => {
		if (!reveal) return;
		const row = [...(bodyRef.current?.querySelectorAll<HTMLElement>(".file-row") ?? [])].find(
			(candidate) => candidate.dataset.path === reveal.path,
		);
		row?.scrollIntoView({ block: "nearest" });
		row?.focus();
		setReveal(null);
	}, [reveal]);

	return (
		<div className={cx("file-tree", open && "open")} id="fileTree">
			<div className="file-tree-header">
				<IconButton
					id="fileTreeBack"
					icon="back"
					iconSize="sm"
					title="返回会话"
					aria-label="返回会话"
					onClick={closeTree}
				/>
				<strong id="fileTreeName" title={cwd || undefined}>
					{cwd ? basename(cwd) : "工作区"}
				</strong>
				<IconButton
					id="fileTreeRefresh"
					icon="loop"
					iconSize="sm"
					title={t("refresh")}
					aria-label={t("refresh")}
					onClick={() => void refreshTree()}
				/>
			</div>
			<SearchInput
				bare
				icon={null}
				wrapperClassName="file-search"
				id="fileTreeSearch"
				ref={searchRef}
				placeholder="搜索文件名"
				defaultValue=""
			/>
			<div className="file-tree-body" id="fileTreeBody" role="tree" ref={bodyRef}>
				<FileTreeRows />
			</div>
		</div>
	);
}
