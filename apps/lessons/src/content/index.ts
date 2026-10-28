import buruj from './surah-085.json';

/**
 * The reviewed lesson content, by surah. Each file is checked against the
 * verified dataset in CI (scripts/lessons/check-lesson-content.py) and again
 * in the browser (lesson-content.ts). A surah without content still gets the
 * Quran sections of the lesson.
 */
const CONTENT: Record<number, unknown> = { 85: buruj };

export function contentFor(surah: number): unknown {
  return CONTENT[surah] ?? null;
}
