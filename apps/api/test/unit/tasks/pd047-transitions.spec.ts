/**
 * PD-47: the task state machine. A task leaves a person's list by exactly
 * four exits (complete, out of scope then a decision, remove, reassign);
 * completed and removed are final; nothing else moves it.
 * Plan: docs/product/pd047-tasks-plan.md §3.2.
 */
import { nextState, TaskAction, TaskState } from '../../../src/tasks/task-transitions';

const STATES: TaskState[] = ['open', 'awaiting_decision', 'completed', 'removed'];
const ACTIONS: TaskAction[] = ['complete', 'out_of_scope', 'return', 'remove', 'reassign', 'comment', 'due'];

describe('PD-47 task transitions', () => {
  it('open: every exit is possible, and a comment or a due date changes nothing', () => {
    expect(nextState('open', 'complete')).toBe('completed');
    expect(nextState('open', 'out_of_scope')).toBe('awaiting_decision');
    expect(nextState('open', 'remove')).toBe('removed');
    expect(nextState('open', 'reassign')).toBe('open');
    expect(nextState('open', 'comment')).toBe('open');
    expect(nextState('open', 'due')).toBe('open');
  });

  it('open: there is nothing to return', () => {
    expect(nextState('open', 'return')).toBeNull();
  });

  it('awaiting a decision: remove, return or reassign; the work done meanwhile completes it', () => {
    expect(nextState('awaiting_decision', 'remove')).toBe('removed');
    expect(nextState('awaiting_decision', 'return')).toBe('open');
    expect(nextState('awaiting_decision', 'reassign')).toBe('open');
    expect(nextState('awaiting_decision', 'complete')).toBe('completed');
    expect(nextState('awaiting_decision', 'comment')).toBe('awaiting_decision');
  });

  it('awaiting a decision: it cannot be disputed twice before a decision', () => {
    expect(nextState('awaiting_decision', 'out_of_scope')).toBeNull();
  });

  it('completed and removed are final: no action moves them, not even a comment', () => {
    for (const from of ['completed', 'removed'] as const) {
      for (const action of ACTIONS) expect(nextState(from, action)).toBeNull();
    }
  });

  it('no action ever yields a state outside the four', () => {
    for (const from of STATES) {
      for (const action of ACTIONS) {
        const to = nextState(from, action);
        if (to !== null) expect(STATES).toContain(to);
      }
    }
  });
});
