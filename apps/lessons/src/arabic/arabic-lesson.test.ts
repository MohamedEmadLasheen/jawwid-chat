import { describe, expect, it } from 'vitest';
import { resolveArabicLesson, type ArabicLesson } from './arabic-lesson';
import { standIn } from '../test/arabic-stand-in';

describe('an Arabic letters lesson: words, positions and a quiz proved by the one rule', () => {
  it('resolves, computes each word\'s positions, and holds back flagged words and the questions that show them', () => {
    const r = resolveArabicLesson(standIn(), 1)!;
    expect(r.approved).toBe(true);
    const alif = r.units[0]!;
    expect(alif.words).toEqual([
      { text: 'كِتَابْ', positions: ['middle'] },
      { text: 'عَصَا', positions: ['end'] },
    ]);
    expect(alif.note).toBe('مُلَاحَظَةْ');
    // أَسَدْ is a hamza word: it starts with أ, which is not alif.
    expect(r.units[1]!.words.map((w) => w.positions)).toEqual([['start'], ['middle'], ['end']]);
    // q3 shows the flagged بَابْ, q4 is flagged itself: both held; the flagged word is held too.
    expect(r.quiz.map((q) => q.id)).toEqual(['q1', 'q2']);
    expect(r.quiz[1]).toMatchObject({ word: 'جُزْءْ', answer: 2 });
    expect(r.held).toBe(3);
  });

  it('shows nothing of a pending file (the page gates on `approved`)', () => {
    const c = standIn();
    c.review.status = 'pending';
    expect(resolveArabicLesson(c, 1)!.approved).toBe(false);
  });

  it('refuses the whole file when any proof fails', () => {
    const bad: ((c: ArabicLesson) => void)[] = [
      (c) => { c.units[0]!.words.push({ text: 'أَسَدْ', was: null, review: null }); }, // an أ word filed as alif
      (c) => { c.units[0]!.words[0]!.text = 'كِتَاب ب'; }, // not one word
      (c) => { c.quiz[0] = { ...c.quiz[0]!, kind: 'contains', options: ['كِتَابْ', 'عَصَا'], answer: 0 } as never; }, // two right answers
      (c) => { c.quiz[0] = { ...c.quiz[0]!, answer: 0 } as never; }, // the answer is not the right one
      (c) => { c.quiz[0] = { ...c.quiz[0]!, options: ['كِتَابْ', 'قَلَمْ'] } as never; }, // an option outside the lesson
      (c) => { c.quiz[1] = { id: 'q2', kind: 'position', unit: 'alif', word: 'كِتَابْ', answer: 'end', review: null }; }, // wrong place
      (c) => { c.quiz[1] = { id: 'q2', kind: 'position', unit: 'hamza', word: 'كِتَابْ', answer: 'end', review: null }; }, // letter absent
      (c) => { c.quiz[1]!.unit = 'nope'; },
      (c) => { c.quiz[1]!.id = 'q1'; },
      (c) => { c.units[1]!.id = 'alif'; },
      (c) => { c.units[0]!.letters = []; },
      (c) => { (c as { finalMark: string }).finalMark = 'tanween'; },
      (c) => { c.lesson = 2; },
      (c) => { (c as { units: unknown }).units = undefined; },
    ];
    for (const change of bad) {
      const c = standIn();
      change(c);
      expect(resolveArabicLesson(c, 1)).toBeNull();
    }
  });
});
