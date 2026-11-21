/**
 * PD-59: the Sales pipeline's pure rules -- stage derivation, transitions, who
 * may use it, the conversion decision, filters and input validation.
 */
import {
  LeadInputError,
  canConvert,
  checkMarkContacted,
  checkTransition,
  contactFieldNames,
  decideConversion,
  decideLeadAccess,
  deriveStage,
  followUpDue,
  matchesFilter,
  optDay,
  pageOf,
  parseContact,
  planChannelMerge,
  type DerivedStage,
  type TrialFact,
} from '../../../src/sales-pipeline/pipeline-stage';
import { mergeContact } from '../../../src/sales-pipeline/sales-pipeline.service';

const NOW = new Date('2026-06-10T12:00:00Z');
const AHEAD = new Date('2026-06-12T09:00:00Z');
const PAST = new Date('2026-06-08T09:00:00Z');

const trial = (over: Partial<TrialFact> = {}): TrialFact => ({
  startsAt: AHEAD, result: null, reasonCode: null, lessonOutcome: null, ...over,
});
const facts = (over: Partial<Parameters<typeof deriveStage>[0]> = {}) => ({
  pipelineStage: null, lostReason: null, convertedAt: null, trials: [], now: NOW, ...over,
});

describe('deriveStage', () => {
  it('a prospect with no trial and nothing stored is a new lead', () => {
    expect(deriveStage(facts())).toEqual({ stage: 'new_lead', lostReason: null, manual: true });
  });

  it('the stored stages are read as they are when no trial exists', () => {
    expect(deriveStage(facts({ pipelineStage: 'contacted' })).stage).toBe('contacted');
    expect(deriveStage(facts({ pipelineStage: 'lost', lostReason: 'price' }))).toEqual({ stage: 'lost', lostReason: 'price', manual: true });
  });

  it('a trial still ahead is Trial Booked, and no stored stage overrides it', () => {
    expect(deriveStage(facts({ pipelineStage: 'contacted', trials: [trial()] }))).toEqual({ stage: 'trial_booked', lostReason: null, manual: false });
    // booking a trial for a lead marked lost reopens it
    expect(deriveStage(facts({ pipelineStage: 'lost', lostReason: 'price', trials: [trial()] })).stage).toBe('trial_booked');
  });

  it('a trial that has started with no outcome is Trial Completed (the outcome is pending); a held one too', () => {
    expect(deriveStage(facts({ trials: [trial({ startsAt: PAST })] })).stage).toBe('trial_completed');
    expect(deriveStage(facts({ trials: [trial({ startsAt: PAST, lessonOutcome: 'held' })] })).stage).toBe('trial_completed');
  });

  it('a subscribed trial is Converted, even with an earlier lost one and a later booking', () => {
    const subscribed = trial({ startsAt: PAST, result: 'subscribed' });
    expect(deriveStage(facts({ trials: [subscribed] })).stage).toBe('converted');
    expect(deriveStage(facts({ trials: [trial({ startsAt: new Date('2026-05-01T09:00:00Z'), result: 'not_subscribed' }), subscribed, trial()] })).stage).toBe('converted');
  });

  it('a not-subscribed or no-show trial is Lost with its reason', () => {
    expect(deriveStage(facts({ trials: [trial({ startsAt: PAST, result: 'not_subscribed', reasonCode: 'price' })] })))
      .toEqual({ stage: 'lost', lostReason: 'price', manual: false });
    expect(deriveStage(facts({ trials: [trial({ startsAt: PAST, result: 'no_show' })] })).lostReason).toBe('no_show');
    // a student no-show on the lesson itself, before any outcome is recorded
    expect(deriveStage(facts({ trials: [trial({ startsAt: PAST, lessonOutcome: 'student_no_show' })] }))).toEqual({ stage: 'lost', lostReason: 'no_show', manual: false });
  });

  it('the LATEST live trial decides: a rebooked trial after a no-show is Trial Booked again', () => {
    expect(deriveStage(facts({ trials: [trial({ startsAt: PAST, result: 'no_show' }), trial()] })).stage).toBe('trial_booked');
  });

  it('a cancelled or rescheduled trial is not one the lead has', () => {
    for (const lessonOutcome of ['admin_cancelled', 'student_apology', 'teacher_apology', 'rescheduled', 'teacher_no_show']) {
      expect(deriveStage(facts({ pipelineStage: 'contacted', trials: [trial({ lessonOutcome })] })).stage).toBe('contacted');
    }
  });

  it('a hand-over (converted_at) is Converted whatever else is true', () => {
    expect(deriveStage(facts({ convertedAt: NOW, pipelineStage: 'contacted' })).stage).toBe('converted');
  });
});

describe('checkTransition', () => {
  const at = (stage: DerivedStage['stage'], manual = true): DerivedStage => ({ stage, lostReason: null, manual });

  it('new lead -> contacted, new lead -> lost (a reason is required), contacted -> lost', () => {
    expect(checkTransition(at('new_lead'), { to: 'contacted', lostReason: null })).toEqual({ ok: true, next: { pipelineStage: 'contacted', lostReason: null } });
    expect(checkTransition(at('new_lead'), { to: 'lost', lostReason: 'price' })).toEqual({ ok: true, next: { pipelineStage: 'lost', lostReason: 'price' } });
    expect(checkTransition(at('contacted'), { to: 'lost', lostReason: 'no_response' }).ok).toBe(true);
    expect(checkTransition(at('contacted'), { to: 'lost', lostReason: null })).toEqual({ ok: false, code: 'lost_reason_required' });
    expect(checkTransition(at('contacted'), { to: 'lost', lostReason: 'because' })).toEqual({ ok: false, code: 'lost_reason_unknown' });
  });

  it('contacted cannot go back to new lead; a stored lost lead can be reopened, clearing the reason', () => {
    expect(checkTransition(at('contacted'), { to: 'new_lead', lostReason: null })).toEqual({ ok: false, code: 'not_allowed' });
    expect(checkTransition(at('lost'), { to: 'new_lead', lostReason: null })).toEqual({ ok: true, next: { pipelineStage: 'new_lead', lostReason: null } });
    expect(checkTransition(at('lost'), { to: 'contacted', lostReason: 'price' })).toEqual({ ok: true, next: { pipelineStage: 'contacted', lostReason: null } });
  });

  it('a stage a trial or the hand-over decides is never moved by hand', () => {
    for (const stage of ['trial_booked', 'trial_completed', 'converted', 'lost'] as const) {
      expect(checkTransition(at(stage, false), { to: 'contacted', lostReason: null })).toEqual({ ok: false, code: 'stage_derived' });
      expect(checkTransition(at(stage, false), { to: 'lost', lostReason: 'price' })).toEqual({ ok: false, code: 'stage_derived' });
    }
  });

  it('mark contacted follows the same rules', () => {
    expect(checkMarkContacted(at('new_lead')).ok).toBe(true);
    expect(checkMarkContacted(at('contacted')).ok).toBe(true);
    expect(checkMarkContacted(at('lost')).ok).toBe(true);
    expect(checkMarkContacted(at('trial_booked', false))).toEqual({ ok: false, code: 'stage_derived' });
  });
});

describe('decideLeadAccess: who may use the pipeline and read a lead\'s contact', () => {
  const live = { isStaff: true, isActive: true, left: false };

  it('the super admin and the Sales department only', () => {
    expect(decideLeadAccess({ ...live, role: 'super_admin', salesRole: null })).toBe('super_admin');
    expect(decideLeadAccess({ ...live, role: 'admin', salesRole: 'manager' })).toBe('sales_manager');
    expect(decideLeadAccess({ ...live, role: 'admin', salesRole: 'member' })).toBe('sales_member');
  });

  it('not teachers, parents, other departments, their managers, nor a role alone', () => {
    expect(decideLeadAccess({ isStaff: false, isActive: true, left: false, role: null, salesRole: null })).toBeNull();
    for (const role of ['admin', 'coverage', 'manager', 'finance', 'technical', 'academic', 'specialist']) {
      expect({ role, standing: decideLeadAccess({ ...live, role, salesRole: null }) }).toEqual({ role, standing: null });
    }
  });

  it('not an inactive or departed account, even a Sales member or the super admin', () => {
    expect(decideLeadAccess({ isStaff: true, isActive: false, left: false, role: 'super_admin', salesRole: null })).toBeNull();
    expect(decideLeadAccess({ isStaff: true, isActive: true, left: true, role: 'admin', salesRole: 'member' })).toBeNull();
  });
});

describe('decideConversion: link into the existing parent, never a second one', () => {
  it('a family that already holds the parent is linked, when the caller may handle it', () => {
    expect(decideConversion({ hasContact: true, matchedFamilyId: 'fam-1', callerMayHandle: true })).toEqual({ kind: 'link', familyId: 'fam-1' });
  });
  it('a family that is not the caller\'s is unavailable (it says nothing more)', () => {
    expect(decideConversion({ hasContact: true, matchedFamilyId: 'fam-1', callerMayHandle: false })).toEqual({ kind: 'unavailable' });
  });
  it('no family: the existing family intake is the hand-over (nothing is created here)', () => {
    expect(decideConversion({ hasContact: true, matchedFamilyId: null, callerMayHandle: true })).toEqual({ kind: 'intake_required' });
  });
  it('a lead without contact cannot be matched, so it is not handed over blind', () => {
    expect(decideConversion({ hasContact: false, matchedFamilyId: null, callerMayHandle: true })).toEqual({ kind: 'no_contact' });
  });
  it('a lead in the funnel converts; so does one a subscribed trial made Converted whose hand-over is not recorded; never twice', () => {
    expect(['new_lead', 'contacted', 'trial_booked', 'trial_completed'].every((s) => canConvert(s as never))).toBe(true);
    expect(canConvert('converted')).toBe(true); // converted by a trial, converted_at still null
    expect(canConvert('converted', false)).toBe(true);
    expect(canConvert('converted', true)).toBe(false); // already handed over
    expect(canConvert('lost')).toBe(false);
  });
  it('a subscribed trial links the family Operations enrolled, whoever owns it; with none yet it waits for the enrolment', () => {
    expect(decideConversion({ hasContact: true, matchedFamilyId: null, callerMayHandle: false, subscribedTrial: true, enrolledFamilyId: 'fam-7' }))
      .toEqual({ kind: 'link', familyId: 'fam-7' });
    expect(decideConversion({ hasContact: true, matchedFamilyId: null, callerMayHandle: false, subscribedTrial: true, enrolledFamilyId: null }))
      .toEqual({ kind: 'awaiting_enrolment' });
    expect(decideConversion({ hasContact: false, matchedFamilyId: null, callerMayHandle: true, subscribedTrial: true, enrolledFamilyId: 'fam-7' }))
      .toEqual({ kind: 'no_contact' });
  });
});

describe('follow-up and filters', () => {
  it('a follow-up is due on its day and after, never for a lead past the funnel', () => {
    expect(followUpDue({ stage: 'contacted', nextFollowUpOn: '2026-06-10' }, '2026-06-10')).toBe(true);
    expect(followUpDue({ stage: 'contacted', nextFollowUpOn: '2026-06-09' }, '2026-06-10')).toBe(true);
    expect(followUpDue({ stage: 'contacted', nextFollowUpOn: '2026-06-11' }, '2026-06-10')).toBe(false);
    expect(followUpDue({ stage: 'contacted', nextFollowUpOn: null }, '2026-06-10')).toBe(false);
    expect(followUpDue({ stage: 'converted', nextFollowUpOn: '2026-06-01' }, '2026-06-10')).toBe(false);
    expect(followUpDue({ stage: 'lost', nextFollowUpOn: '2026-06-01' }, '2026-06-10')).toBe(false);
  });

  it('filters by stage, by name (case-insensitive) and by due follow-up', () => {
    const row = { displayName: 'Layla Hassan', stage: 'contacted' as const, nextFollowUpOn: '2026-06-01' };
    const none = { stage: null, q: null, followUp: null } as const;
    expect(matchesFilter(row, none, '2026-06-10')).toBe(true);
    expect(matchesFilter(row, { ...none, stage: 'contacted' }, '2026-06-10')).toBe(true);
    expect(matchesFilter(row, { ...none, stage: 'new_lead' }, '2026-06-10')).toBe(false);
    expect(matchesFilter(row, { ...none, q: 'layla' }, '2026-06-10')).toBe(true);
    expect(matchesFilter(row, { ...none, q: 'omar' }, '2026-06-10')).toBe(false);
    expect(matchesFilter(row, { ...none, followUp: 'due' }, '2026-06-10')).toBe(true);
    expect(matchesFilter({ ...row, nextFollowUpOn: '2026-07-01' }, { ...none, followUp: 'due' }, '2026-06-10')).toBe(false);
  });
});

describe('input', () => {
  it('a contact is validated and normalised; messages name the field, never the value', () => {
    expect(parseContact({ parentName: ' Sara ', phone: '+20 100 123 4567', whatsapp: null, email: 'Sara@Example.COM', country: 'eg' }))
      .toEqual({ parentName: 'Sara', phone: '+20 100 123 4567', whatsapp: null, email: 'sara@example.com', country: 'EG' });
    let message = '';
    try { parseContact({ parentName: 'Sara', email: 'secret-value-not-an-email' }); } catch (e) { message = (e as LeadInputError).message; }
    expect(message).toBe('contact.email: an e-mail address');
    expect(message).not.toContain('secret-value');
    expect(() => parseContact({ phone: 'abc' })).toThrow('contact.phone: a phone number');
    expect(() => parseContact('x')).toThrow(LeadInputError);
  });

  it('audit lines can name the fields a patch touched without their values', () => {
    expect(contactFieldNames({ phone: '+201001234567', email: null })).toEqual(['phone', 'email']);
  });

  it('a patch keeps the fields it leaves out, clears with null, and always leaves a name and a channel', () => {
    const existing = { parentName: 'Sara', phone: '+201001234567', whatsapp: null, email: null, country: null };
    expect(mergeContact(existing, { email: 'a@b.co' })).toMatchObject({ parentName: 'Sara', phone: '+201001234567', email: 'a@b.co' });
    expect(() => mergeContact(existing, { phone: null })).toThrow(/a phone number, a WhatsApp number or an e-mail/);
    expect(() => mergeContact(null, { phone: '+201001234567' })).toThrow('contact.parentName: required');
    expect(mergeContact(null, { parentName: 'Sara', whatsapp: '+201001234567' }).whatsapp).toBe('+201001234567');
  });

  it('dates must exist; pages are bounded', () => {
    expect(optDay('2026-02-28', 'd')).toBe('2026-02-28');
    expect(() => optDay('2026-02-30', 'd')).toThrow('d: a date that exists');
    expect(optDay(null, 'd')).toBeNull();
    expect(optDay(undefined, 'd')).toBeUndefined();
    expect(pageOf(undefined, undefined)).toEqual({ limit: 25, offset: 0 });
    expect(() => pageOf('0', '0')).toThrow();
    expect(() => pageOf('101', '0')).toThrow();
    expect(() => pageOf('10', '-1')).toThrow();
  });
});

describe('planChannelMerge: no channel is lost on a hand-over', () => {
  const lead = { phone: 'kp', whatsapp: 'kw', email: 'ke' };
  const both = { phoneEmpty: true, emailEmpty: true };

  it('channels the family already holds need nothing', () => {
    expect(planChannelMerge(lead, new Set(['kp', 'kw', 'ke']), { phoneEmpty: false, emailEmpty: false })).toEqual({ fillPhoneFrom: null, fillEmail: false, missing: [] });
  });
  it('a missing phone or e-mail goes into the family file\'s EMPTY slot', () => {
    expect(planChannelMerge({ phone: 'kp', whatsapp: null, email: 'ke' }, new Set(['ke']), both)).toEqual({ fillPhoneFrom: 'phone', fillEmail: false, missing: [] });
    expect(planChannelMerge({ phone: null, whatsapp: null, email: 'ke' }, new Set(), both)).toEqual({ fillPhoneFrom: null, fillEmail: true, missing: [] });
  });
  it('never over a stored value: a taken slot makes the channel missing (refuse, keep the contact)', () => {
    expect(planChannelMerge({ phone: 'kp', whatsapp: null, email: null }, new Set(), { phoneEmpty: false, emailEmpty: true }).missing).toEqual(['phone']);
    expect(planChannelMerge({ phone: null, whatsapp: null, email: 'ke' }, new Set(), { phoneEmpty: true, emailEmpty: false }).missing).toEqual(['email']);
  });
  it('a WhatsApp number with no free phone slot is missing; the same number as phone and WhatsApp is one', () => {
    expect(planChannelMerge(lead, new Set(['kp', 'ke']), { phoneEmpty: false, emailEmpty: false }).missing).toEqual(['whatsapp']);
    expect(planChannelMerge({ phone: 'kp', whatsapp: 'kp', email: null }, new Set(), both)).toEqual({ fillPhoneFrom: 'phone', fillEmail: false, missing: [] });
    // two new numbers, one slot: the second has no room
    expect(planChannelMerge({ phone: 'kp', whatsapp: 'kw', email: null }, new Set(), both)).toEqual({ fillPhoneFrom: 'phone', fillEmail: false, missing: ['whatsapp'] });
  });
  it('a family with no parent file can take nothing', () => {
    expect(planChannelMerge({ phone: 'kp', whatsapp: null, email: null }, new Set(), null).missing).toEqual(['phone']);
  });
});
