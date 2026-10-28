import { describe, expect, it } from 'vitest';
import fixture from './letters.fixture.json';
import { clusters, has, isWord, lettersOf, positions } from './letters';

const units = fixture.units as Record<string, string[]>;

describe('the one letter rule (shared with the CI checker)', () => {
  for (const c of fixture.cases) {
    it(`${c.word} / ${c.unit}: ${c.has ? c.positions.join(', ') : 'not there'}`, () => {
      const unit = { letters: units[c.unit]! };
      expect(has(c.word, unit)).toBe(c.has);
      expect(positions(c.word, unit)).toEqual(c.positions);
    });
  }

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
  });
});
