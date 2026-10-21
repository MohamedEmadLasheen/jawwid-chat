import { CardKind } from '../communication/contracts/vocab';

export type CardLanguage = 'ar' | 'en';

/**
 * The one short sentence a trial's outcome is announced with. It never carries
 * a reason, a price or a contact detail: those stay with Sales and the New
 * Students page.
 */
export function resultSentence(result: unknown, lang: CardLanguage): string {
  const ar = lang === 'ar';
  switch (result) {
    case 'subscribed':
      return ar ? '🎉 اشترك الطالب.' : '🎉 The student has subscribed.';
    case 'not_subscribed':
      return ar ? 'ℹ️ لم يشترك الطالب.' : 'ℹ️ The student did not subscribe.';
    case 'no_show':
      return ar ? '⚠️ لم يحضر الطالب الحصة التجريبية.' : '⚠️ The student did not attend the trial lesson.';
    default:
      return ar ? 'تحديث' : 'Update';
  }
}

/**
 * The plain-text body of a PD-11 T4 trial card, in the group's language. A
 * client that knows the card draws `card.payload`; one that does not still
 * shows this. Pure.
 *
 * `startsAt` is an instant; it is written as the academy's local time by the
 * caller (`when`), so no reader's zone is guessed here.
 */
export function renderTrialCardBody(kind: string, p: Record<string, unknown>, lang: CardLanguage): string {
  const ar = lang === 'ar';
  const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
  const line = (label: string, value: unknown) =>
    value === null || value === undefined || value === '' ? null : `${label}: ${String(value)}`;
  const join = (...parts: Array<string | null>) => parts.filter((x): x is string => x !== null).join('\n');
  // Which trial: the group holds every trial of its teacher, so each card names
  // its student and time -- and nothing else about the family.
  const about = () => [s(p.prospectName), s(p.when)].filter((x) => x !== '').join(' · ') || null;

  switch (kind) {
    case CardKind.TRIAL_BOOKED:
      return join(
        ar ? `🗓️ حصة تجريبية — ${s(p.prospectName)}` : `🗓️ Trial lesson — ${s(p.prospectName)}`,
        line(ar ? 'الموعد' : 'When', p.when),
        line(ar ? 'المدة' : 'Length', p.durationMinutes === undefined ? null : ar ? `${s(p.durationMinutes)} دقيقة` : `${s(p.durationMinutes)} min`),
        line(ar ? 'المستوى' : 'Level', p.level),
      );
    case CardKind.TRIAL_CANCELLED:
      return join(
        ar ? `↩️ أُلغيت الحصة التجريبية — ${s(p.prospectName)}` : `↩️ Trial cancelled — ${s(p.prospectName)}`,
        line(ar ? 'الموعد' : 'When', p.when),
        line(ar ? 'السبب' : 'Reason', p.reason),
      );
    case CardKind.TRIAL_REPORT:
      return join(
        ar ? `✅ تقرير الحصة التجريبية — ${s(p.prospectName)}` : `✅ Trial report — ${s(p.prospectName)}`,
        line(ar ? 'ما تم' : 'Covered', p.covered),
        line(ar ? 'التقييم' : 'Rating', p.rating === null || p.rating === undefined ? null : `${s(p.rating)}/5`),
        line(ar ? 'ملاحظة' : 'Note', p.note),
      );
    case CardKind.TRIAL_NO_SHOW:
      return join(
        ar ? '⚠️ لم يحضر الطالب الحصة التجريبية.' : '⚠️ The student did not attend the trial lesson.',
        about(),
        line(ar ? 'ملاحظة' : 'Note', p.note),
      );
    case CardKind.TRIAL_DECISION:
      return join(resultSentence(p.result, lang), about());
    case CardKind.TRIAL_RESCHEDULED:
      return p.movedAway
        ? join(
            ar ? `↪️ نُقلت الحصة التجريبية إلى معلم آخر — ${s(p.prospectName)}` : `↪️ Trial moved to another teacher — ${s(p.prospectName)}`,
            line(ar ? 'الموعد السابق' : 'Was', p.previousWhen),
          )
        : join(
            ar ? `🔁 تغيّر موعد الحصة التجريبية — ${s(p.prospectName)}` : `🔁 Trial rescheduled — ${s(p.prospectName)}`,
            line(ar ? 'الموعد الجديد' : 'Now', p.when),
            line(ar ? 'الموعد السابق' : 'Was', p.previousWhen),
            line(ar ? 'المدة' : 'Length', p.durationMinutes === undefined ? null : ar ? `${s(p.durationMinutes)} دقيقة` : `${s(p.durationMinutes)} min`),
          );
    case CardKind.TRIAL_CORRECTION:
      return join(
        ar ? `✏️ تم تصحيح النتيجة: ${resultSentence(p.result, lang)}` : `✏️ Outcome corrected: ${resultSentence(p.result, lang)}`,
        about(),
      );
    default:
      return ar ? 'تحديث' : 'Update';
  }
}
