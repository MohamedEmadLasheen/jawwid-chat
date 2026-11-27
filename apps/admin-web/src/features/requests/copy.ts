import type { Bilingual } from '@/features/admin/copy'

/** The Requests hub: Arabic and English side by side, as few words as it takes. */
export const RQ = {
  title: { en: 'Requests', ar: 'الطلبات' },
  subtitle: {
    en: 'Everything waiting for someone, longest wait first. A request opens on its own page.',
    ar: 'كل ما ينتظر أحدًا، الأطول انتظارًا أولًا. يُفتح كل طلب في صفحته.',
  },
  trial: { en: 'Trial lessons', ar: 'الحصص التجريبية' },
  family: { en: 'New students', ar: 'الطلاب الجدد' },
  certificate: { en: 'Certificates', ar: 'الشهادات' },
  renewal: { en: 'Renewal requests', ar: 'طلبات التجديد' },
  receipt: { en: 'Receipts', ar: 'الإيصالات' },
  lateCount: { en: '{n} since before today', ar: '{n} منذ ما قبل اليوم' },
  before: { en: 'Waiting since before today', ar: 'تنتظر منذ ما قبل اليوم' },
  today: { en: 'Today', ar: 'اليوم' },
  open: { en: 'Open', ar: 'فتح' },
  oneTrial: { en: 'Trial lesson', ar: 'حصة تجريبية' },
  oneFamily: { en: 'New family', ar: 'أسرة جديدة' },
  oneCertificate: { en: 'Certificate', ar: 'شهادة' },
  oneRenewal: { en: 'Renewal', ar: 'تجديد' },
  oneReceipt: { en: 'Receipt', ar: 'إيصال' },
  askOutcome: { en: 'Needs an outcome', ar: 'بانتظار النتيجة' },
  askSupervisor: { en: 'Needs a supervisor', ar: 'بانتظار تعيين مشرف' },
  askSignUp: { en: 'Waiting for the parent to sign up', ar: 'بانتظار تسجيل ولي الأمر' },
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
