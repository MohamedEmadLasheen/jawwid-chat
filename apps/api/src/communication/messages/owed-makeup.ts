import type { Prisma, PrismaClient } from '@prisma/client';
import { CardKind, LessonOutcome, RulingDecision } from '../contracts/vocab';

/**
 * Owner report 2026-10-29: a card that says a make-up is owed (the student's
 * excuse, the teacher's, the teacher's absence, an accepted late apology) never
 * learnt when that make-up is. A card is written once (chat.guard_message_card),
 * so the make-up is joined at READ time instead: every read of such a card
 * carries its live make-up as `makeupLessonId` / `makeupStartsAt` /
 * `makeupEndsAt`, which clients draw in the reader's zone (PD-22). Booking or
 * moving the make-up announces `message.updated` for the card, so open threads
 * re-read it. Always current: a moved make-up reads its new time, a cancelled
 * one reads nothing.
 */

/** The cards that can say a make-up is owed; `owesMakeup` picks the ones that do. */
export const MAKEUP_OWED_CARD_KINDS: readonly string[] = [
  CardKind.LESSON_APOLOGY, CardKind.LESSON_TEACHER_APOLOGY, CardKind.LESSON_CANCELLED, CardKind.LESSON_RULING,
];

export function owesMakeup(kind: string, p: Record<string, unknown>): boolean {
  if (kind === CardKind.LESSON_CANCELLED) return p.outcome === LessonOutcome.TEACHER_NO_SHOW;
  if (kind === CardKind.LESSON_RULING) return p.decision === RulingDecision.EXCUSED;
  return kind === CardKind.LESSON_APOLOGY || kind === CardKind.LESSON_TEACHER_APOLOGY;
}

/**
 * A make-up that still stands: not yet happened, or happened. One moved away
 * (rescheduled -- its successor carries the same makeup_for), cancelled,
 * voided, suspended or itself excused is not "the make-up" any more.
 */
const STANDING: Prisma.LessonWhereInput = {
  OR: [{ outcome: null }, { outcome: { in: [LessonOutcome.HELD, LessonOutcome.STUDENT_NO_SHOW] } }],
};

type CardRow = { card?: { kind: string; lessonId: string | null; payload: unknown } | null };

/** Rows whose card owes a make-up get their live make-up merged into the payload (one query per page). */
export async function withOwedMakeups<T extends CardRow>(
  prisma: Pick<PrismaClient, 'lesson'>,
  rows: T[],
): Promise<T[]> {
  const owesOne = (r: T): r is T & { card: { lessonId: string } } =>
    !!r.card?.lessonId && MAKEUP_OWED_CARD_KINDS.includes(r.card.kind) && owesMakeup(r.card.kind, payloadOf(r.card.payload));
  const owed = new Set<string>();
  for (const r of rows) if (owesOne(r)) owed.add(r.card.lessonId);
  if (owed.size === 0) return rows;
  const makeups = await prisma.lesson.findMany({
    where: { makeupFor: { in: [...owed] }, ...STANDING },
    select: { id: true, makeupFor: true, startsAt: true, endsAt: true },
    orderBy: { startsAt: 'desc' },
  });
  const byMissed = new Map<string, { id: string; startsAt: Date; endsAt: Date }>();
  for (const m of makeups) if (m.makeupFor && !byMissed.has(m.makeupFor)) byMissed.set(m.makeupFor, m);
  return rows.map((r) => {
    const makeup = owesOne(r) ? byMissed.get(r.card.lessonId) : undefined;
    if (!makeup || !r.card) return r;
    return {
      ...r,
      card: {
        ...r.card,
        payload: {
          ...payloadOf(r.card.payload),
          makeupLessonId: makeup.id,
          makeupStartsAt: makeup.startsAt.toISOString(),
          makeupEndsAt: makeup.endsAt.toISOString(),
        },
      },
    };
  });
}

function payloadOf(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
