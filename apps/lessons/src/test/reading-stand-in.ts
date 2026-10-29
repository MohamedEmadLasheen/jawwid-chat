import type { ReadingLesson } from '../reading/reading';

/** A reading lesson (P0-5c) in every kind: drills and a word in two vowel stages, sentences, a passage, both quiz kinds. */
export function readingStandIn(): ReadingLesson {
  return {
    lesson: 5,
    kind: 'reading',
    review: { status: 'approved', by: 'test', note: '' },
    provenance: {},
    retiredIds: [],
    stages: [
      {
        id: 'fatha', name: 'الْفَتْحَةْ', vowel: 'fatha',
        items: [
          { id: 'fatha-001', kind: 'syllables', text: 'بَتَ', was: null, review: null },
          { id: 'fatha-002', kind: 'word', text: 'كَتَبَ', was: null, review: null },
        ],
      },
      { id: 'kasra', name: 'الْكَسْرَةْ', vowel: 'kasra', items: [{ id: 'kasra-001', kind: 'syllables', text: 'بِتِ', was: null, review: null }] },
      {
        id: 'sentences', name: 'جُمَلْ',
        items: [
          { id: 'sentences-001', kind: 'sentence', text: 'أَكَلَ الْوَلَدُ تُفَّاحًا', was: null, review: null },
          { id: 'sentences-002', kind: 'sentence', text: 'نَامَتِ الْقِطَّةُ الصَّغِيرَةْ.', was: null, review: null },
        ],
      },
    ],
    passages: [{ id: 'passage-001', title: { text: 'الْقِطَّةُ', review: null }, sentences: ['sentences-002'] }],
    quiz: [
      { id: 'q1', kind: 'vowel', stage: 'fatha', options: ['بِتِ', 'بَتَ'], answer: 1, review: null },
      { id: 'q2', kind: 'missing', sentence: 'sentences-001', blank: 1, options: ['الْوَلَدُ', 'الْقِطَّةُ'], answer: 0, review: null },
    ],
  };
}
