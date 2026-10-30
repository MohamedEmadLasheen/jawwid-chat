import { describe, expect, it } from 'vitest';
import { topicStandIn } from '../test/topic-stand-in';
import { resolveTopicLesson, type TopicLesson } from './topic';

describe('topic lessons (Islamic Studies)', () => {
  it('resolves: prose and Quran references shown, every hadith held', () => {
    const r = resolveTopicLesson(topicStandIn(), 8)!;
    expect(r).not.toBeNull();
    expect(r.sections[0]!.blocks).toEqual([
      { id: 'intro-001', kind: 'text', text: 'نبينا محمد نحبه ونطيعه.' },
      { id: 'intro-002', kind: 'quran', surah: 85, from: 1, to: 2 },
    ]);
    expect(r.held).toBe(1); // the hadith
    expect(r.quiz.map((q) => [q.id, q.options, q.answer])).toEqual([['q1', ['مكة', 'المدينة'], 0], ['q2', ['صَحِيحٌ', 'خَطَأٌ'], 0]]);
  });

  it('refuses the whole lesson on any broken proof', () => {
    const bad: ((c: TopicLesson) => void)[] = [
      (c) => { c.sections[0]!.blocks[2] = { ...c.sections[0]!.blocks[2]!, review: null } as never; }, // a hadith shown: never
      (c) => { c.sections[0]!.blocks[1] = { ...c.sections[0]!.blocks[1]!, from: 3, to: 2 } as never; }, // a backwards range
      (c) => { c.sections[0]!.blocks[1] = { ...c.sections[0]!.blocks[1]!, surah: 115 } as never; }, // no such surah
      (c) => { c.sections[0]!.blocks[0]!.id = 'other-001'; }, // an id outside its section
      (c) => { (c.sections[0]!.blocks[0] as { kind: string }).kind = 'ayah'; }, // an unknown kind
      (c) => { c.quiz[0] = { ...c.quiz[0]!, answer: 2 } as never; }, // no such option
      (c) => { c.quiz[0] = { ...c.quiz[0]!, options: ['مكة', 'مكة'] } as never; }, // not distinct
      (c) => { c.quiz[1] = { ...c.quiz[1]!, answer: 'yes' } as never; }, // not a boolean
      (c) => { c.sections[0]!.blocks[1] = { ...c.sections[0]!.blocks[1]!, from: 0 } as never; }, // ayah zero
      (c) => { c.sections[0]!.blocks[1] = { ...c.sections[0]!.blocks[1]!, to: 1.5 } as never; }, // not an integer
      (c) => { (c.sections[0]!.blocks[0] as { colour?: string }).colour = 'red'; }, // an unknown key
      (c) => { c.quiz[0] = { ...c.quiz[0]!, id: '' } as never; }, // an empty quiz id
      (c) => { c.sections[0]!.blocks[0]!.review = 'a teacher checks it'; }, // approved while a line is held
      (c) => { c.fiqh = true; }, // a fiqh lesson approved without its scholar
    ];
    for (const change of bad) {
      const c = topicStandIn();
      change(c);
      expect(resolveTopicLesson(c, 8)).toBeNull();
    }
  });

  it('refuses another lesson\'s file; a fiqh lesson approves only with its scholar named', () => {
    expect(resolveTopicLesson(topicStandIn(), 9)).toBeNull();
    const c = topicStandIn();
    c.fiqh = true;
    c.review.scholar = 'a qualified scholar';
    expect(resolveTopicLesson(c, 8)).not.toBeNull();
  });

  it('holds a flagged line, and shows nothing of a pending file', () => {
    const c = topicStandIn();
    c.review.status = 'pending';
    c.sections[0]!.blocks[0]!.review = 'a teacher checks it';
    const r = resolveTopicLesson(c, 8)!;
    expect(r.sections[0]!.blocks.map((b) => b.id)).toEqual(['intro-002']);
    c.review.status = 'pending';
    expect(resolveTopicLesson(c, 8)!.approved).toBe(false);
  });
});
