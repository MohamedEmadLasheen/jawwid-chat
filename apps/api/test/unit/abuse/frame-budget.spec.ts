/**
 * The per-socket frame budget.
 *
 * This is the one abuse control that is NOT durable, because it cannot be: a
 * typing indicator fires per keystroke and a database write per keystroke would
 * be a worse denial of service than the abuse it defends against. So the
 * behaviour is proven here rather than assumed, and the clock is injected so no
 * assertion depends on how long the test took to run.
 */
import { FrameBudget } from '@communication/realtime/frame-budget';

describe('FrameBudget', () => {
  it('admits exactly the limit and refuses the one after it', () => {
    const budget = new FrameBudget(3, 60_000, 0);
    expect(budget.admit(0)).toBe(true);
    expect(budget.admit(1)).toBe(true);
    expect(budget.admit(2)).toBe(true);
    // The limit is the number ALLOWED -- the same way round as p_limit reads in
    // chat.record_auth_attempt. "Limit 3" meaning two frames is the off-by-one
    // that gets discovered during an incident.
    expect(budget.admit(3)).toBe(false);
  });

  it('keeps refusing for the rest of the window', () => {
    const budget = new FrameBudget(1, 60_000, 0);
    expect(budget.admit(0)).toBe(true);
    expect(budget.admit(1)).toBe(false);
    expect(budget.admit(59_999)).toBe(false);
  });

  it('starts a fresh window once the old one has elapsed', () => {
    const budget = new FrameBudget(2, 60_000, 0);
    expect(budget.admit(0)).toBe(true);
    expect(budget.admit(1)).toBe(true);
    expect(budget.admit(2)).toBe(false);

    // A client that backs off is not punished forever. The socket is dropped on
    // refusal in practice, so this matters for the reconnect that follows.
    expect(budget.admit(60_000)).toBe(true);
    expect(budget.used).toBe(1);
  });

  it('does not reset early: 59_999ms into a window is still that window', () => {
    const budget = new FrameBudget(1, 60_000, 0);
    expect(budget.admit(0)).toBe(true);
    expect(budget.admit(59_999)).toBe(false);
    expect(budget.admit(60_000)).toBe(true);
  });

  it('a zero limit refuses everything rather than admitting everything', () => {
    // Fail closed. A misconfigured `0` that meant "unlimited" would turn the
    // control off precisely when somebody was trying to tighten it.
    const budget = new FrameBudget(0, 60_000, 0);
    expect(budget.admit(0)).toBe(false);
  });

  it('counts frames, not distinct events -- a loop on one event is the attack', () => {
    const budget = new FrameBudget(600, 60_000, 0);
    let refusedAt: number | null = null;
    for (let i = 0; i < 700; i += 1) {
      if (!budget.admit(i) && refusedAt === null) refusedAt = i;
    }
    expect(refusedAt).toBe(600);
  });
});
