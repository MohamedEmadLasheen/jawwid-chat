/**
 * The Arabic lessons' content files, by lesson number. Each is checked in CI
 * (scripts/lessons/check-arabic-lesson.py) and again in the browser
 * (arabic-lesson.ts), and shows nothing until the Teachers department approved
 * it. Lesson 1 is the letters (P0-5), lesson 2 the letters that look or sound
 * alike, and lesson 3 the harakat, all pending the Teachers department's review.
 */
import letters from './lesson-001.json';
import pairs from './lesson-002.json';
import harakat from './lesson-003.json';

const CONTENT: Record<number, unknown> = { 1: letters, 2: pairs, 3: harakat };

export function arabicLessonFor(lesson: number): unknown {
  return CONTENT[lesson] ?? null;
}
