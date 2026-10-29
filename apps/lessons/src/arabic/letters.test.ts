import { describe, expect, it } from 'vitest';
import fixture from './letters.fixture.json';
import { clusters, has, isLetter, isMark, isPhrase, isWord, lettersOf, positions } from './letters';

const units = fixture.units as Record<string, string[]>;

describe('the one letter rule (shared with the CI checker)', () => {
  for (const c of fixture.cases) {
    it(`${c.word} / ${c.unit}: ${c.has ? c.positions.join(', ') : 'not there'}`, () => {
      const unit = { letters: units[c.unit]! };
      expect(has(c.word, unit)).toBe(c.has);
      expect(positions(c.word, unit)).toEqual(c.positions);
    });
  }

  // Lesson 3 (the harakat): a unit with a mark counts a letter only where it carries that mark.
  const HARAKA: Record<string, string> = { fatha: String.fromCodePoint(0x64e), kasra: String.fromCodePoint(0x650), damma: String.fromCodePoint(0x64f) };
  for (const c of fixture.markedCases) {
    it(`${c.word} / ${c.letters.join('')} with ${c.mark}: ${c.has ? c.positions.join(', ') : 'not there'}`, () => {
      const unit = { letters: c.letters, mark: HARAKA[c.mark]! };
      expect(has(c.word, unit)).toBe(c.has);
      expect(positions(c.word, unit)).toEqual(c.positions);
    });
  }

  for (const m of fixture.marks) {
    it(`U+${m.cp.toString(16).toUpperCase()} (${m.note}) is ${m.isMark ? '' : 'not '}a mark`, () => {
      expect(isMark(String.fromCodePoint(m.cp))).toBe(m.isMark);
    });
  }
  for (const l of fixture.letters) {
    it(`U+${l.cp.toString(16).toUpperCase()} (${l.note}) is ${l.isLetter ? '' : 'not '}a letter`, () => {
      expect(isLetter(String.fromCodePoint(l.cp))).toBe(l.isLetter);
    });
  }
  for (const w of fixture.words) {
    const text = 'cps' in w && w.cps ? String.fromCodePoint(...w.cps) : (w as { text: string }).text;
    it(`${JSON.stringify(text)} ${'note' in w ? `(${w.note}) ` : ''}is ${w.isWord ? '' : 'not '}one written word`, () => {
      expect(isWord(text)).toBe(w.isWord);
    });
  }

  it('a unit name may be a short phrase of written words, one space apart', () => {
    expect(isPhrase('بَاءْ')).toBe(true);
    expect(isPhrase('أَلِفٌ مَقْصُورَةْ')).toBe(true);
    for (const bad of ['', ' بَاءْ', 'أَلِفٌ  مَقْصُورَةْ', 'بَاءْ ', 'بَاءْ1']) expect(isPhrase(bad)).toBe(false);
  });

  it('removes marks only: hamza seats, madda and wasla stay letters of their own', () => {
    expect(lettersOf('أَسَدْ')).toEqual(['أ', 'س', 'د']);
    expect(lettersOf('هٰذَا')).toEqual(['ه', 'ذ', 'ا']);
    expect(lettersOf('آدَمْ')[0]).toBe('آ');
  });

  it('accepts only letters and marks as a word', () => {
    expect(isWord('كِتَابْ')).toBe(true);
    for (const bad of ['', 'ab', 'كتاب ', 'كِتَاب1', String.fromCodePoint(0x64e) + 'ب', 'كـتاب']) expect(isWord(bad)).toBe(false);
    // Marks out of canonical order (shadda typed before fatha) are not NFC: the text hash would not be stable.
    const shaddaFirst = 'ح' + String.fromCodePoint(0x651, 0x64e) + 'بْ';
    expect(shaddaFirst.normalize('NFC')).not.toBe(shaddaFirst);
    expect(isWord(shaddaFirst)).toBe(false);
    expect(isWord(shaddaFirst.normalize('NFC'))).toBe(true);
  });

  it('cuts a word into tappable pieces, each letter with its marks, a pair as one', () => {
    expect(clusters('بَابْ', { letters: ['ب'] })).toEqual([
      { text: 'بَ', target: true },
      { text: 'ا', target: false },
      { text: 'بْ', target: true },
    ]);
    expect(clusters('لَاعِبْ', { letters: ['لا'] })).toEqual([
      { text: 'لَا', target: true },
      { text: 'عِ', target: false },
      { text: 'بْ', target: false },
    ]);
    expect(clusters('أَسَدْ', { letters: ['ا'] }).some((p) => p.target)).toBe(false);
    // The lam-alif ligature is never split: marking only its alif (or only its lam) would break it on screen.
    expect(clusters('سَلَامْ', { letters: ['ا'] })).toEqual([
      { text: 'سَ', target: false },
      { text: 'لَا', target: true },
      { text: 'مْ', target: false },
    ]);
    expect(clusters('لَأْمْ', { letters: ['ل'] }).map((p) => p.text)).toEqual(['لَأْ', 'مْ']);
    // With a mark, only the letter that carries it is the target: in بَابْ the first ب (fatha), not the last (sukun).
    expect(clusters('بَابْ', { letters: ['ب'], mark: String.fromCodePoint(0x64e) }).map((p) => p.target)).toEqual([true, false, false]);
  });
});
