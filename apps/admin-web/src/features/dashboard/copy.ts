import type { Bilingual } from '@/features/admin/copy'

/** PD-44: the Dashboard's own words, Arabic first (plan §4.4). Tile names live in registry.ts. */
export const D = {
  oldest: { ar: 'أقدمها {age}', en: 'Oldest {age}' },
  allClear: { ar: 'لا شيء ينتظر في هذا القسم', en: 'Nothing waiting in this section' },
  failed: { ar: 'تعذّر تحميل هذا القسم', en: 'This section could not be loaded' },
  needs: { ar: 'بانتظارك الآن', en: 'Needs you now' },
  needsClear: { ar: 'لا شيء ينتظر فريقك الآن. ما يتأخر أو ينتظر ردًّا يظهر هنا أولًا.', en: 'Nothing is waiting on your team. What is late or waiting for an answer appears here first.' },
  needsLoading: { ar: 'جارٍ عدّ ما ينتظر…', en: 'Counting what is waiting…' },
  calm: { ar: 'لا شيء بانتظارك', en: 'Nothing needs you' },
  late: { ar: 'متأخرة', en: 'Late' },
  lateCount: { ar: '{n} متأخرة', en: '{n} late' },
  noSections: { ar: 'لا توجد أرقام متاحة لحسابك بعد', en: 'No figures are available for your account yet' },
} satisfies Record<string, Bilingual>
