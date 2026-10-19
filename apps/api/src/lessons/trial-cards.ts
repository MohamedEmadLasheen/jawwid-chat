import { CardKind } from '../communication/contracts/vocab';

export type CardLanguage = 'ar' | 'en';

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
        ar ? `⚠️ لم يحضر الحصة التجريبية — ${s(p.prospectName)}` : `⚠️ Did not attend the trial — ${s(p.prospectName)}`,
        line(ar ? 'الموعد' : 'When', p.when),
        line(ar ? 'ملاحظة' : 'Note', p.note),
      );
    case CardKind.TRIAL_DECISION:
      return p.result === 'subscribed'
        ? ar
          ? `🎉 اشترك ${s(p.prospectName)} — بانتظار تأكيد Core`
          : `🎉 ${s(p.prospectName)} subscribed — awaiting Core's confirmation`
        : ar
          ? `ℹ️ لم يشترك ${s(p.prospectName)}`
          : `ℹ️ ${s(p.prospectName)} did not subscribe`;
    default:
      return ar ? 'تحديث' : 'Update';
  }
}
