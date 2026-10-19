import { CardKind } from '../communication/contracts/vocab';

export type CardLanguage = 'ar' | 'en';

/**
 * PD-13: the plain-text body of a scheduled-call card, in the scheduler's
 * language. A client that knows the card draws `card.payload` (with a Join
 * button); one that does not still shows this. Pure.
 */
export function renderScheduledCallCardBody(kind: string, p: Record<string, unknown>, lang: CardLanguage): string {
  const ar = lang === 'ar';
  const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
  const title = s(p.title);
  const join = (...parts: Array<string | null>) => parts.filter((x): x is string => x !== null && x !== '').join('\n');

  switch (kind) {
    case CardKind.CALL_SCHEDULED:
      return join(
        ar ? '📅 مكالمة مجدولة' : '📅 Scheduled call',
        title || null,
        ar ? `الموعد: ${s(p.when)}` : `When: ${s(p.when)}`,
        ar ? `بواسطة: ${s(p.byName)}` : `By: ${s(p.byName)}`,
      );
    case CardKind.CALL_LINK:
      return join(
        ar ? '🔗 رابط مكالمة — انضم الآن' : '🔗 Call link — join now',
        title || null,
        ar ? `بواسطة: ${s(p.byName)}` : `By: ${s(p.byName)}`,
      );
    case CardKind.CALL_SCHEDULE_CANCELLED:
      return join(
        ar ? '🚫 أُلغيت المكالمة المجدولة' : '🚫 Scheduled call cancelled',
        title || null,
        ar ? `الموعد: ${s(p.when)}` : `When: ${s(p.when)}`,
      );
    default:
      return '';
  }
}
