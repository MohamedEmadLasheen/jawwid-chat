/**
 * The Arabic lessons' content files, by lesson number. Each is checked in CI
 * (scripts/lessons/check-arabic-lesson.py) and again in the browser
 * (arabic-lesson.ts), and shows nothing until the Teachers department approved
 * it. Lesson 1 (the letters) arrives in P0-5 PR-2; until then none has content.
 */
const CONTENT: Record<number, unknown> = {};

export function arabicLessonFor(lesson: number): unknown {
  return CONTENT[lesson] ?? null;
}
