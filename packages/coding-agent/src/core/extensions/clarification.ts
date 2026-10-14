/** Structured clarification capability for hosts that cannot render TUI components. */
export interface ClarificationQuestion {
	id: string;
	label: string;
	question: string;
	reason?: string;
	options: { label: string; value: string; description?: string }[];
	allowFreeform: boolean;
}

export interface ClarificationAnswer {
	id: string;
	value: string;
	label: string;
	wasCustom: boolean;
	index?: number;
	skipped?: boolean;
}

export interface ClarificationResult {
	answers: ClarificationAnswer[];
	cancelled: boolean;
}
