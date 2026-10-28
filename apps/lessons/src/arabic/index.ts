/**
 * The Arabic lessons' content files, by lesson number. Each is checked in CI
 * (scripts/lessons/check-arabic-lesson.py) and again in the browser
 * (arabic-lesson.ts), and shows nothing until the Teachers department approved
 * it. Lesson 1 is the letters (P0-5), pending the Teachers department's review.
 */
import letters from './lesson-001.json';

const CONTENT: Record<number, unknown> = { 1: letters };

export function arabicLessonFor(lesson: number): unknown {
  return CONTENT[lesson] ?? null;
}
