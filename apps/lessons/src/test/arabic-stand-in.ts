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
        note: { id: 'alif-note', text: 'مُلَاحَظَةْ', review: null },
        words: [
          { id: 'alif-w1', text: 'كِتَابْ', was: null, review: null },
          { id: 'alif-w2', text: 'عَصَا', was: null, review: null },
          { id: 'alif-w3', text: 'بَابْ', was: 'بَاب', review: 'ADDED TASHKEEL: final sukun' },
        ],
      },
      {
        id: 'hamza',
        letters: ['ء', 'أ', 'إ', 'ؤ', 'ئ'],
        name: 'هَمْزَةْ',
        forms: ['ء', 'أ', 'إ', 'ؤ', 'ئ'],
        note: null,
        words: [
          { id: 'hamza-w1', text: 'أَسَدْ', was: null, review: null },
          { id: 'hamza-w2', text: 'رَأْسْ', was: null, review: null },
          { id: 'hamza-w3', text: 'جُزْءْ', was: null, review: null },
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
