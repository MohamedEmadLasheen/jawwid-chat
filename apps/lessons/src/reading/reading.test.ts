import { describe, expect, it } from 'vitest';
import { readingStandIn } from '../test/reading-stand-in';
import { allCarry, resolveReadingLesson, wordsOf, type ReadingLesson } from './reading';

describe('reading lessons (P0-5c)', () => {
  it('splits a sentence on single spaces, with one optional closing mark', () => {
    expect(wordsOf('نَامَتِ الْقِطَّةُ الصَّغِيرَةْ.')).toEqual(['نَامَتِ', 'الْقِطَّةُ', 'الصَّغِيرَةْ']);
    expect(wordsOf('نَامَتِ  الْقِطَّةُ')).toBeNull(); // a double space
    expect(wordsOf('نَامَتِ الْقِطَّةُ..')).toBeNull();
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
    expect(r.quiz[1]!.prompt).toBe('أَكَلَ … تُفَّاحًا');
    const bad: ((c: ReadingLesson) => void)[] = [
      (c) => { c.stages[0]!.items[0]!.text = 'بَتِ'; }, // breaks the stage's vowel
      (c) => { c.stages[2]!.items[0]!.text = 'أَكَلَ  الْوَلَدُ'; }, // a double space
      (c) => { c.stages[2]!.items[0]!.kind = 'word'; }, // a sentence is not one word
      (c) => { c.quiz[0] = { ...c.quiz[0]!, options: ['بَتَ', 'كَتَبَ'] } as never; }, // two right answers
      (c) => { c.quiz[1] = { ...c.quiz[1]!, options: ['الْوَلَدُ', 'الْوَلَدُ'] } as never; }, // not distinct
      (c) => { c.quiz[1] = { ...c.quiz[1]!, answer: 1 } as never; }, // the wrong answer
      (c) => { c.passages![0]!.sentences = ['fatha-001']; }, // a passage holds sentences only
      (c) => { c.stages[0]!.items[0]!.id = 'kasra-009'; }, // an id outside its stage
      (c) => { c.stages[0]!.items[0]!.was = 'بتَ'; }, // changed but not held
      (c) => { c.quiz[1] = { ...c.quiz[1]!, options: ['الْوَلَدُ', 'الْبَيْتُ'] } as never; }, // a wrong option from no other sentence
      (c) => { c.quiz[1] = { ...c.quiz[1]!, options: ['الْوَلَدُ', 'أَكَلَ'] } as never; }, // a wrong option from its own sentence
      (c) => { c.stages[1]!.items.push({ id: 'kasra-002', kind: 'word', text: 'كِتِبِ', was: null, review: null }); c.quiz[0] = { ...c.quiz[0]!, options: ['كِتِبِ', 'بَتَ'] } as never; }, // mixed kinds
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
