import type { TopicLesson } from '../topic/topic';

/** A topic lesson (Islamic Studies) in every kind: prose, a Quran reference, a held hadith, both quiz kinds. */
export function topicStandIn(): TopicLesson {
  return {
    lesson: 8,
    kind: 'topic',
    fiqh: false,
    title: { text: 'نبينا محمد', review: null },
    review: { status: 'approved', by: 'test', note: '' },
    provenance: {},
    retiredIds: [],
    sections: [
      {
        id: 'intro',
        title: { text: 'من هو نبينا؟', review: null },
        blocks: [
          { id: 'intro-001', kind: 'text', text: 'نبينا محمد نحبه ونطيعه.', review: null },
          { id: 'intro-002', kind: 'quran', surah: 85, from: 1, to: 2, review: null },
          { id: 'intro-003', kind: 'hadith', source: 'a collection, number 1', text: 'نص حديث', review: 'HADITH: held until a verified source is approved' },
        ],
      },
    ],
    quiz: [
      { id: 'q1', kind: 'choose', question: 'أين ولد النبي؟', options: ['مكة', 'المدينة'], answer: 0, review: null },
      { id: 'q2', kind: 'truefalse', statement: 'نحب نبينا', answer: true, review: null },
    ],
  };
}
