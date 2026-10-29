import type { ArabicLesson } from '../arabic/arabic-lesson';

/** A stand-in lesson (test words only, not lesson content). */
export function standIn(): ArabicLesson {
  return {
    lesson: 1,
    review: { status: 'approved', by: 'test', note: '' },
    provenance: {},
    finalMark: 'sukun',
    retiredIds: ['alif-004'],
    units: [
      {
        id: 'alif',
        letters: ['ا'],
        name: 'أَلِفْ',
        forms: ['ا', 'ـا'],
        note: { text: 'مُلَاحَظَةْ', review: null },
        words: [
          { id: 'alif-001', text: 'كِتَابْ', was: null, review: null },
          { id: 'alif-002', text: 'عَصَا', was: null, review: null },
          { id: 'alif-003', text: 'بَابْ', was: 'بَاب', review: 'ADDED TASHKEEL: final sukun' },
        ],
      },
      {
        id: 'hamza',
        letters: ['ء', 'أ', 'إ', 'ؤ', 'ئ'],
        name: 'هَمْزَةْ',
        forms: ['ء', 'أ', 'إ', 'ؤ', 'ئ'],
        note: null,
        words: [
          { id: 'hamza-001', text: 'أَسَدْ', was: null, review: null },
          { id: 'hamza-002', text: 'رَأْسْ', was: null, review: null },
          { id: 'hamza-003', text: 'جُزْءْ', was: null, review: null },
        ],
      },
    ],
    quiz: [
      { id: 'q1', kind: 'contains', unit: 'alif', options: ['أَسَدْ', 'كِتَابْ', 'جُزْءْ'], answer: 1, review: null },
      { id: 'q2', kind: 'position', unit: 'hamza', word: 'جُزْءْ', answer: 'end', review: null },
      { id: 'q3', kind: 'contains', unit: 'alif', options: ['بَابْ', 'أَسَدْ'], answer: 0, review: null },
      { id: 'q4', kind: 'position', unit: 'alif', word: 'عَصَا', answer: 'end', review: 'unsure' },
    ],
  };
}

/** A stand-in harakat lesson (lesson 3's shape): one letter, two of its harakat. */
export function harakatStandIn(): ArabicLesson {
  return {
    lesson: 3,
    review: { status: 'approved', by: 'test', note: '' },
    provenance: {},
    finalMark: 'sukun',
    retiredIds: [],
    units: [
      {
        id: 'ba_fatha',
        letters: ['ب'],
        mark: 'fatha',
        group: 'ب',
        name: 'بَ',
        forms: ['بَ'],
        note: null,
        words: [
          { id: 'ba_fatha-001', text: 'بَابْ', was: null, review: null },
          // The lesson's own vowel on the last letter: a final-mark exception.
          { id: 'ba_fatha-002', text: 'كَتَبَ', was: null, review: null, finalMarkException: 'the lesson\'s vowel on the last letter' },
        ],
      },
      {
        id: 'ba_kasra',
        letters: ['ب'],
        mark: 'kasra',
        group: 'ب',
        name: 'بِ',
        forms: ['بِ'],
        note: null,
        words: [{ id: 'ba_kasra-001', text: 'بِنْتْ', was: null, review: null }],
      },
    ],
    quiz: [
      { id: 'q1', kind: 'contains', unit: 'ba_fatha', options: ['بَابْ', 'بِنْتْ'], answer: 0, review: null },
      { id: 'q2', kind: 'position', unit: 'ba_kasra', word: 'بِنْتْ', answer: 'start', review: null },
    ],
  };
}

/** Lessons 6 and 7 (the sukun, the madd): a sukun unit and a madd unit. */
export function sukunMaddStandIn(): ArabicLesson {
  return {
    lesson: 6,
    review: { status: 'approved', by: 'test', note: '' },
    provenance: {},
    finalMark: 'sukun',
    retiredIds: [],
    units: [
      {
        id: 'jim_sukun',
        letters: ['ج'],
        mark: 'sukun',
        group: 'ج',
        name: 'جْ',
        forms: ['جْ'],
        note: null,
        words: [{ id: 'jim_sukun-001', text: 'نَجْمْ', was: null, review: null }],
      },
      {
        id: 'madd_alif',
        letters: ['ا'],
        madd: 'alif',
        name: 'أَلِفْ',
        forms: ['ـَا'],
        note: null,
        words: [{ id: 'madd_alif-001', text: 'بَابْ', was: null, review: null }],
      },
    ],
    quiz: [
      { id: 'q1', kind: 'contains', unit: 'jim_sukun', options: ['نَجْمْ', 'بَابْ'], answer: 0, review: null },
      { id: 'q2', kind: 'contains', unit: 'madd_alif', options: ['نَجْمْ', 'بَابْ'], answer: 1, review: null },
    ],
  };
}
