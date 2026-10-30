import type { TopicLesson } from '../topic/topic';

/** An approved copy with every held line that is not a hadith settled (as a teacher would). */
export function settled(c: TopicLesson): TopicLesson {
  const x = structuredClone(c);
  x.review = { status: 'approved', by: 'Teachers department', note: 'test' };
  x.title.review = null;
  for (const s of x.sections) {
    s.title.review = null;
    for (const b of s.blocks) if (b.kind !== 'hadith') b.review = null;
  }
  // A quiz question that quotes a hadith goes with the hadith: left out until a source is approved.
  x.quiz = x.quiz.filter((q) => !q.review?.startsWith('HADITH')).map((q) => ({ ...q, review: null }));
  return x;
}
