/** Model picker helpers (legacy app.js 2480-2488, 2558-2584, 2614-2616, 2809-2818). */

import type { TranslateFn } from "../../i18n";
import { readStorage, STORAGE_KEYS, writeStorage } from "../../lib/storage";
import { modelKey } from "../../state/session";
import type { ModelInfo, SessionSnapshot } from "../../state/types";

/** How many models the compact view shows before deferring to "more models". */
export const COMPACT_MODEL_COUNT = 4;

/** What the model panel is painted from: the open session, or `{ models: [] }` in a draft. */
export type ModelSource = Pick<SessionSnapshot, "models" | "model" | "thinkingLevel" | "availableThinkingLevels">;

export const EMPTY_MODEL_SOURCE: ModelSource = { models: [] };

/** Effort labels, keyed by the kernel's thinking level ids. */
export const EFFORT_LABELS: Readonly<Record<string, string>> = {
	off: "effortOff",
	minimal: "effortMinimal",
	low: "effortLow",
	medium: "effortMedium",
	high: "effortHigh",
	xhigh: "effortXhigh",
	max: "effortMax",
};

export function effortLabel(t: TranslateFn, level: string): string {
	return t(EFFORT_LABELS[level] ?? level);
}

/** Model ids the user pinned, kept locally so they survive a session change. */
export function readPinnedModels(): string[] {
	try {
		const parsed: unknown = JSON.parse(readStorage(STORAGE_KEYS.pinnedModels) ?? "[]");
		return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
	} catch {
		return [];
	}
}

export function togglePinnedModel(key: string): string[] {
	const current = readPinnedModels();
	const next = current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key];
	writeStorage(STORAGE_KEYS.pinnedModels, JSON.stringify(next));
	return next;
}

/** Human-readable model metadata for the picker rows (strings hard-coded in Chinese, as legacy). */
export function modelMeta(model: ModelInfo): string[] {
	const meta: string[] = [];
	if (model.contextWindow) meta.push(`${Math.round(model.contextWindow / 1000)}K 上下文`);
	if (model.maxTokens) meta.push(`${Math.round(model.maxTokens / 1000)}K 输出`);
	if (model.input?.includes("image")) meta.push("支持图片");
	return meta;
}

/** `#modelLabel`: model name (or id), then ` · <effort>` when a level is set. */
export function modelLabel(t: TranslateFn, source: ModelSource): string {
	const currentKey = source.model ? modelKey(source.model) : "";
	const active = (source.models ?? []).find((model) => modelKey(model) === currentKey);
	const effort = source.thinkingLevel;
	const effortSuffix = effort ? ` · ${effortLabel(t, effort)}` : "";
	// `defaultModel` has no translation: legacy showed the key itself here.
	return `${active?.name ?? (currentKey && source.model ? source.model.id : t("defaultModel"))}${effortSuffix}`;
}

/**
 * The short list: whatever is pinned, then the active model, then enough of
 * the rest to fill the panel. Capped so a large catalog does not turn the
 * default view into a scroll.
 */
export function compactCandidates(
	models: readonly ModelInfo[],
	pinned: readonly string[],
	active: ModelInfo | undefined,
): ModelInfo[] {
	const chosen = models.filter((model) => pinned.includes(modelKey(model)));
	if (active && !chosen.includes(active)) chosen.push(active);
	for (const model of models) {
		if (chosen.length >= COMPACT_MODEL_COUNT) break;
		if (!chosen.includes(model)) chosen.push(model);
	}
	return chosen;
}

/** Catalog filter of the "all models" view: id, name or provider contains the query. */
export function filterModels(models: readonly ModelInfo[], query: string): ModelInfo[] {
	const needle = query.trim().toLowerCase();
	return models.filter(
		(model) =>
			!needle ||
			model.id.toLowerCase().includes(needle) ||
			(model.name ?? "").toLowerCase().includes(needle) ||
			model.provider.toLowerCase().includes(needle),
	);
}
