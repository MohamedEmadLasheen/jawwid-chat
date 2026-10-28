import type { ArabicLesson } from '../arabic/arabic-lesson';

/** A stand-in lesson (test words only, not lesson content). */
export function standIn(): ArabicLesson {
  return {
    lesson: 1,
    review: { status: 'approved', by: 'test', note: '' },
    provenance: {},
    finalMark: 'sukun',
    units: [
      {
        id: 'alif',
        letters: ['ا'],
        name: 'أَلِفْ',
        forms: ['ا', 'ـا'],
        note: { text: 'مُلَاحَظَةْ', review: null },
        words: [
          { text: 'كِتَابْ', was: null, review: null },
          { text: 'عَصَا', was: null, review: null },
          { text: 'بَابْ', was: 'بَاب', review: 'ADDED TASHKEEL: final sukun' },
        ],
      },
      {
        id: 'hamza',
        letters: ['ء', 'أ', 'إ', 'ؤ', 'ئ'],
        name: 'هَمْزَةْ',
        forms: ['ء', 'أ', 'إ', 'ؤ', 'ئ'],
        note: null,
        words: [
          { text: 'أَسَدْ', was: null, review: null },
          { text: 'رَأْسْ', was: null, review: null },
          { text: 'جُزْءْ', was: null, review: null },
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
