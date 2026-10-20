/**
 * PD-15: the quick choices of a lesson report, so a teacher taps instead of
 * typing. One definition: the API validates against these codes, the card body
 * is rendered from these labels, and the clients ship the same codes (an
 * unknown code is shown as the code, never dropped).
 *
 * The lists fit a Quran and Arabic academy. They are a starting set the
 * academic team may change: adding a code here and in the clients is the whole
 * change, because the database stores the codes as text.
 */

/** What the lesson covered. A report needs at least one of these, or a short text. */
export const COVERED_TOPICS = {
  new_memorization: { en: 'New memorization', ar: 'حفظ جديد' },
  revision: { en: 'Revision', ar: 'مراجعة' },
  recitation: { en: 'Recitation', ar: 'تلاوة' },
  tajweed: { en: 'Tajweed rules', ar: 'أحكام التجويد' },
  reading: { en: 'Reading', ar: 'قراءة' },
  writing: { en: 'Writing', ar: 'كتابة' },
  grammar: { en: 'Grammar', ar: 'قواعد' },
  vocabulary: { en: 'Vocabulary', ar: 'مفردات' },
  islamic_studies: { en: 'Islamic studies', ar: 'تربية إسلامية' },
  assessment: { en: 'Test / assessment', ar: 'اختبار وتقييم' },
} as const;

/** What the learner should do before the next lesson. */
export const NEXT_TASKS = {
  memorize_new: { en: 'Memorize the new part', ar: 'حفظ المقطع الجديد' },
  revise_previous: { en: 'Revise previous lessons', ar: 'مراجعة ما سبق' },
  practise_recitation: { en: 'Practise recitation', ar: 'التدرّب على التلاوة' },
  practise_reading: { en: 'Practise reading', ar: 'التدرّب على القراءة' },
  written_homework: { en: 'Written homework', ar: 'واجب كتابي' },
  prepare_next: { en: 'Prepare the next lesson', ar: 'التحضير للدرس القادم' },
  nothing: { en: 'Nothing this time', ar: 'لا يوجد واجب' },
} as const;

/** The performance level, stored as lesson_report.rating (1..5). */
export const PERFORMANCE_LEVELS = {
  5: { en: 'Excellent', ar: 'ممتاز' },
  4: { en: 'Very good', ar: 'جيد جدًا' },
  3: { en: 'Good', ar: 'جيد' },
  2: { en: 'Fair', ar: 'مقبول' },
  1: { en: 'Needs more work', ar: 'يحتاج إلى متابعة' },
} as const;

export type CoveredTopic = keyof typeof COVERED_TOPICS;
export type NextTask = keyof typeof NEXT_TASKS;

export function topicLabel(code: string, ar: boolean): string {
  const t = (COVERED_TOPICS as Record<string, { en: string; ar: string }>)[code];
  return t ? (ar ? t.ar : t.en) : code;
}

export function taskLabel(code: string, ar: boolean): string {
  const t = (NEXT_TASKS as Record<string, { en: string; ar: string }>)[code];
  return t ? (ar ? t.ar : t.en) : code;
}

export function performanceLabel(rating: number, ar: boolean): string | null {
  const p = (PERFORMANCE_LEVELS as Record<number, { en: string; ar: string }>)[rating];
  return p ? (ar ? p.ar : p.en) : null;
}
