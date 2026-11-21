/**
 * PD-59: the Sales pipeline's pure rules -- no database, no clock of its own.
 *
 * A lead is a trial prospect (chat.trial_prospect). Three stages are STORED on
 * it (new_lead, contacted, and lost before any trial); the other three are
 * DERIVED on every read from the prospect's trial lessons, their outcome and
 * the hand-over, and are never copied anywhere, so they cannot drift from the
 * trial journey they come from.
 */

export const STORED_STAGES = ['new_lead', 'contacted', 'lost'] as const;
export type StoredStage = (typeof STORED_STAGES)[number];

export const STAGES = ['new_lead', 'contacted', 'trial_booked', 'trial_completed', 'converted', 'lost'] as const;
export type Stage = (typeof STAGES)[number];

/** The reasons a lead is lost before a trial (the trial journey's codes, so the two read alike). */
export const LOST_REASONS = ['price', 'schedule', 'not_ready', 'chose_other', 'no_response', 'other'] as const;
export type LostReason = (typeof LOST_REASONS)[number];

export function isStage(v: unknown): v is Stage {
  return typeof v === 'string' && (STAGES as readonly string[]).includes(v);
}

/** One trial lesson of the prospect, as the derivation needs it. */
export interface TrialFact {
  startsAt: Date;
  /** chat.trial_outcome.result, or null while none is recorded. */
  result: 'no_show' | 'subscribed' | 'not_subscribed' | null;
  /** chat.trial_outcome.reason_code (a not-subscribed reason), or null. */
  reasonCode: string | null;
  /**
   * chat.lesson.outcome: null (not decided), 'held' or 'student_no_show' keep the trial alive; any other
   * value (cancelled, apology, rescheduled, ...) means the trial is not one the lead has -- the rule of
   * trialOutcomeOf (lessons/trial.service.ts). A recorded trial outcome always counts.
   */
  lessonOutcome: string | null;
}

/** Whether the lesson is still a trial the lead has (the same rule as the trial journey's `cancelled`). */
export function isLiveTrial(t: Pick<TrialFact, 'result' | 'lessonOutcome'>): boolean {
  if (t.result) return true;
  return t.lessonOutcome === null || t.lessonOutcome === 'held' || t.lessonOutcome === 'student_no_show';
}

export interface StageFacts {
  pipelineStage: StoredStage | null;
  lostReason: string | null;
  convertedAt: Date | null;
  trials: readonly TrialFact[];
  now: Date;
}

export interface DerivedStage {
  stage: Stage;
  /** Why it is lost: the stored reason, the trial's reason code, or 'no_show'. */
  lostReason: string | null;
  /** True when the stage comes from a stored field a person may change; false when a trial decides it. */
  manual: boolean;
}

/**
 * The stage a lead is in now.
 *
 *   hand-over made (converted_at) or any trial subscribed   -> converted
 *   otherwise the LATEST live trial decides:
 *     no outcome yet, still ahead                           -> trial_booked
 *     no outcome yet, started                               -> trial_completed (the outcome is pending)
 *     subscribed                                            -> converted
 *     not_subscribed / no_show                              -> lost (the trial's reason)
 *   no live trial: the stored stage (new_lead when none).
 *
 * A booked trial overrides a stored stage, so booking a trial for a lead who
 * was marked lost reopens it without anyone editing the lead.
 */
export function deriveStage(f: StageFacts): DerivedStage {
  if (f.convertedAt) return { stage: 'converted', lostReason: null, manual: false };
  const live = f.trials.filter(isLiveTrial);
  if (live.some((t) => t.result === 'subscribed')) return { stage: 'converted', lostReason: null, manual: false };
  const latest = [...live].sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime())[0];
  if (latest) {
    const result = latest.result ?? (latest.lessonOutcome === 'student_no_show' ? 'no_show' : null);
    if (result === 'not_subscribed') return { stage: 'lost', lostReason: latest.reasonCode ?? 'other', manual: false };
    if (result === 'no_show') return { stage: 'lost', lostReason: 'no_show', manual: false };
    return { stage: latest.startsAt.getTime() > f.now.getTime() ? 'trial_booked' : 'trial_completed', lostReason: null, manual: false };
  }
  if (f.pipelineStage === 'lost') return { stage: 'lost', lostReason: f.lostReason ?? 'other', manual: true };
  return { stage: f.pipelineStage ?? 'new_lead', lostReason: null, manual: true };
}

/** What a caller asks of the stage field when they update a lead. */
export interface StageChange {
  to: StoredStage;
  lostReason: string | null;
}

export type TransitionVerdict =
  | { ok: true; next: { pipelineStage: StoredStage; lostReason: string | null } }
  | { ok: false; code: 'stage_derived' | 'not_allowed' | 'lost_reason_required' | 'lost_reason_unknown' };

/**
 * Whether a person may move a lead to `change.to`.
 *
 *   new_lead  -> contacted | lost          contacted -> contacted | lost
 *   lost (stored) -> new_lead | contacted  (reopen; the reason is cleared)
 *   same stage, no reason change           -> allowed (a no-op the caller may repeat)
 *
 * A lead whose stage a trial or the hand-over decides (trial_booked,
 * trial_completed, converted, or lost by a trial's outcome) is not moved by
 * hand: 'stage_derived'. Nobody moves a lead back to new_lead from contacted.
 */
export function checkTransition(current: DerivedStage, change: StageChange): TransitionVerdict {
  if (!current.manual) return { ok: false, code: 'stage_derived' };
  const from = current.stage as StoredStage;
  const to = change.to;
  if (to === 'lost') {
    if (!change.lostReason) return { ok: false, code: 'lost_reason_required' };
    if (!(LOST_REASONS as readonly string[]).includes(change.lostReason)) return { ok: false, code: 'lost_reason_unknown' };
    return { ok: true, next: { pipelineStage: 'lost', lostReason: change.lostReason } };
  }
  const allowed: Record<StoredStage, readonly StoredStage[]> = {
    new_lead: ['new_lead', 'contacted'],
    contacted: ['contacted'],
    lost: ['new_lead', 'contacted'],
  };
  if (!allowed[from].includes(to)) return { ok: false, code: 'not_allowed' };
  return { ok: true, next: { pipelineStage: to, lostReason: null } };
}

/** "Mark contacted": from new_lead or contacted (again), or a reopened lost lead; never over a trial's stage. */
export function checkMarkContacted(current: DerivedStage): TransitionVerdict {
  return checkTransition(current, { to: 'contacted', lostReason: null });
}

// ---------------------------------------------------------------------------
// Who may use the pipeline
// ---------------------------------------------------------------------------

export type LeadStanding = 'super_admin' | 'sales_manager' | 'sales_member';

/**
 * The one authorization decision: the super admin, and staff in the Sales
 * department (chat.sales_department_role: 'manager' | 'member') -- the same
 * people GET /lessons/access calls `sales`. Not a teacher, not a parent, not an
 * Operations or Finance or Teachers person (an Operations supervisor reaches a
 * family through the hand-over, never a lead's contact), not an inactive or
 * departed account.
 */
export function decideLeadAccess(s: {
  isStaff: boolean;
  isActive: boolean;
  left: boolean;
  role: string | null;
  salesRole: 'manager' | 'member' | null;
}): LeadStanding | null {
  if (!s.isStaff || !s.isActive || s.left) return null;
  if (s.role === 'super_admin') return 'super_admin';
  if (s.salesRole === 'manager') return 'sales_manager';
  if (s.salesRole === 'member') return 'sales_member';
  return null;
}

// ---------------------------------------------------------------------------
// Conversion: link into the existing parent record, never a second one
// ---------------------------------------------------------------------------

export type ConversionDecision =
  | { kind: 'no_contact' }
  /** No family holds this parent's contact: the hand-over is the existing family intake. */
  | { kind: 'intake_required' }
  /** A subscribed trial made the lead Converted but Operations has not enrolled the family yet: nothing to link to. */
  | { kind: 'awaiting_enrolment' }
  /** The family exists and the caller may handle it: link, never create. */
  | { kind: 'link'; familyId: string }
  /** The family exists but is not the caller's: say nothing about it (as the intake does). */
  | { kind: 'unavailable' };

/**
 * Decide a conversion from what the contact keys found. `matchedFamilyId` is
 * the family that already holds one of the lead's e-mail / phone keys (or whose
 * sign-in account has the e-mail); `callerMayHandle` is chat.staff_owns_family
 * for that family. A lead with no usable contact cannot be matched, so it is
 * refused rather than handed over blind.
 */
export function decideConversion(d: {
  hasContact: boolean;
  matchedFamilyId: string | null;
  callerMayHandle: boolean;
  /** A subscribed trial already made the lead Converted (its hand-over is the New students flow). */
  subscribedTrial?: boolean;
  /** The family Operations enrolled that trial into, when it has. Authoritative: it came from the lead's own trial. */
  enrolledFamilyId?: string | null;
}): ConversionDecision {
  if (!d.hasContact) return { kind: 'no_contact' };
  if (d.subscribedTrial && d.enrolledFamilyId) return { kind: 'link', familyId: d.enrolledFamilyId };
  if (!d.matchedFamilyId) return d.subscribedTrial ? { kind: 'awaiting_enrolment' } : { kind: 'intake_required' };
  return d.callerMayHandle ? { kind: 'link', familyId: d.matchedFamilyId } : { kind: 'unavailable' };
}

/**
 * A conversion is offered to a lead still in the funnel, and to one a subscribed trial already made
 * Converted whose hand-over was never recorded (`handedOver` false): that lead still has its own copy
 * of the contact and must be linked to its family. A lead already handed over (`converted_at` set)
 * is never converted twice, and a lost lead is reopened first.
 */
export function canConvert(stage: Stage, handedOver = false): boolean {
  if (stage === 'converted') return !handedOver;
  return stage !== 'lost';
}

/**
 * ONE rule for "the family's side already has this lead": the lead was handed over (converted), or Operations
 * has enrolled one of its trials. The list and the detail both answer with it (PD-59 F8). It is NOT what
 * decides whether Convert may run: that stays `canConvert` (an enrolled but not yet linked lead is exactly
 * the one Convert links).
 */
export function isHandedOver(convertedAt: Date | null, enrolled: boolean): boolean {
  return convertedAt !== null || enrolled;
}

/** The three channels of a lead, keyed (null when the channel is absent). */
export interface ChannelKeys {
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
}

export type ChannelKind = 'phone' | 'whatsapp' | 'email';

export interface ChannelPlan {
  /** Which lead channel fills the family file's EMPTY phone slot, if any. */
  fillPhoneFrom: 'phone' | 'whatsapp' | null;
  fillEmail: boolean;
  /** Channels the family record would lose: the hand-over is refused (and the contact kept) when not empty. */
  missing: ChannelKind[];
}

/**
 * What it takes to hand a lead's channels over WITHOUT losing one. A channel the family already holds
 * (its key is in `familyKeys`) is covered. An uncovered one may go into the family file's empty phone /
 * e-mail slot (never over a stored value); a WhatsApp number or a second phone with no slot to take it,
 * or an e-mail beside another one, is `missing`. `file` is null when the family has no parent file.
 */
export function planChannelMerge(
  lead: ChannelKeys,
  familyKeys: ReadonlySet<string>,
  file: { phoneEmpty: boolean; emailEmpty: boolean } | null,
): ChannelPlan {
  const plan: ChannelPlan = { fillPhoneFrom: null, fillEmail: false, missing: [] };
  let phoneFree = file?.phoneEmpty === true;
  if (lead.email && !familyKeys.has(lead.email)) {
    if (file?.emailEmpty) plan.fillEmail = true;
    else plan.missing.push('email');
  }
  for (const kind of ['phone', 'whatsapp'] as const) {
    const key = lead[kind];
    if (!key || familyKeys.has(key)) continue;
    // The same number typed as phone and as WhatsApp is one number.
    if (kind === 'whatsapp' && lead.phone && lead.phone === key) continue;
    if (phoneFree) {
      plan.fillPhoneFrom = kind;
      phoneFree = false;
    } else plan.missing.push(kind);
  }
  return plan;
}

// ---------------------------------------------------------------------------
// The list: filter, search, follow-up due
// ---------------------------------------------------------------------------

export interface LeadRowFacts {
  displayName: string;
  stage: Stage;
  nextFollowUpOn: string | null;
}

/** A follow-up is due on its day and every day after, until it is moved or cleared; never for a lead past the funnel. */
export function followUpDue(row: Pick<LeadRowFacts, 'stage' | 'nextFollowUpOn'>, today: string): boolean {
  if (!row.nextFollowUpOn) return false;
  if (row.stage === 'converted' || row.stage === 'lost') return false;
  return row.nextFollowUpOn <= today;
}

export interface LeadFilter {
  stage: Stage | null;
  q: string | null;
  followUp: 'due' | null;
}

export function matchesFilter(row: LeadRowFacts, f: LeadFilter, today: string): boolean {
  if (f.stage && row.stage !== f.stage) return false;
  if (f.followUp === 'due' && !followUpDue(row, today)) return false;
  if (f.q && !row.displayName.toLocaleLowerCase().includes(f.q.toLocaleLowerCase())) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface ContactInput {
  parentName?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  /** The number's country (ISO 3166-1 alpha-2), to read a local number. */
  country?: string | null;
}

export class LeadInputError extends Error {}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHONE_RE = /^\+?[0-9][0-9\s().-]{3,30}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function bad(msg: string): never {
  throw new LeadInputError(msg);
}

/** Trimmed text of 1..max characters, or null when absent/empty. Present-but-not-a-string is refused. */
export function optText(v: unknown, key: string, max: number): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== 'string') return bad(`${key}: text`);
  const t = v.trim();
  if (t === '') return null;
  if (t.length > max) return bad(`${key}: at most ${max} characters`);
  return t;
}

export function reqText(v: unknown, key: string, max: number): string {
  const t = optText(v, key, max);
  if (t === undefined || t === null) return bad(`${key}: required`);
  return t;
}

/** A calendar day YYYY-MM-DD that exists, or null to clear; undefined when absent. */
export function optDay(v: unknown, key: string): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  if (typeof v !== 'string' || !DAY_RE.test(v)) return bad(`${key}: a date as YYYY-MM-DD`);
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return bad(`${key}: a date that exists`);
  return v;
}

export interface ParsedContact {
  parentName?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  country?: string | null;
}

/** Validate contact fields; a field left out stays undefined (unchanged), null clears it. */
export function parseContact(raw: unknown, key = 'contact'): ParsedContact {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return bad(`${key}: an object`);
  const o = raw as Record<string, unknown>;
  const out: ParsedContact = {};
  const parentName = optText(o.parentName, `${key}.parentName`, 120);
  if (parentName !== undefined) out.parentName = parentName;
  for (const f of ['phone', 'whatsapp'] as const) {
    const t = optText(o[f], `${key}.${f}`, 32);
    if (t !== undefined) {
      if (t !== null && !PHONE_RE.test(t)) return bad(`${key}.${f}: a phone number`);
      out[f] = t;
    }
  }
  const email = optText(o.email, `${key}.email`, 254);
  if (email !== undefined) {
    if (email !== null && !EMAIL_RE.test(email)) return bad(`${key}.email: an e-mail address`);
    out.email = email === null ? null : email.toLowerCase();
  }
  const country = optText(o.country, `${key}.country`, 2);
  if (country !== undefined) {
    if (country !== null && !/^[A-Za-z]{2}$/.test(country)) return bad(`${key}.country: a two-letter country code`);
    out.country = country === null ? null : country.toUpperCase();
  }
  return out;
}

/** The fields of a contact that carry a value, by name -- for an audit line (never the values). */
export function contactFieldNames(c: ParsedContact): string[] {
  return (['parentName', 'phone', 'whatsapp', 'email', 'country'] as const).filter((k) => c[k] !== undefined);
}

/** What a list row shows of the contact: that a channel exists, never the value. */
export interface ContactPresence {
  phone: boolean;
  whatsapp: boolean;
  email: boolean;
}

export const NO_CONTACT: ContactPresence = { phone: false, whatsapp: false, email: false };

/** A row's contact fields, in the one shape every API response uses for the contact. */
export interface ContactDto {
  parentName: string;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  country: string | null;
}

/** Offset pagination: 1..100 rows (default 25), offset >= 0. */
export function pageOf(limit: unknown, offset: unknown): { limit: number; offset: number } {
  const l = limit === undefined || limit === '' ? 25 : Number(limit);
  const o = offset === undefined || offset === '' ? 0 : Number(offset);
  if (!Number.isInteger(l) || l < 1 || l > 100) return bad('limit: 1 to 100');
  if (!Number.isInteger(o) || o < 0 || o > 100_000) return bad('offset: 0 or more');
  return { limit: l, offset: o };
}
