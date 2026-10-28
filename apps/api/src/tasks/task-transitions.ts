/**
 * PD-47: the task state machine (plan §3.2). A task leaves a person's list by
 * exactly four exits -- complete; out of scope, then a decision (remove,
 * return with instructions, reassign); remove; reassign -- and completed and
 * removed are final. chat.guard_work_task enforces the same table; this copy
 * lets the API refuse early with a precise code.
 */
export type TaskState = 'open' | 'awaiting_decision' | 'completed' | 'removed';
export type TaskAction = 'complete' | 'out_of_scope' | 'return' | 'remove' | 'reassign' | 'comment' | 'due';

export const PENDING_STATES: readonly TaskState[] = ['open', 'awaiting_decision'];
export const FINAL_STATES: readonly TaskState[] = ['completed', 'removed'];

const NEXT: Readonly<Record<TaskState, Partial<Record<TaskAction, TaskState>>>> = {
  open: { complete: 'completed', out_of_scope: 'awaiting_decision', remove: 'removed', reassign: 'open', comment: 'open', due: 'open' },
  // The work done while the decision waits still completes the task.
  awaiting_decision: { complete: 'completed', return: 'open', remove: 'removed', reassign: 'open', comment: 'awaiting_decision', due: 'awaiting_decision' },
  completed: {},
  removed: {},
};

/** The state `action` leads to from `from`, or null when it is not allowed. */
export function nextState(from: TaskState, action: TaskAction): TaskState | null {
  return NEXT[from][action] ?? null;
}
