import { describe, expect, it } from 'vitest';
import { readingStandIn } from '../test/reading-stand-in';
import { allCarry, bare, resolveReadingLesson, wordsOf, type ReadingLesson } from './reading';

describe('reading lessons (P0-5c)', () => {
  it('splits a sentence on single spaces, with one optional closing mark', () => {
    expect(wordsOf('نَامَتِ الْقِطَّةُ الصَّغِيرَةْ.')).toEqual(['نَامَتِ', 'الْقِطَّةُ', 'الصَّغِيرَةْ']);
    expect(wordsOf('نَامَتِ  الْقِطَّةُ')).toBeNull(); // a double space
    expect(wordsOf('نَامَتِ الْقِطَّةُ..')).toBeNull();
  });

  it('bare letters: a tanween fath\'s alif is no letter of its own, written before or on the fathatan', () => {
    expect(bare('كِتَابًا')).toBe(bare('كِتَابْ'));
    expect(bare('كِتَاباً')).toBe(bare('كِتَابْ'));
    expect(bare('هُدًى')).toBe(bare('هُدْ'));
    expect(bare('كِتَابَا')).not.toBe(bare('كِتَابْ')); // a plain alif after a fatha is a letter
  });

  it('a stage vowel is on every letter', () => {
    expect(allCarry('كَتَبَ', 'fatha')).toBe(true);
    expect(allCarry('كَتَبْ', 'fatha')).toBe(false); // the pausal sukun is not a fatha
    expect(allCarry('كِتِبِ', 'fatha')).toBe(false);
  });

  it('resolves, and refuses whole on any broken proof', () => {
    const r = resolveReadingLesson(readingStandIn(), 5)!;
    expect(r).not.toBeNull();
    expect(r.stages.map((s) => s.items.length)).toEqual([2, 1, 2]);
    expect(r.passages).toEqual([{ id: 'passage-001', title: 'الْقِطَّةُ', sentences: ['نَامَتِ الْقِطَّةُ الصَّغِيرَةْ.'] }]);
    expect(r.quiz.map((q) => q.id)).toEqual(['q1', 'q2']);
    expect(r.quiz[1]!.prompt).toBe('… الْوَلَدُ تُفَّاحًا');
    const bad: ((c: ReadingLesson) => void)[] = [
      (c) => { c.stages[0]!.items[0]!.text = 'بَتِ'; }, // breaks the stage's vowel
      (c) => { c.stages[2]!.items[0]!.text = 'أَكَلَ  الْوَلَدُ'; }, // a double space
      (c) => { c.stages[2]!.items[0]!.kind = 'word'; }, // a sentence is not one word
      (c) => { c.quiz[0] = { ...c.quiz[0]!, options: ['بَتَ', 'كَتَبَ'] } as never; }, // two right answers
      (c) => { c.quiz[1] = { ...c.quiz[1]!, options: ['أَكَلَ', 'أَكَلَ'] } as never; }, // not distinct
      (c) => { c.quiz[1] = { ...c.quiz[1]!, answer: 1 } as never; }, // the wrong answer
      (c) => { c.passages![0]!.sentences = ['fatha-001']; }, // a passage holds sentences only
      (c) => { c.stages[0]!.items[0]!.id = 'kasra-009'; }, // an id outside its stage
      (c) => { c.stages[0]!.items[0]!.was = 'بتَ'; }, // changed but not held
      (c) => { c.quiz[1] = { ...c.quiz[1]!, options: ['أَكَلَ', 'الْبَيْتُ'] } as never; }, // a wrong option from no other sentence
      (c) => { c.quiz[1] = { ...c.quiz[1]!, options: ['أَكَلَ', 'الْوَلَدُ'] } as never; }, // a wrong option from its own sentence
      // The real #292 regression: the SUBJECT blanked, and another sentence's subject offered -- it fits too.
      (c) => { c.quiz[1] = { ...c.quiz[1]!, blank: 1, options: ['الْوَلَدُ', 'الْقِطَّةُ'], answer: 0 } as never; },
      // A word of the blank's own sentence, even one that also occurs elsewhere.
      (c) => { c.stages[2]!.items[1]!.text = 'نَامَتِ الْقِطَّةُ الْوَلَدُ الصَّغِيرَةْ.'; c.quiz[1] = { ...c.quiz[1]!, options: ['أَكَلَ', 'الْوَلَدُ'] } as never; },
      (c) => { c.quiz[1] = { ...c.quiz[1]!, options: ['أَكَلَ', 'الصَّغِيرَةْ'] } as never; }, // another sentence's last word: a pausal form
      (c) => { c.stages[1]!.items.push({ id: 'kasra-002', kind: 'word', text: 'كِتِبِ', was: null, review: null }); c.quiz[0] = { ...c.quiz[0]!, options: ['كِتِبِ', 'بَتَ'] } as never; }, // mixed kinds
      // Another name where the blank is a name, compared by letters (أَكَلْ is أَكَلَ's letters).
      // (names given in another form than the options: أَكَلْ / أَكَلَ, الْقِطَّةُ / الْقِطَّةْ)
      (c) => { c.names = ['أَكَلْ', 'الْقِطَّةُ']; c.stages[2]!.items[1]!.text = 'نَامَتِ الْقِطَّةْ أَيْضًا الصَّغِيرَةْ.'; c.quiz[1] = { ...c.quiz[1]!, options: ['أَكَلَ', 'الْقِطَّةْ'] } as never; },
      // Only the verb (word 0) may be blanked: «أَكَلَ ___ تُفَّاحًا» could take a noun from anywhere.
      (c) => { c.quiz[1] = { ...c.quiz[1]!, blank: 1, options: ['الْوَلَدُ', 'الصَّغِيرَةْ'], answer: 0 } as never; },
      // The answer in another form: أَكَلَ / أَكَلْ (bare letters; the tanween alif case is tested above).
      (c) => { c.stages[2]!.items[1]!.text = 'نَامَتِ أَكَلْ الْقِطَّةُ.'; c.quiz[1] = { ...c.quiz[1]!, options: ['أَكَلَ', 'أَكَلْ'] } as never; },
    ];
    for (const change of bad) {
      const c = readingStandIn();
      change(c);
      expect(resolveReadingLesson(c, 5)).toBeNull();
    }
  });

  it('holds a flagged item everywhere: its question and its passage too', () => {
    const c = readingStandIn();
    c.stages[2]!.items[1]!.review = 'a teacher checks it';
    const r = resolveReadingLesson(c, 5)!;
    expect(r.stages[2]!.items.map((it) => it.id)).toEqual(['sentences-001']);
    expect(r.passages).toEqual([]);
    c.stages[2]!.items[0]!.review = 'held';
    expect(resolveReadingLesson(c, 5)!.quiz.map((q) => q.id)).toEqual(['q1']);
    // A wrong option whose only sentence is held holds the question too.
    const d = readingStandIn();
    d.stages[2]!.items[1]!.review = 'held';
    expect(resolveReadingLesson(d, 5)!.quiz.map((q) => q.id)).toEqual(['q1']);
  });
});
