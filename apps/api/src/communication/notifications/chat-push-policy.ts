import { QuietHoursService } from './quiet-hours.service';

/**
 * PD-34 amendment (owner, 2026-10-27): the CHAT push policy, as pure functions.
 *
 * Applies to chat-message pushes only (new_message and its summaries; PD-36
 * mentions take the quiet hours but not the cap). Lesson, payment, instalment
 * and renewal reminders, calls, PD-33 cover lines, approvals and administrative
 * alerts keep their own rules and never come through here.
 */

export interface QuietWindow {
  enabled: boolean;
  startMinute: number;
  endMinute: number;
  /** The recipient's own zone (PD-22), or the academy's. */
  zone: string;
}

const MINUTE = 60_000;

/**
 * `at`, or the END of the recipient's quiet window when `at` falls inside it.
 * Never drops anything. Daylight saving is handled: the result is the first
 * instant at or after `at` whose LOCAL clock reads endMinute, so a night on
 * which the clocks move still ends at 08:00 local, not at 07:00 or 09:00.
 */
export function deferForQuiet(at: Date, w: QuietWindow | undefined): Date {
  if (!w || !w.enabled) return at;
  const local = QuietHoursService.minutesInZone(at, w.zone);
  if (!QuietHoursService.isQuiet(local, w.startMinute, w.endMinute)) return at;
  let delta = w.endMinute - local;
  if (delta <= 0) delta += 24 * 60;
  let end = new Date(Math.floor((at.getTime() + delta * MINUTE) / MINUTE) * MINUTE);
  // A clock change overnight puts the naive answer an hour off the local end:
  // correct by the difference (at most twice, for a zone that shifts by more).
  for (let i = 0; i < 2; i++) {
    const off = QuietHoursService.minutesInZone(end, w.zone) - w.endMinute;
    if (off === 0) break;
    const wrapped = ((off + 720) % 1440 + 1440) % 1440 - 720; // -720..719
    end = new Date(end.getTime() - wrapped * MINUTE);
  }
  return end.getTime() < at.getTime() ? at : end;
}

/**
 * When the rolling-hour cap frees up. `pushTimes` are the times of the chat
 * pushes already counted in the hour before `at` (summaries excluded). Below
 * the cap: null (push as usual). At or over it: the moment enough of them have
 * aged out of the hour that one more fits.
 */
export function capFreesAt(at: Date, pushTimes: readonly Date[], cap: number, windowMs = 60 * MINUTE): Date | null {
  if (cap <= 0) return null;
  const inWindow = pushTimes
    .filter((t) => t.getTime() > at.getTime() - windowMs && t.getTime() <= at.getTime())
    .sort((a, b) => a.getTime() - b.getTime());
  if (inWindow.length < cap) return null;
  const oldestThatMustAge = inWindow[inWindow.length - cap]!;
  return new Date(oldestThatMustAge.getTime() + windowMs);
}

/**
 * A held (deferred) chat push: which chats it stands for and which of their
 * messages -- `q` the seqs, `n` how many (a message without a seq counts but
 * has none), `s` the newest seq -- so a read takes out exactly what it covers.
 */
export interface HeldChats {
  [conversationId: string]: { s: string | null; n: number; q?: string[] };
}

export function heldCount(chats: HeldChats): number {
  return Object.values(chats).reduce((a, c) => a + c.n, 0);
}

/** One message more for `conversationId`; lastSeq only moves up. */
export function heldAdd(chats: HeldChats, conversationId: string, seq: string | null): HeldChats {
  const prev = chats[conversationId];
  const s = prev?.s ?? null;
  const next = seq === null ? s : s === null || BigInt(seq) > BigInt(s) ? seq : s;
  const q = seq === null ? [...(prev?.q ?? [])] : [...(prev?.q ?? []), seq];
  return { ...chats, [conversationId]: { s: next, n: (prev?.n ?? 0) + 1, q } };
}

/**
 * A read of `conversationId` up to `readSeq` takes out the messages it covers:
 * every seq at or below it, and every message without a seq. The chat stays
 * in only while a later message is still unread.
 */
export function heldRead(chats: HeldChats, conversationId: string, readSeq: bigint): HeldChats {
  const c = chats[conversationId];
  if (!c) return chats;
  const q = (c.q ?? []).filter((x) => BigInt(x) > readSeq);
  if (q.length === 0) {
    const { [conversationId]: _gone, ...rest } = chats;
    return rest;
  }
  const s = q.reduce((a, b) => (BigInt(b) > BigInt(a) ? b : a));
  return { ...chats, [conversationId]: { s, n: q.length, q } };
}

/** The chats the recipient may no longer hear are removed (PD-34 review P1). */
export function heldKeep(chats: HeldChats, allowed: (conversationId: string) => boolean): HeldChats {
  return Object.fromEntries(Object.entries(chats).filter(([id]) => allowed(id)));
}

/** The generic, lock-screen-safe template for what the held push now stands for. */
export function heldTemplate(chats: HeldChats): 'new_message' | 'new_messages_summary' {
  return heldCount(chats) <= 1 ? 'new_message' : 'new_messages_summary';
}
