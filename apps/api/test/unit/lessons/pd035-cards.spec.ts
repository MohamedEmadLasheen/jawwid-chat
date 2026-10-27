/**
 * PD-35: the plain-text bodies of the cards a teacher receives -- what a client
 * that does not draw the card still shows, in the teacher's language.
 */
import { renderCorrectionCard } from '../../../src/lessons/report-correction.service';
import { renderEvaluationCard, renderPlanCard } from '../../../src/teacher-file/teacher-evaluation.service';

describe('PD-35 card bodies', () => {
  it('a correction request says what to do, for which lesson, and why', () => {
    const p = { learnerName: 'Child A', startsAt: '2026-10-20T15:00:00Z', kind: 'correction', reason: 'Wrong surah range' };
    expect(renderCorrectionCard(p, 'en')).toBe(
      '📝 Lesson report correction needed — Child A\nLesson: 2026-10-20\nReason: Wrong surah range\nOpen the lesson and edit its report.',
    );
    expect(renderCorrectionCard({ ...p, kind: 'missing' }, 'ar')).toContain('مطلوب تقرير الحصة');
  });

  it('an evaluation lists each score and the recommendations, never the internal notes', () => {
    const body = renderEvaluationCard(
      { periodFrom: '2026-10-01', periodTo: '2026-10-26', scores: [{ criterion: 'Punctuality', score: 4 }], recommendations: 'Keep it up' },
      'en',
    );
    expect(body).toBe('📋 Your evaluation — 2026-10-01 → 2026-10-26\n• Punctuality: 4/5\nRecommendations: Keep it up');
  });

  it('a plan numbers its goals with their due dates', () => {
    expect(renderPlanCard({ title: 'Reports', goals: [{ body: 'Same day', dueOn: '2026-11-30' }, { body: 'Quick report', dueOn: null }] }, 'en'))
      .toBe('🎯 Improvement plan — Reports\n1. Same day (by 2026-11-30)\n2. Quick report');
  });
});
