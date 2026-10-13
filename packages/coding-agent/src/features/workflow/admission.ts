import { WorkflowSemaphore } from "./budget.ts";

/** A process-wide node window, shared by concurrent workflow tools/sessions.
 * Conservatively includes all models: model overrides cannot escape the host
 * ceiling. Each run also retains its own lower maxConcurrency window.
 */
let pool: { semaphore: WorkflowSemaphore; members: Set<{ ceiling: number }> } | undefined;

export interface WorkflowAdmissionLease {
	semaphore: WorkflowSemaphore;
	release(): void;
}

export function acquireWorkflowAdmission(ceiling: number): WorkflowAdmissionLease {
	pool ??= { semaphore: new WorkflowSemaphore(ceiling), members: new Set() };
	const current = pool;
	const member = { ceiling };
	current.members.add(member);
	current.semaphore.setCeiling(Math.min(...Array.from(current.members, (item) => item.ceiling)));
	return {
		semaphore: current.semaphore,
		release() {
			if (!current.members.delete(member)) return;
			if (current.members.size === 0) {
				current.semaphore.dispose();
				if (pool === current) pool = undefined;
			} else {
				current.semaphore.setCeiling(Math.min(...Array.from(current.members, (item) => item.ceiling)));
			}
		},
	};
}
