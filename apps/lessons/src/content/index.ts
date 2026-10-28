import buruj from './surah-085.json';
import zalzalah from './surah-099.json';
import adiyat from './surah-100.json';
import qariah from './surah-101.json';
import takathur from './surah-102.json';
import asr from './surah-103.json';
import humazah from './surah-104.json';
import fil from './surah-105.json';
import quraysh from './surah-106.json';
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
// Al-Buruj (the reference lesson, P0-4) and Juz' Amma batches 1-2 (99-114). Every
// file is "pending" until the Teachers department approves it, and shows
// nothing beyond the verified Quran until then.
const CONTENT: Record<number, unknown> = {
  85: buruj,
  99: zalzalah,
  100: adiyat,
  101: qariah,
  102: takathur,
  103: asr,
  104: humazah,
  105: fil,
  106: quraysh,
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
