import buruj from './surah-085.json';
import maun from './surah-107.json';
import kawthar from './surah-108.json';
import kafirun from './surah-109.json';
import nasr from './surah-110.json';
import masad from './surah-111.json';
import ikhlas from './surah-112.json';
import falaq from './surah-113.json';
import nas from './surah-114.json';

/**
 * The reviewed lesson content, by surah. Each file is checked against the
 * verified dataset in CI (scripts/lessons/check-lesson-content.py) and again
 * in the browser (lesson-content.ts). A surah without content still gets the
 * Quran sections of the lesson.
 */
// Al-Buruj (the reference lesson, P0-4) and Juz' Amma batch 1 (107-114). Every
// file is "pending" until the Teachers department approves it, and shows
// nothing beyond the verified Quran until then.
const CONTENT: Record<number, unknown> = {
  85: buruj,
  107: maun,
  108: kawthar,
  109: kafirun,
  110: nasr,
  111: masad,
  112: ikhlas,
  113: falaq,
  114: nas,
};

export function contentFor(surah: number): unknown {
  return CONTENT[surah] ?? null;
}
