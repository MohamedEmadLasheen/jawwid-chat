/**
 * THE CALL STATE MACHINE.
 *
 * Pure, so this suite is exhaustive rather than representative: every action is
 * exercised from every state, including the ones that used to silently succeed.
 *
 * The three cases at the top are the defects Phase 5 exists to close. Before
 * it, each of them was an unguarded write.
 */
import {
  CallAction,
  applyCallAction,
  canParticipantTransition,
  canTransition,
  isTerminal,
} from '@communication/calls/call-state';
import { CallOutcome, CallParticipantState, CallStatus } from '@communication/contracts/vocab';

const ringing = { status: CallStatus.RINGING, outcome: null, answeredAt: null };
const active = { status: CallStatus.ACTIVE, outcome: null, answeredAt: new Date() };
const ended = (outcome: string) => ({
  status: CallStatus.ENDED,
  outcome,
  answeredAt: outcome === CallOutcome.ANSWERED ? new Date() : null,
});

describe('the transitions Phase 5 exists to forbid', () => {
  it('a declined call cannot be accepted', () => {
    // The old code set ACTIVE unconditionally, resurrecting a refused call.
    const result = applyCallAction(ended(CallOutcome.DECLINED), CallAction.ACCEPT);
    expect(result.kind).toBe('refused');
  });

  it('a missed call cannot be accepted', () => {
    expect(applyCallAction(ended(CallOutcome.MISSED), CallAction.ACCEPT).kind).toBe('refused');
  });

  it('an ended call cannot be ended again, and is not an error', () => {
    // NOT 'refused'. A client retrying an `end` whose response it never saw is
    // behaving correctly; what must not happen is the second call REWRITING the
    // outcome and duration of a call that finished days ago.
    const result = applyCallAction(ended(CallOutcome.ANSWERED), CallAction.END);
    expect(result.kind).toBe('noop');
  });
});

describe('the transition table', () => {
  it('permits exactly the declared edges', () => {
    expect(canTransition(CallStatus.INITIATED, CallStatus.RINGING)).toBe(true);
    expect(canTransition(CallStatus.INITIATED, CallStatus.ENDED)).toBe(true);
    expect(canTransition(CallStatus.RINGING, CallStatus.ACTIVE)).toBe(true);
    expect(canTransition(CallStatus.RINGING, CallStatus.ENDED)).toBe(true);
    expect(canTransition(CallStatus.ACTIVE, CallStatus.ENDED)).toBe(true);
  });

  it('forbids everything else, including every backwards edge', () => {
    expect(canTransition(CallStatus.ACTIVE, CallStatus.RINGING)).toBe(false);
    expect(canTransition(CallStatus.ENDED, CallStatus.ACTIVE)).toBe(false);
    expect(canTransition(CallStatus.ENDED, CallStatus.RINGING)).toBe(false);
    expect(canTransition(CallStatus.INITIATED, CallStatus.ACTIVE)).toBe(false);
    expect(canTransition('nonsense', CallStatus.ACTIVE)).toBe(false);
  });

  it('ended is terminal and has no exit', () => {
    expect(isTerminal(CallStatus.ENDED)).toBe(true);
    expect(isTerminal(CallStatus.RINGING)).toBe(false);
    for (const to of [CallStatus.INITIATED, CallStatus.RINGING, CallStatus.ACTIVE]) {
      expect(canTransition(CallStatus.ENDED, to)).toBe(false);
    }
  });
});

describe('accept', () => {
  it('connects a ringing call', () => {
    expect(applyCallAction(ringing, CallAction.ACCEPT)).toEqual({
      kind: 'transition',
      status: CallStatus.ACTIVE,
      outcome: null,
    });
  });

  it('is idempotent on an already-active call', () => {
    // A second device answering, or a retried request. Not a state change and
    // not an error -- a client on a flaky connection has to be able to retry.
    expect(applyCallAction(active, CallAction.ACCEPT).kind).toBe('noop');
  });

  it('is refused after every terminal outcome', () => {
    for (const outcome of Object.values(CallOutcome)) {
      expect(applyCallAction(ended(outcome), CallAction.ACCEPT).kind).toBe('refused');
    }
  });
});

describe('decline, and who else can still answer', () => {
  it('ends a call nobody else can answer', () => {
    const result = applyCallAction(ringing, CallAction.DECLINE, { pending: 0, joined: 0 });
    expect(result).toEqual({
      kind: 'transition',
      status: CallStatus.ENDED,
      outcome: CallOutcome.DECLINED,
    });
  });

  it('does NOT end a group call while another invitee may still answer', () => {
    // One student refusing a class call does not close the class.
    const result = applyCallAction(ringing, CallAction.DECLINE, { pending: 3, joined: 0 });
    expect(result.kind).toBe('noop');
  });

  it('does NOT end a call somebody has already joined', () => {
    const result = applyCallAction(active, CallAction.DECLINE, { pending: 0, joined: 2 });
    expect(result.kind).toBe('noop');
  });

  it('is idempotent after the call has ended', () => {
    // Tapping "decline" on a notification for a call that already timed out.
    expect(applyCallAction(ended(CallOutcome.MISSED), CallAction.DECLINE).kind).toBe('noop');
  });
});

describe('the ring timeout', () => {
  it('turns an unanswered call into a missed call', () => {
    expect(applyCallAction(ringing, CallAction.TIMEOUT)).toEqual({
      kind: 'transition',
      status: CallStatus.ENDED,
      outcome: CallOutcome.MISSED,
    });
  });

  it('has no authority over a call that connected', () => {
    expect(applyCallAction(active, CallAction.TIMEOUT).kind).toBe('noop');
  });

  it('is a no-op on an ended call, so the sweep is safe to run twice', () => {
    expect(applyCallAction(ended(CallOutcome.DECLINED), CallAction.TIMEOUT).kind).toBe('noop');
  });
});

describe('cancel and end record who did what', () => {
  it('cancelling an unanswered call is CANCELLED, not MISSED', () => {
    // The recipient did not fail to pick up; the caller changed their mind.
    // Recording it as MISSED blames the wrong party in somebody's history.
    const result = applyCallAction(ringing, CallAction.CANCEL);
    expect(result).toMatchObject({ outcome: CallOutcome.CANCELLED });
  });

  it('cancelling a connected call is ANSWERED', () => {
    // The conversation happened. Calling it "cancelled" would misdescribe it.
    expect(applyCallAction(active, CallAction.CANCEL)).toMatchObject({
      outcome: CallOutcome.ANSWERED,
    });
  });

  it('ending a call nobody answered is not recorded as answered', () => {
    expect(applyCallAction(ringing, CallAction.END)).toMatchObject({
      outcome: CallOutcome.CANCELLED,
    });
  });

  it('ending a connected call is answered', () => {
    expect(applyCallAction(active, CallAction.END)).toMatchObject({
      outcome: CallOutcome.ANSWERED,
    });
  });

  it('a media failure is FAILED from either live state', () => {
    expect(applyCallAction(ringing, CallAction.FAIL)).toMatchObject({
      outcome: CallOutcome.FAILED,
    });
    expect(applyCallAction(active, CallAction.FAIL)).toMatchObject({
      outcome: CallOutcome.FAILED,
    });
  });
});

describe('the participant machine', () => {
  it('lets an invitee join, refuse or be missed', () => {
    const from = CallParticipantState.INVITED;
    expect(canParticipantTransition(from, CallParticipantState.JOINED)).toBe(true);
    expect(canParticipantTransition(from, CallParticipantState.DECLINED)).toBe(true);
    expect(canParticipantTransition(from, CallParticipantState.MISSED)).toBe(true);
  });

  it('lets a dropped connection rejoin a live call', () => {
    expect(canParticipantTransition(CallParticipantState.JOINED, CallParticipantState.LEFT)).toBe(true);
    expect(canParticipantTransition(CallParticipantState.LEFT, CallParticipantState.JOINED)).toBe(true);
  });

  it('makes a refusal final', () => {
    expect(canParticipantTransition(CallParticipantState.DECLINED, CallParticipantState.JOINED)).toBe(false);
    expect(canParticipantTransition(CallParticipantState.MISSED, CallParticipantState.JOINED)).toBe(false);
  });

  it('treats a repeat of the same state as allowed, so a retry is safe', () => {
    expect(canParticipantTransition(CallParticipantState.DECLINED, CallParticipantState.DECLINED)).toBe(true);
  });
});
