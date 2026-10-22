import { CardKind } from '../communication/contracts/vocab';

export type CardLanguage = 'ar' | 'en';

/**
 * The plain-text body of a PD-12 card, in the reader's language. A client that
 * knows the card draws `card.payload`; one that does not still shows this.
 *
 * Pure. Dates are the ISO calendar dates the payload carries (a leave day or an
 * achievement date is a date, not an instant, so no time zone is guessed).
 */
/** A violation in one line: what happened, to whose lesson, when (a calendar date). */
function violation(p: Record<string, unknown>, ar: boolean): string {
  const what =
    p.violationKind === 'late'
      ? ar ? `تأخر ${String(p.lateMinutes ?? '')} دقيقة` : `${String(p.lateMinutes ?? '')} minutes late`
      : p.violationKind === 'teacher_no_show'
        ? ar ? 'غياب عن الحصة' : 'absent from the lesson'
        : p.violationKind === 'absence'
          ? ar ? 'غياب' : 'absent'
          : p.violationKind === 'complaint'
            ? ar ? 'شكوى ثبتت' : 'a complaint was upheld'
            : ar ? 'اعتذار عن الحصة' : 'apologised for the lesson';
  const whose = p.learnerName ? (ar ? ` (${String(p.learnerName)})` : ` (${String(p.learnerName)})`) : '';
  const when = p.lessonDay ? ` — ${String(p.lessonDay)}` : '';
  return `${what}${whose}${when}`;
}

export function renderPd012CardBody(kind: string, p: Record<string, unknown>, lang: CardLanguage): string {
  const ar = lang === 'ar';
  const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
  const line = (label: string, value: unknown) =>
    value === null || value === undefined || value === '' ? null : `${label}: ${String(value)}`;
  const join = (...parts: Array<string | null>) => parts.filter((x): x is string => x !== null).join('\n');
  const range = () => (p.firstDay === p.lastDay ? s(p.firstDay) : `${s(p.firstDay)} → ${s(p.lastDay)}`);

  switch (kind) {
    case CardKind.CERTIFICATE_REQUESTED:
      return join(
        ar ? `🎓 طلب شهادة — ${s(p.learnerName)}` : `🎓 Certificate request — ${s(p.learnerName)}`,
        line(ar ? 'الشهادة' : 'Certificate', p.title),
        line(ar ? 'الإنجاز' : 'Achievement', p.achievement),
        line(ar ? 'التاريخ' : 'Date', p.achievedOn),
        line(ar ? 'التقدير' : 'Grade', p.grade),
        line(ar ? 'الاسم على الشهادة' : 'Name on the certificate', p.printedName),
      );
    case CardKind.CERTIFICATE_ISSUED:
      return join(
        ar ? `🎓 شهادة ${s(p.learnerName)}` : `🎓 ${s(p.learnerName)}'s certificate`,
        line(ar ? 'الشهادة' : 'Certificate', p.title),
        line(ar ? 'الإنجاز' : 'Achievement', p.achievement),
        line(ar ? 'التقدير' : 'Grade', p.grade),
        ar ? 'مبارك! الشهادة مرفقة.' : 'Congratulations! The certificate is attached.',
      );
    case CardKind.CERTIFICATE_DECLINED:
      return join(
        ar ? `ℹ️ لم يُعتمد طلب شهادة ${s(p.learnerName)}` : `ℹ️ The certificate request for ${s(p.learnerName)} was not approved`,
        line(ar ? 'الشهادة' : 'Certificate', p.title),
        line(ar ? 'السبب' : 'Reason', p.reason),
      );
    case CardKind.LEAVE_REQUESTED:
      return join(
        ar ? `🌴 طلب إجازة: ${range()}` : `🌴 Leave request: ${range()}`,
        line(ar ? 'عدد الأيام' : 'Days', p.days),
        line(ar ? 'السبب' : 'Reason', p.reason),
        p.balance === null || p.balance === undefined
          ? null
          : `${ar ? 'الرصيد قبل الطلب' : 'Balance before this request'}: ${s(p.balance)}`,
      );
    case CardKind.LEAVE_APPROVED:
      return join(
        ar ? `✅ تمت الموافقة على الإجازة: ${range()}` : `✅ Leave approved: ${range()}`,
        line(ar ? 'أيام مخصومة' : 'Days deducted', p.days),
        line(ar ? 'الرصيد المتبقي' : 'Remaining balance', p.balance),
        line(ar ? 'ملاحظة' : 'Note', p.note),
      );
    case CardKind.LEAVE_DECLINED:
      return join(
        ar ? `❌ لم تتم الموافقة على الإجازة: ${range()}` : `❌ Leave not approved: ${range()}`,
        line(ar ? 'السبب' : 'Reason', p.note),
      );
    case CardKind.LEAVE_WITHDRAWN:
      return ar ? `↩️ سحب المعلم طلب الإجازة: ${range()}` : `↩️ The teacher withdrew the leave request: ${range()}`;
    case CardKind.DISCIPLINE_WARNING:
      return join(
        ar ? `⚠️ تنبيه: ${violation(p, ar)}` : `⚠️ Warning: ${violation(p, ar)}`,
        line(ar ? 'ملاحظة' : 'Note', p.note),
        ar ? `هذه المخالفة رقم ${s(p.step)} هذا الشهر.` : `This is violation ${s(p.step)} this month.`,
      );
    case CardKind.DISCIPLINE_DEDUCTION:
      return join(
        ar
          ? `⚠️ ${p.step === 2 ? 'الخصم الثاني' : 'الخصم الأول'}: ${violation(p, ar)}`
          : `⚠️ ${p.step === 2 ? 'Second deduction' : 'First deduction'}: ${violation(p, ar)}`,
        line(ar ? 'ملاحظة' : 'Note', p.note),
        ar ? 'يُحدَّد المبلغ في الرواتب.' : 'The amount is set in payroll.',
      );
    case CardKind.DISCIPLINE_SUSPENSION:
      return join(
        p.kind === 'permanent'
          ? ar ? '⛔ إيقاف نهائي' : '⛔ Permanent suspension'
          : ar ? `⛔ إيقاف مؤقت: ${s(p.startsOn)} → ${s(p.endsOn)}` : `⛔ Temporary suspension: ${s(p.startsOn)} → ${s(p.endsOn)}`,
        line(ar ? 'السبب' : 'Reason', violation(p, ar)),
        line(ar ? 'ملاحظة' : 'Note', p.note),
      );
    case CardKind.LEAVE_CANCELLED:
      return join(
        ar ? `↩️ أُلغيت الإجازة: ${range()}` : `↩️ Leave cancelled: ${range()}`,
        line(ar ? 'أيام أُعيدت إلى الرصيد' : 'Days returned to the balance', p.daysReturned),
        line(ar ? 'السبب' : 'Reason', p.note),
      );
    default:
      return ar ? 'تحديث' : 'Update';
  }
}
