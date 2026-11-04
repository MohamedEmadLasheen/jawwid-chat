/**
 * The Islamic Studies lessons' content files (topic lessons), by lesson number. Each is checked in CI
 * (scripts/lessons/check-arabic-lesson.py) and again in the browser (topic/topic.ts), and shows nothing
 * until the Teachers department approved it. None yet: batch 1 (the Prophet ﷺ lessons) follows.
 */
const CONTENT: Record<number, unknown> = {};

export function islamicLessonFor(lesson: number): unknown {
  return CONTENT[lesson] ?? null;
}
