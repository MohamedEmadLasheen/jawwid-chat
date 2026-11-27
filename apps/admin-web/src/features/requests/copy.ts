import type { Bilingual } from '@/features/admin/copy'

/** The unified Requests page: Arabic and English side by side, as few words as it takes. */
export const RQ = {
  title: { en: 'Requests', ar: 'الطلبات' },
  subtitle: {
    en: 'Everything waiting for someone, longest wait first. A row opens on its own page.',
    ar: 'كل ما ينتظر أحدًا، الأطول انتظارًا أولًا. يُفتح كل صف في صفحته.',
  },
  types: { en: 'Requests by type', ar: 'الطلبات حسب النوع' },
  all: { en: 'All', ar: 'الكل' },
  trial: { en: 'Trial lessons', ar: 'الحصص التجريبية' },
  family: { en: 'New students', ar: 'الطلاب الجدد' },
  certificate: { en: 'Certificates', ar: 'الشهادات' },
  renewal: { en: 'Renewal requests', ar: 'طلبات التجديد' },
  receipt: { en: 'Receipts', ar: 'الإيصالات' },
  lateCount: { en: '{n} late', ar: 'متأخر: {n}' },
  colType: { en: 'Type', ar: 'النوع' },
  colWho: { en: 'Who', ar: 'صاحب الطلب' },
  colOwner: { en: 'Owner', ar: 'المسؤول' },
  colAge: { en: 'Waiting', ar: 'الانتظار' },
  colStatus: { en: 'Status', ar: 'الحالة' },
  oneTrial: { en: 'Trial lesson', ar: 'حصة تجريبية' },
  oneFamily: { en: 'New family', ar: 'أسرة جديدة' },
  oneCertificate: { en: 'Certificate', ar: 'شهادة' },
  oneRenewal: { en: 'Renewal', ar: 'تجديد' },
  oneReceipt: { en: 'Receipt', ar: 'إيصال' },
  needsOutcome: { en: 'Needs an outcome', ar: 'بانتظار النتيجة' },
  renewalAsked: { en: 'Asked to renew', ar: 'طلب التجديد' },
  toConfirm: { en: 'To confirm', ar: 'للتأكيد' },
  empty: { en: 'Nothing is waiting.', ar: 'لا شيء بالانتظار.' },
  emptyHint: {
    en: 'A trial without its outcome, a family being set up, a certificate on its way, a renewal or a receipt appears here until it is dealt with.',
    ar: 'تظهر هنا الحصة التجريبية التي لم تُسجَّل نتيجتها، والأسرة قيد التجهيز، والشهادة في طريقها، وطلب التجديد والإيصال، إلى أن يُنجز كل منها.',
  },
  emptyType: { en: 'Nothing of this type is waiting.', ar: 'لا شيء من هذا النوع بالانتظار.' },
  none: { en: 'No requests page is open to this account.', ar: 'لا توجد صفحة طلبات متاحة لهذا الحساب.' },
  more: { en: 'More may be waiting on the Certificates page.', ar: 'قد يوجد المزيد في صفحة الشهادات.' },
} satisfies Record<string, Bilingual>
