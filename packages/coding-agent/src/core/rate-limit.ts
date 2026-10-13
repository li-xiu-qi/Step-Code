/** Temporary throttling is distinct from exhausted billing/plan quotas. */
export function isRateLimitError(message: string): boolean {
	return /\b429\b|rate[ _-]?limit|concurrency reached|too many requests/i.test(message);
}

export function isTerminalQuotaError(message: string): boolean {
	return /GoUsageLimitError|FreeUsageLimitError|insufficient_quota|usage_limit_reached|quota exhausted|quota exceeded|billing|insufficient balance|available balance|monthly usage limit|out of budget/i.test(
		message,
	);
}

export function rateLimitDelay(attempt: number, retryAfterMs?: number): number {
	if (retryAfterMs !== undefined && Number.isFinite(retryAfterMs) && retryAfterMs >= 0) return retryAfterMs;
	return Math.round(Math.min(30_000, 1000 * 2 ** (attempt - 1)) * (0.75 + Math.random() * 0.25));
}
export type ModelRequestProgress =
	| { type: "started" }
	| { type: "succeeded" }
	| { type: "rate_limit"; attempt: number; maxRetries: number; delayMs: number; message: string };
