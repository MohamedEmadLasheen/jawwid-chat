import type { Bilingual } from '@/features/admin/copy'

/** PD-44: the Dashboard's own words, Arabic first (plan §4.4). Tile names live in registry.ts. */
export const D = {
  subtitle: { ar: 'ما ينتظر فريقك الآن', en: 'What is waiting for your team now' },
  oldest: { ar: 'أقدمها {age}', en: 'Oldest {age}' },
  allClear: { ar: 'لا شيء ينتظر في هذا القسم', en: 'Nothing waiting in this section' },
  failed: { ar: 'تعذّر تحميل هذا القسم', en: 'This section could not be loaded' },
  noSections: { ar: 'لا توجد أرقام متاحة لحسابك بعد', en: 'No figures are available for your account yet' },
} satisfies Record<string, Bilingual>
