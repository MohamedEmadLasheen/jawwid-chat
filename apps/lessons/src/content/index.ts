import naba from './surah-078.json';
import naziat from './surah-079.json';
import abasa from './surah-080.json';
import takwir from './surah-081.json';
import infitar from './surah-082.json';
import mutaffifin from './surah-083.json';
import inshiqaq from './surah-084.json';
import buruj from './surah-085.json';
import tariq from './surah-086.json';
import ala from './surah-087.json';
import ghashiyah from './surah-088.json';
import fajr from './surah-089.json';
import balad from './surah-090.json';
import shams from './surah-091.json';
import layl from './surah-092.json';
import duha from './surah-093.json';
import sharh from './surah-094.json';
import tin from './surah-095.json';
import alaq from './surah-096.json';
import qadr from './surah-097.json';
import bayyinah from './surah-098.json';
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
// Al-Buruj (the reference lesson, P0-4) and the rest of Juz' Amma, batches 1-4 (78-114). Every
// file is "pending" until the Teachers department approves it, and shows
// nothing beyond the verified Quran until then.
const CONTENT: Record<number, unknown> = {
  78: naba,
  79: naziat,
  80: abasa,
  81: takwir,
  82: infitar,
  83: mutaffifin,
  84: inshiqaq,
  85: buruj,
  86: tariq,
  87: ala,
  88: ghashiyah,
  89: fajr,
  90: balad,
  91: shams,
  92: layl,
  93: duha,
  94: sharh,
  95: tin,
  96: alaq,
  97: qadr,
  98: bayyinah,
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
