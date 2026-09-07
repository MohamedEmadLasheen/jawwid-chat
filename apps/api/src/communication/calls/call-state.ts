import { CallOutcome, CallParticipantState, CallStatus } from '../contracts/vocab';

/**
 * THE call state machine.
 *
 * Pure, synchronous and dependency-free, so the rules can be exhaustively
 * tested without a database, a clock or an actor -- and so there is exactly one
 * place to read to find out what a call may do next.
 *
 * ## Why this file exists
 *
 * Before Phase 5 there was no machine. `status` was three strings and each
 * method wrote whichever one it felt like:
 *
 *   * `accept` set ACTIVE with no check, so accepting a call that had already
 *     been declined, missed or ended succeeded and resurrected it;
 *   * `end` rewrote `ended_at`, `outcome` and `duration_seconds` on every call,
 *     so a client retrying a request it never saw the response to silently
 *     rewrote the record of a call that finished days earlier;
 *   * nothing could ever produce MISSED, because nothing looked at the clock.
 *
 * All three are the same defect: the authoritative state was whatever the last
 * writer said, and a client's retry is a writer.
 *
 * ## The transitions
 *
 *     initiated ──invite──▶ ringing ──accept──▶ active ──end──▶ ended[answered]
 *         │                    │                   │
 *         │                    ├──decline (all)───▶ ended[declined]
 *         │                    ├──ring timeout────▶ ended[missed]
 *         │                    ├──cancel──────────▶ ended[cancelled]
 *         └──dispatch failed───┴───────────────────▶ ended[failed]
 *                                                  ▲
 *                              active ──media failure──┘ ended[failed]
 *
 * `ended` is TERMINAL and has no outgoing edge. That is what makes `end`
 * idempotent rather than destructive: a second `end` is not a transition, it is
 * a no-op that returns the call as it already is.
 *
 * The same rules are enforced a second time by chat.enforce_call_transition in
 * 20260907150000_chat_phase5_calls.sql. That is not redundancy for its own
 * sake: this layer returns a typed refusal a client can act on, and the trigger
 * makes the illegal row unrepresentable even to a direct SQL session or to a
 * future service that forgets to ask.
 */

export type CallStatusValue = (typeof CallStatus)[keyof typeof CallStatus];
export type CallOutcomeValue = (typeof CallOutcome)[keyof typeof CallOutcome];

/** What a caller is trying to do. Not the same thing as the resulting state. */
export const CallAction = {
  INVITE: 'invite',
  ACCEPT: 'accept',
  DECLINE: 'decline',
  CANCEL: 'cancel',
  TIMEOUT: 'timeout',
  END: 'end',
  FAIL: 'fail',
} as const;
export type CallAction = (typeof CallAction)[keyof typeof CallAction];

const TRANSITIONS: Readonly<Record<string, ReadonlySet<string>>> = {
  [CallStatus.INITIATED]: new Set<string>([CallStatus.RINGING, CallStatus.ENDED]),
  [CallStatus.RINGING]: new Set<string>([CallStatus.ACTIVE, CallStatus.ENDED]),
  [CallStatus.ACTIVE]: new Set<string>([CallStatus.ENDED]),
  // Terminal. Deliberately empty rather than absent, so "is this a known
  // state with no exits" and "is this an unknown state" stay different answers.
  [CallStatus.ENDED]: new Set<string>(),
};

export const TERMINAL_CALL_STATUS: ReadonlySet<string> = new Set([CallStatus.ENDED]);

export function isTerminal(status: string): boolean {
  return TERMINAL_CALL_STATUS.has(status);
}

export function canTransition(from: string, to: string): boolean {
  return TRANSITIONS[from]?.has(to) ?? false;
}

/**
 * The outcome of asking the machine for an action.
 *
 * Three answers, not two, and the third is the one that matters. `noop` is how
 * idempotency is expressed: declining an already-declined call, or ending an
 * already-ended one, is neither a transition nor an error -- the caller's
 * intent is already satisfied, and saying so lets the service return success
 * without writing anything.
 */
export type CallTransition =
  | { kind: 'transition'; status: CallStatusValue; outcome: CallOutcomeValue | null }
  | { kind: 'noop'; reason: string }
  | { kind: 'refused'; reason: string };

export interface CallSnapshot {
  status: string;
  outcome: string | null;
  /** Set the moment somebody joins. Distinguishes a call that connected. */
  answeredAt: Date | null;
}

/**
 * How many invitees are still capable of answering. Supplied rather than
 * derived, because it is a database question and this module answers none.
 */
export interface ParticipantTally {
  /** Invitees who have neither joined nor refused: the call can still connect. */
  pending: number;
  /** Invitees currently in the call. */
  joined: number;
}

/**
 * Decide what an action does to a call.
 *
 * `tally` is only consulted for DECLINE, where the question "does this end the
 * call?" has no answer from the call's own row: one refusal among five invitees
 * leaves a group call ringing, and the last refusal ends it.
 */
export function applyCallAction(
  call: CallSnapshot,
  action: CallAction,
  tally: ParticipantTally = { pending: 0, joined: 0 },
): CallTransition {
  const ended = (outcome: CallOutcomeValue): CallTransition => ({
    kind: 'transition',
    status: CallStatus.ENDED,
    outcome,
  });

  switch (action) {
    case CallAction.INVITE:
      if (call.status === CallStatus.RINGING) {
        return { kind: 'noop', reason: 'the call is already ringing' };
      }
      return call.status === CallStatus.INITIATED
        ? { kind: 'transition', status: CallStatus.RINGING, outcome: null }
        : refuse(call, action);

    case CallAction.ACCEPT:
      // Already connected. A second device answering, or a retried request, is
      // not a state change -- but it is also not an error, or a client with a
      // flaky connection could never safely retry an accept.
      if (call.status === CallStatus.ACTIVE) {
        return { kind: 'noop', reason: 'the call is already active' };
      }
      if (call.status === CallStatus.RINGING) {
        return { kind: 'transition', status: CallStatus.ACTIVE, outcome: null };
      }
      // THE case the old code got wrong: accepting a call that was declined,
      // missed, cancelled or ended. It is refused, not absorbed, because the
      // caller believes they are joining a live call and they are not.
      return refuse(call, action);

    case CallAction.DECLINE:
      if (isTerminal(call.status)) {
        // Declining an ended call is what a phone does when the user taps
        // "decline" on a notification for a call that already timed out. The
        // intent is satisfied; nothing to write.
        return { kind: 'noop', reason: 'the call has already ended' };
      }
      if (call.status === CallStatus.ACTIVE || tally.joined > 0) {
        // Somebody is in the call. One invitee refusing does not end it; the
        // participant row records the refusal and the call carries on.
        return { kind: 'noop', reason: 'other participants are still in the call' };
      }
      // Nobody has joined. If anyone else can still answer, the call keeps
      // ringing; if this was the last one who could, the call is declined.
      return tally.pending > 0
        ? { kind: 'noop', reason: 'other invitees may still answer' }
        : ended(CallOutcome.DECLINED);

    case CallAction.CANCEL:
      if (isTerminal(call.status)) {
        return { kind: 'noop', reason: 'the call has already ended' };
      }
      // Cancelling a connected call is just ending it, and reporting it as
      // "cancelled" would misdescribe a conversation that happened.
      if (call.status === CallStatus.ACTIVE) {
        return ended(CallOutcome.ANSWERED);
      }
      return ended(CallOutcome.CANCELLED);

    case CallAction.TIMEOUT:
      if (isTerminal(call.status)) {
        // The sweeper and a human hanging up race constantly. Whoever loses
        // does nothing, which is why the sweep is safe to run concurrently and
        // safe to run twice.
        return { kind: 'noop', reason: 'the call has already ended' };
      }
      if (call.status === CallStatus.ACTIVE) {
        // Answered before the deadline. The ring timeout has no authority over
        // a call that connected.
        return { kind: 'noop', reason: 'the call was answered' };
      }
      return ended(CallOutcome.MISSED);

    case CallAction.END:
      if (isTerminal(call.status)) {
        return { kind: 'noop', reason: 'the call has already ended' };
      }
      // An unanswered call that is "ended" by its caller was never answered,
      // and must not be recorded as though it were.
      return ended(call.answeredAt ? CallOutcome.ANSWERED : CallOutcome.CANCELLED);

    case CallAction.FAIL:
      if (isTerminal(call.status)) {
        return { kind: 'noop', reason: 'the call has already ended' };
      }
      return ended(CallOutcome.FAILED);

    default:
      return { kind: 'refused', reason: `unknown call action ${String(action)}` };
  }
}

function refuse(call: CallSnapshot, action: CallAction): CallTransition {
  const where = call.outcome ? `${call.status} (${call.outcome})` : call.status;
  return { kind: 'refused', reason: `cannot ${action} a call that is ${where}` };
}

/**
 * The participant-level machine.
 *
 * Smaller, and separate, because it answers a different question: the call's
 * state is about the session, this is about one person's relationship to it.
 * Conflating them is what made "declined" and "joined then hung up" the same
 * row before Phase 5.
 */
const PARTICIPANT_TRANSITIONS: Readonly<Record<string, ReadonlySet<string>>> = {
  [CallParticipantState.INVITED]: new Set<string>([
    CallParticipantState.JOINED,
    CallParticipantState.DECLINED,
    CallParticipantState.MISSED,
  ]),
  // Re-joining after leaving is legitimate: a dropped connection on a call that
  // is still live is the commonest thing that happens to a call.
  [CallParticipantState.JOINED]: new Set<string>([CallParticipantState.LEFT]),
  [CallParticipantState.LEFT]: new Set<string>([CallParticipantState.JOINED]),
  [CallParticipantState.DECLINED]: new Set<string>(),
  [CallParticipantState.MISSED]: new Set<string>(),
};

export function canParticipantTransition(from: string, to: string): boolean {
  if (from === to) return true;
  return PARTICIPANT_TRANSITIONS[from]?.has(to) ?? false;
}
