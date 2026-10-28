import { describe, expect, it } from 'vitest';
import { resolveArabicLesson, type ArabicLesson } from './arabic-lesson';
import { harakatStandIn, standIn } from '../test/arabic-stand-in';

describe('an Arabic letters lesson: words, positions and a quiz proved by the one rule', () => {
  it('resolves, computes each word\'s positions, and holds back flagged words and the questions that show them', () => {
    const r = resolveArabicLesson(standIn(), 1)!;
    expect(r.approved).toBe(true);
    const alif = r.units[0]!;
    expect(alif.words).toEqual([
      { id: 'alif-001', text: 'كِتَابْ', positions: ['middle'] },
      { id: 'alif-002', text: 'عَصَا', positions: ['end'] },
    ]);
    expect(alif.note).toEqual({ id: 'alif.note', text: 'مُلَاحَظَةْ' });
    // أَسَدْ is a hamza word: it starts with أ, which is not alif.
    expect(r.units[1]!.words.map((w) => w.positions)).toEqual([['start'], ['middle'], ['end']]);
    // q3 shows the flagged بَابْ, q4 is flagged itself: both held; the flagged word is held too.
    expect(r.quiz.map((q) => q.id)).toEqual(['q1', 'q2']);
    expect(r.quiz[1]).toMatchObject({ word: 'جُزْءْ', answer: 2 });
    expect(r.held).toBe(3);
  });

  it('holds a spelling flagged anywhere everywhere it appears', () => {
    const c = standIn();
    c.units[0]!.words.push({ id: 'alif-005', text: 'سَمَاءْ', was: 'سَمَاء', review: 'ADDED TASHKEEL: final sukun' });
    c.units[1]!.words.push({ id: 'hamza-004', text: 'سَمَاءْ', was: null, review: null });
    const r = resolveArabicLesson(c, 1)!;
    expect(r.units.flatMap((u) => u.words.map((w) => w.text))).not.toContain('سَمَاءْ');
    expect(r.held).toBe(5);
  });

  it('shows a word with a final-mark exception only once the file is approved', () => {
    const c = standIn();
    c.units[1]!.words[0]!.finalMarkException = 'kept as it is said';
    expect(resolveArabicLesson(c, 1)!.units[1]!.words[0]!.text).toBe('أَسَدْ'); // approved: a teacher signed it off
    c.review.status = 'pending';
    expect(resolveArabicLesson(c, 1)).toBeNull(); // pending: it must still be held
    c.units[1]!.words[0]!.review = 'FINAL MARK EXCEPTION: kept as it is said';
    expect(resolveArabicLesson(c, 1)).not.toBeNull();
  });

  it('shows nothing of a pending file (the page gates on `approved`)', () => {
    const c = standIn();
    c.review.status = 'pending';
    expect(resolveArabicLesson(c, 1)!.approved).toBe(false);
  });

  it('refuses the whole file when any proof fails', () => {
    const bad: ((c: ArabicLesson) => void)[] = [
      (c) => { c.units[0]!.words.push({ id: 'alif-009', text: 'أَسَدْ', was: null, review: null }); }, // an أ word filed as alif
      (c) => { c.units[0]!.words[1]!.id = 'alif-001'; }, // a reused id
      (c) => { c.units[0]!.words[1]!.id = 'alif-004'; }, // a retired id is never used again
      (c) => { c.units[0]!.words[1]!.id = 'hamza-005'; }, // the prefix is its own unit
      (c) => { c.units[1]!.words[0]!.id = 'hamza-1'; }, // <unit>-NNN
      (c) => { delete (c.units[1]!.words[0] as { id?: string }).id; }, // every word has one
      (c) => { c.retiredIds.push('Alif 4'); },
      (c) => { c.units[0]!.note = { text: 42, review: null } as never; }, // a malformed note never reaches React
      (c) => { c.units[0]!.words[0]!.review = '' as never; },
      (c) => { c.review.status = 'pending'; c.units[1]!.words[0]!.finalMarkException = 'kept as said'; }, // an exception is held while pending
      (c) => { c.quiz[0] = { ...c.quiz[0]!, answer: true } as never; }, // a boolean is not an index
      (c) => { (c.units[0] as { id: string }).id = 'lam-alif'; }, // unit ids are slugs without hyphens
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

  it('lesson 3 (the harakat): a marked unit holds the words where its letter CARRIES the mark', () => {
    const r = resolveArabicLesson(harakatStandIn(), 3)!;
    expect(r).not.toBeNull();
    const fatha = r.units[0]!;
    expect(fatha.group).toBe('ب');
    expect(fatha.words.map((w) => [w.text, w.positions])).toEqual([['بَابْ', ['start']], ['كَتَبَ', ['end']]]);
    expect(r.quiz.map((q) => q.id)).toEqual(['q1', 'q2']);
    const bad: ((c: ArabicLesson) => void)[] = [
      (c) => { c.units[0]!.words.push({ id: 'ba_fatha-003', text: 'بِنْتْ', was: null, review: null }); }, // ب, but with a kasra
      (c) => { c.units[0]!.name = 'بِ'; }, // the name is not its own syllable
      (c) => { (c.units[0] as { mark: string }).mark = 'sukun'; },
      (c) => { c.units[0]!.letters = ['لا']; }, // a marked unit is one letter
      (c) => { c.quiz[0] = { ...c.quiz[0]!, options: ['بَابْ', 'كَتَبَ'] } as never; }, // both carry بَ: two right answers
      (c) => { c.units[0]!.group = ''; },
    ];
    for (const change of bad) {
      const c = harakatStandIn();
      change(c);
      expect(resolveArabicLesson(c, 3)).toBeNull();
    }
  });
});
