import { randomUUID } from "node:crypto";
import type { ExtensionUIContext } from "@step-harness/coding-agent";

type Clarify = NonNullable<ExtensionUIContext["clarify"]>;
export type ClarificationQuestion = Parameters<Clarify>[0][number];
type ClarificationResult = Awaited<ReturnType<Clarify>>;

export interface ClarificationRequest {
	readonly id: string;
	readonly sessionId: string;
	readonly questions: ClarificationQuestion[];
}

export type ClarificationEvent =
	| { type: "clarification_required"; clarification: ClarificationRequest }
	| { type: "clarification_resolved"; id: string };

interface PendingClarification {
	request: ClarificationRequest;
	finish: (result: ClarificationResult) => void;
}

/** Only transports questions and validates replies; the coding tool owns their semantics. */
export class ClarificationBroker {
	private readonly pending = new Map<string, PendingClarification>();
	private readonly sessionId: () => string;
	private readonly emit: (event: ClarificationEvent) => void;

	constructor(sessionId: () => string, emit: (event: ClarificationEvent) => void) {
		this.sessionId = sessionId;
		this.emit = emit;
	}

	ask(questions: ClarificationQuestion[], signal?: AbortSignal): Promise<ClarificationResult> {
		if (signal?.aborted) return Promise.resolve({ answers: [], cancelled: true });
		const request = { id: randomUUID(), sessionId: this.sessionId(), questions };
		return new Promise((resolve) => {
			const onAbort = () => finish({ answers: [], cancelled: true });
			const finish = (result: ClarificationResult) => {
				if (!this.pending.delete(request.id)) return;
				signal?.removeEventListener("abort", onAbort);
				this.emit({ type: "clarification_resolved", id: request.id });
				resolve(result);
			};
			this.pending.set(request.id, { request, finish });
			signal?.addEventListener("abort", onAbort, { once: true });
			this.emit({ type: "clarification_required", clarification: request });
		});
	}

	pendingRequests(): ClarificationRequest[] {
		return [...this.pending.values()].map(({ request }) => request);
	}

	/** Derive selected labels/values from the pending request, never from client claims. */
	respond(id: string, input: Record<string, unknown>): boolean {
		const pending = this.pending.get(id);
		if (!pending) return false;
		if (input.cancelled === true) {
			pending.finish({ answers: [], cancelled: true });
			return true;
		}
		if (input.cancelled !== false || !Array.isArray(input.answers)) throw new Error("Invalid clarification response");
		const raw: unknown[] = input.answers;
		if (raw.length !== pending.request.questions.length) throw new Error("Answer every question or skip it");
		const answers = pending.request.questions.map((question, index) => {
			const entry = raw[index];
			if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("Invalid answer");
			const answer = entry as Record<string, unknown>;
			if (answer.id !== question.id) throw new Error("Question id mismatch");
			const kinds =
				Number(answer.skipped === true) +
				Number(answer.optionIndex !== undefined) +
				Number(answer.text !== undefined);
			if (kinds !== 1) throw new Error("Choose one answer type");
			if (answer.skipped === true) return { id: question.id, value: "", label: "", wasCustom: false, skipped: true };
			if (typeof answer.optionIndex === "number" && Number.isInteger(answer.optionIndex)) {
				const option = question.options[answer.optionIndex];
				if (!option) throw new Error("Invalid option index");
				return {
					id: question.id,
					value: option.value,
					label: option.label,
					wasCustom: false,
					index: answer.optionIndex + 1,
				};
			}
			if (question.allowFreeform && typeof answer.text === "string" && answer.text.trim()) {
				const text = answer.text.trim();
				return { id: question.id, value: text, label: text, wasCustom: true };
			}
			throw new Error("Invalid custom answer");
		});
		pending.finish({ answers, cancelled: false });
		return true;
	}

	clear(): void {
		for (const pending of this.pending.values()) pending.finish({ answers: [], cancelled: true });
	}
}
