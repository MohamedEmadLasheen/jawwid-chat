import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { WordMatcher } from '../../../src/platform/content-filter/word-matcher';
import { DRAFT_WORD_LIST } from '../../../src/platform/content-filter/word-list';

/**
 * LD-12 FALSE-POSITIVE GUARD. This is a Quran and Arabic academy: the filter's
 * real list (the draft, and whatever the owner approves in its place) must
 * never refuse Quran text, hadith, the lessons' own Arabic, or ordinary
 * religious vocabulary. Every ayah of the repository's Quran source, every
 * string of the lesson content, and a set of known traps run through it here,
 * and nothing may match.
 *
 * A word added to the list that fails this test is a word that would have
 * refused a parent quoting the Quran. Take the word out; never narrow the test.
 */
const REPO = resolve(__dirname, '../../../../..');
const matcher = new WordMatcher([...DRAFT_WORD_LIST.ar, ...DRAFT_WORD_LIST.en]);

const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;

function stringsIn(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) stringsIn(v, out);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) stringsIn(v, out);
  return out;
}

function jsonStringsUnder(dir: string, name: RegExp): string[] {
  const out: string[] = [];
  for (const file of readdirSync(dir).filter((f) => name.test(f))) {
    stringsIn(JSON.parse(readFileSync(join(dir, file), 'utf8')), out);
  }
  return out;
}

describe('LD-12: the word list never refuses the Quran, hadith or the lessons', () => {
  it('no ayah of the Quran source (data/quran) matches', () => {
    const lines = readFileSync(join(REPO, 'data/quran/tanzil-uthmani-1.1.txt'), 'utf8')
      .split('\n')
      .filter((l) => /^\d+\|\d+\|/.test(l));
    // The whole text, not a slice of it.
    expect(lines).toHaveLength(6236);
    const matched = lines.filter((l) => matcher.matches(l.split('|')[2]));
    expect(matched.map((l) => l.split('|').slice(0, 2).join(':'))).toEqual([]);
  });

  it('no Arabic string of the lesson content matches', () => {
    const strings = [
      ...jsonStringsUnder(join(REPO, 'apps/lessons/src/content'), /^surah-\d+\.json$/),
      ...jsonStringsUnder(join(REPO, 'apps/lessons/src/arabic'), /^lesson-\d+\.json$/),
      ...jsonStringsUnder(join(REPO, 'apps/api/src/lesson-audio/texts'), /\.json$/),
    ].filter((s) => ARABIC.test(s));
    // Enough of it to mean something: the sources hold about 3000 Arabic strings.
    expect(strings.length).toBeGreaterThan(1000);
    expect(strings.filter((s) => matcher.matches(s))).toEqual([]);
  });

  it('hadith, fiqh terms and ordinary religious vocabulary do not match', () => {
    const traps = [
      // Hadith and du'a.
      'إنما الأعمال بالنيات وإنما لكل امرئ ما نوى',
      'الولد للفراش وللعاهر الحجر',
      'لعن الله الراشي والمرتشي',
      'صلى الله عليه وسلم',
      'اللهم صل وسلم على نبينا محمد',
      'سبحان الله وبحمده سبحان الله العظيم',
      'أستغفر الله العظيم وأتوب إليه',
      'لا حول ولا قوة إلا بالله',
      // Terms of hadith science and fiqh.
      'هذا حديث شاذ وذاك حديث منكر وهذا ضعيف',
      'حد الزنا وحد القذف وحد السرقة',
      'الزانية والزاني فاجلدوا كل واحد منهما مائة جلدة',
      'قصة قوم لوط وامرأة نوح',
      'نجاسة الكلب والخنزير',
      'مثل الحمار يحمل أسفارا',
      'عذاب جهنم ونار الآخرة',
      'الجماع والطهارة والغسل من الجنابة',
      'العورة في الصلاة',
      'إبليس والشيطان الرجيم',
      'اللعنة على الكاذبين',
      // Ordinary vocabulary close to listed words.
      'كسر الزجاج وكسوة الكعبة وكساء',
      'عرض الدرس وعرس أخي',
      'نيكولا ونيكون',
      // English religious vocabulary and the classic substring traps.
      'The Prophet, peace be upon him, warned of Hell and the Fire.',
      'Allah, Jahannam, Iblis, Satan, damnation, adultery, fornication.',
      'Scunthorpe, Sussex, assassin, classic, cocktail, Dickens, shiitake, Shiite, Penistone.',
      'Middlesex, Essex, therapist, analytics, butterscotch, passage, grasshopper.',
    ];
    expect(traps.filter((t) => matcher.matches(t))).toEqual([]);
  });
});
