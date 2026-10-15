import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { formatRelativeTime, useT } from "../../i18n";
import { basename } from "../../lib/format";
import { useImeGuard } from "../../lib/ime";
import { skillInvocation } from "../../lib/markdown";
import { openSession, sessionTitle } from "../../state/session";
import { useAppStore } from "../../state/store";
import type { SessionSummary } from "../../state/types";
import { EmptyState, Icon, IconButton, Kbd, LEGACY_ICONS, Modal } from "../../ui";
import { closeSearch, subscribeSearchOpen } from "./actions";

/** Lower-cased haystack of one session (legacy `searchableText`, 1187-1197). */
function searchableText(session: SessionSummary): string {
	return [session.name, session.firstMessage, session.allMessagesText, session.cwd]
		.filter(Boolean)
		.join(" ")
		.toLowerCase();
}

/** Up to 50 matches, newest first (legacy `renderSearchResults`, 1213-1225). */
function searchSessions(sessions: readonly SessionSummary[], query: string): SessionSummary[] {
	const normalized = query.trim().toLowerCase();
	return sessions
		.filter((session) => session.cwdAvailable !== false)
		.filter((session) => !normalized || searchableText(session).includes(normalized))
		.sort((left, right) => new Date(right.modified ?? "").getTime() - new Date(left.modified ?? "").getTime())
		.slice(0, 50);
}

function openResult(session: SessionSummary | undefined): void {
	if (!session) return;
	closeSearch();
	void openSession(session.id);
}

/** `#searchModal`: global conversation search (legacy index.html 1159-1202, app.js 1187-1280, 3401-3425). */
/** First message as shown: a skill invocation reads `name · request`, not the skill's instructions. */
function skillPreview(text: string | undefined): string {
	const skill = text ? skillInvocation(text) : null;
	if (!skill) return text ?? "";
	return skill.request ? `${skill.name} · ${skill.request}` : skill.name;
}

export function SearchModal() {
	const t = useT();
	const open = useAppStore((state) => state.ui.searchOpen);
	const sessions = useAppStore((state) => state.sessions);
	const input = useRef<HTMLInputElement>(null);
	const list = useRef<HTMLDivElement>(null);
	const ime = useImeGuard();
	const [query, setQuery] = useState("");
	const [index, setIndex] = useState(-1);
	const [openRequest, setOpenRequest] = useState(0);

	// Each openSearch() clears the query and the selection, then focuses the field
	// once the modal is visible.
	useEffect(
		() =>
			subscribeSearchOpen(() => {
				if (input.current) input.current.value = "";
				setQuery("");
				setIndex(-1);
				setOpenRequest((count) => count + 1);
			}),
		[],
	);
	useEffect(() => {
		if (openRequest) input.current?.focus();
	}, [openRequest]);
	useEffect(() => {
		if (index < 0) return;
		list.current?.querySelector(`.search-result[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" });
	}, [index]);

	const results = open ? searchSessions(sessions, query) : [];
	const move = (delta: number) => {
		if (!results.length) return;
		setIndex((current) => (current + delta + results.length) % results.length);
	};
	const onInput = (event: FormEvent<HTMLInputElement>) => {
		setIndex(-1);
		setQuery(event.currentTarget.value);
	};
	const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "ArrowDown") {
			event.preventDefault();
			move(1);
		} else if (event.key === "ArrowUp") {
			event.preventDefault();
			move(-1);
		} else if (event.key === "Enter" && !ime.isComposing(event)) {
			event.preventDefault();
			openResult(results[index >= 0 ? index : 0]);
		} else if (event.key === "Escape") {
			event.preventDefault();
			// Only this layer: the shell's Escape chain would otherwise carry on to the next one.
			event.stopPropagation();
			closeSearch();
		}
	};

	const projects = new Map<string, SessionSummary[]>();
	for (const session of results) {
		const key = session.cwd || "";
		const items = projects.get(key) ?? [];
		items.push(session);
		projects.set(key, items);
	}
	let position = 0;

	return (
		<Modal
			open={open}
			onClose={closeSearch}
			id="searchModal"
			overlayClassName="search-overlay"
			className="search-dialog"
			labelledBy="searchTitle"
		>
			<header className="search-header">
				<h2 id="searchTitle">{t("searchTitle")}</h2>
				<IconButton
					id="searchClose"
					title="关闭"
					aria-label="关闭"
					icon="close"
					iconSize="lg"
					onClick={closeSearch}
				/>
			</header>
			<div className="search-input-wrap">
				<Icon name="searchLg" size="lg" />
				<input
					ref={input}
					id="globalSearchInput"
					type="search"
					autoComplete="off"
					placeholder={t("searchPlaceholder")}
					{...ime.handlers}
					onInputCapture={onInput}
					onKeyDown={onKeyDown}
				/>
			</div>
			<div className="search-results" id="globalSearchResults" ref={list}>
				{results.length ? (
					[...projects].map(([cwd, items]) => (
						<section className="search-project" key={cwd}>
							<div className="search-project-header">
								<Icon {...LEGACY_ICONS.folder} />
								<span>{basename(cwd) || t("recent")}</span>
							</div>
							{items.map((session) => {
								const itemIndex = position++;
								return (
									<button
										key={session.id}
										className={itemIndex === index ? "search-result selected" : "search-result"}
										type="button"
										data-index={String(itemIndex)}
										onClick={() => openResult(session)}
									>
										<span className="search-result-main">
											<strong>{sessionTitle(session)}</strong>
											<small>{skillPreview(session.firstMessage) || session.allMessagesText || ""}</small>
										</span>
										<time>{formatRelativeTime(session.modified)}</time>
									</button>
								);
							})}
						</section>
					))
				) : (
					<EmptyState>{t("noSearchResults")}</EmptyState>
				)}
			</div>
			<footer className="search-footer">
				<span>
					<Kbd>↑</Kbd>
					<Kbd>↓</Kbd> <span>{t("searchSelect")}</span>
				</span>
				<span>
					<Kbd>Enter</Kbd> <span>{t("searchOpen")}</span>
				</span>
				<span>
					<Kbd>Esc</Kbd> <span>{t("searchClose")}</span>
				</span>
			</footer>
		</Modal>
	);
}
