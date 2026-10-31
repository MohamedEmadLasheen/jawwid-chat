/**
 * The Islamic Studies lessons' content files (topic lessons), by lesson number. Each is checked in CI
 * (scripts/lessons/check-arabic-lesson.py) and again in the browser (topic/topic.ts), and shows nothing
 * until the Teachers department approved it. Batch 1, the Prophet ﷺ lessons: 8 (who he is), 9 (his
 * mercy), 10 (his truthfulness), 11 (his trustworthiness) and 20 (Muhammad ﷺ is my Prophet), all pending.
 */
import prophet8 from './lesson-008.json';
import mercy9 from './lesson-009.json';
import truthful10 from './lesson-010.json';
import trustworthy11 from './lesson-011.json';
import myProphet20 from './lesson-020.json';

const CONTENT: Record<number, unknown> = { 8: prophet8, 9: mercy9, 10: truthful10, 11: trustworthy11, 20: myProphet20 };

export function islamicLessonFor(lesson: number): unknown {
  return CONTENT[lesson] ?? null;
}
