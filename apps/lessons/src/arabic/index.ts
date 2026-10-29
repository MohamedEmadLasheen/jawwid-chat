/**
 * The Arabic lessons' content files, by lesson number. Each is checked in CI
 * (scripts/lessons/check-arabic-lesson.py) and again in the browser
 * (arabic-lesson.ts), and shows nothing until the Teachers department approved
 * it. Lesson 1 is the letters (P0-5) and lesson 3 the harakat, both pending the
 * Teachers department's review. Lesson 9: the shadda (a starter), pending too.
 */
import letters from './lesson-001.json';
import harakat from './lesson-003.json';
import shadda from './lesson-009.json';

const CONTENT: Record<number, unknown> = { 1: letters, 3: harakat, 9: shadda };

export function arabicLessonFor(lesson: number): unknown {
  return CONTENT[lesson] ?? null;
}
