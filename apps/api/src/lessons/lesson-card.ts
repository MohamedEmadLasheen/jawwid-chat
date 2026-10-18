import { CardKind, LessonOutcome, RulingDecision } from '../communication/contracts/vocab';

export type CardLanguage = 'ar' | 'en';

/**
 * The plain-text body of a card message, in the family's language. A client
 * that knows cards draws `card.payload`; one that does not still shows this,
 * so a build that predates PD-11 reads a sensible message instead of nothing.
 *
 * Pure, and deliberately plain: no names of anyone but the learner, and no time
 * zone guessed for the reader (the card's own timestamps are what clients format).
 */
export function renderCardBody(kind: string, p: Record<string, unknown>, lang: CardLanguage): string {
  const ar = lang === 'ar';
  const learner = String(p.learnerName ?? '');
  const line = (label: string, value: unknown) =>
    value === null || value === undefined || value === '' ? null : `${label}: ${String(value)}`;
  const join = (...parts: Array<string | null>) => parts.filter((x): x is string => x !== null).join('\n');

  switch (kind) {
    case CardKind.LESSON_REPORT:
      return join(
        ar ? `📘 تقرير حصة ${learner}` : `📘 Lesson report — ${learner}`,
        line(ar ? 'ما تمت دراسته' : 'Covered', p.covered),
        line(ar ? 'الواجب' : 'Homework', p.homework),
        p.rating ? `${ar ? 'التقييم' : 'Rating'}: ${'★'.repeat(Number(p.rating))}` : null,
        line(ar ? 'ملاحظة' : 'Note', p.note),
      );
    case CardKind.LESSON_ABSENCE:
      return join(
        ar ? `⏰ لم يحضر ${learner} الحصة` : `⏰ ${learner} did not attend the lesson`,
        line(ar ? 'ملاحظة' : 'Note', p.note),
        ar ? 'إذا كان هناك ظرف طارئ يمكنكم تقديم اعتذار متأخر.' : 'If there was an emergency, you can send a late apology.',
      );
    case CardKind.LESSON_APOLOGY:
      return join(
        ar ? `🙏 اعتذار عن حصة ${learner}` : `🙏 Apology for ${learner}'s lesson`,
        line(ar ? 'السبب' : 'Reason', p.reason),
      );
    case CardKind.LESSON_TEACHER_APOLOGY:
      return join(
        ar ? `🙏 اعتذر المعلم عن حصة ${learner}` : `🙏 The teacher cannot teach ${learner}'s lesson`,
        line(ar ? 'السبب' : 'Reason', p.reason),
        ar ? 'سيتم ترتيب حصة تعويضية.' : 'A make-up lesson will be arranged.',
      );
    case CardKind.LESSON_CANCELLED:
      return p.outcome === LessonOutcome.TEACHER_NO_SHOW
        ? join(
            ar ? `⚠️ لم تُعقد حصة ${learner} لغياب المعلم` : `⚠️ ${learner}'s lesson did not take place: the teacher was absent`,
            ar ? 'سيتم ترتيب حصة تعويضية.' : 'A make-up lesson will be arranged.',
          )
        : join(
            ar ? `❌ أُلغيت حصة ${learner}` : `❌ ${learner}'s lesson was cancelled`,
            line(ar ? 'السبب' : 'Reason', p.reason),
          );
    case CardKind.LESSON_LATE_APOLOGY:
      return join(
        ar ? `🕊️ اعتذار متأخر عن حصة ${learner}` : `🕊️ Late apology for ${learner}'s lesson`,
        line(ar ? 'السبب' : 'Reason', p.reason),
        ar ? 'ستراجعه الإدارة.' : 'The supervision team will review it.',
      );
    case CardKind.LESSON_RULING:
      return join(
        p.decision === RulingDecision.EXCUSED
          ? ar ? `✅ قُبل الاعتذار عن حصة ${learner}` : `✅ The apology for ${learner}'s lesson was accepted`
          : ar ? `ℹ️ سُجّلت حصة ${learner} غيابًا` : `ℹ️ ${learner}'s lesson is recorded as an absence`,
        line(ar ? 'ملاحظة' : 'Note', p.note),
      );
    default:
      return ar ? 'تحديث على الحصة' : 'Lesson update';
  }
}
