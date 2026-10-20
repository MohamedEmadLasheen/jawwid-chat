/**
 * Trial journey: what a trial group reads when an outcome is recorded. One
 * short sentence and which trial it is -- never a reason, a price or a contact.
 */
import { renderTrialCardBody, resultSentence } from '../../../src/lessons/trial-cards';

const trial = { trialId: 't1', prospectName: 'prospect_u', when: 'Monday 20 October, 17:00' };

describe('trial outcome cards', () => {
  it.each([
    ['subscribed', 'en', '🎉 The student has subscribed.'],
    ['not_subscribed', 'en', 'ℹ️ The student did not subscribe.'],
    ['no_show', 'en', '⚠️ The student did not attend the trial lesson.'],
    ['subscribed', 'ar', '🎉 اشترك الطالب.'],
    ['not_subscribed', 'ar', 'ℹ️ لم يشترك الطالب.'],
    ['no_show', 'ar', '⚠️ لم يحضر الطالب الحصة التجريبية.'],
  ] as const)('%s in %s', (result, lang, sentence) => {
    expect(resultSentence(result, lang)).toBe(sentence);
  });

  it('a decision names the trial and nothing else', () => {
    const body = renderTrialCardBody('trial_decision', { ...trial, result: 'not_subscribed', reason: 'price', note: 'budget' }, 'en');
    expect(body).toBe('ℹ️ The student did not subscribe.\nprospect_u · Monday 20 October, 17:00');
  });

  it('a correction says it is one, with the new result only', () => {
    expect(renderTrialCardBody('trial_correction', { ...trial, result: 'subscribed' }, 'en'))
      .toBe('✏️ Outcome corrected: 🎉 The student has subscribed.\nprospect_u · Monday 20 October, 17:00');
  });

  it('a supervisor\'s no-show has no note; the teacher\'s may', () => {
    expect(renderTrialCardBody('trial_no_show', { ...trial, result: 'no_show' }, 'en'))
      .toBe('⚠️ The student did not attend the trial lesson.\nprospect_u · Monday 20 October, 17:00');
    expect(renderTrialCardBody('trial_no_show', { ...trial, note: 'no answer' }, 'en')).toContain('Note: no answer');
  });
});
