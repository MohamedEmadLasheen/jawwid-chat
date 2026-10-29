import { ActorKind, CertificateCategory, CertificateState, StaffRole } from '../communication/contracts/vocab';
import { decidePd012StaffAccess, type OperationsDepartmentRole, type TeachersDepartmentRole } from './pd012-policy';
import type { PermissionKey } from './permissions/catalogue';
import type { Actor } from './types';

/**
 * PD-41: who may do what with appreciation certificates
 * (docs/product/pd041-certificates-design.md §6, §14; owner safeguards 2026-10-28).
 *
 *   key                            what it allows                                   today's holders (legacy bundles)
 *   certificates.view              open the page, list, read                        every holder of a key below
 *   certificates.request.student   request / edit / approve / cancel; decide a      Operations supervisors + manager
 *                                  teacher's suggestion (the learner's supervisor)
 *   certificates.request.teacher   the same for teacher certificates                Teachers department (members + manager)
 *   certificates.design            take, upload, return a request                   the Designer; the Teachers department
 *                                                                                   until a Designer exists (PD-12's issuers)
 *   certificates.deliver           send an APPROVED certificate                     the requesters above
 *   certificates.story             record family consent; publish the Story         the requesters above
 *   certificates.oversee           every request of the categories one requests     the two department managers
 *   certificates.types             enable / disable / relabel types                 the super admin only
 *
 * A key is necessary, never sufficient. The row rules -- "the requester of
 * record or their active cover", "the learner's assigned supervisor", "not who
 * uploaded it", "the overseer when the requester uploaded it and has no cover"
 * -- are applied by CertificateService and, again, by the
 * database trigger chat.guard_appreciation_certificate.
 *
 * Pure: the caller resolves the department roles and the permission set.
 */

export const CERTIFICATE_KEYS = [
  'certificates.view',
  'certificates.request.student',
  'certificates.request.teacher',
  'certificates.design',
  'certificates.deliver',
  'certificates.story',
  'certificates.oversee',
  'certificates.types',
] as const satisfies readonly PermissionKey[];

const REQUEST_KEY: Readonly<Record<CertificateCategory, PermissionKey>> = {
  student: 'certificates.request.student',
  teacher: 'certificates.request.teacher',
};

export function requestKeyOf(category: CertificateCategory): PermissionKey {
  return REQUEST_KEY[category];
}

export const CERTIFICATE_CATEGORIES: readonly CertificateCategory[] = [CertificateCategory.STUDENT, CertificateCategory.TEACHER];

export function isCertificateCategory(v: unknown): v is CertificateCategory {
  return typeof v === 'string' && (CERTIFICATE_CATEGORIES as readonly string[]).includes(v);
}

/**
 * The certificate keys an account holds from its tier and department alone --
 * what legacy-bundles.ts writes down, derived from the rules that existed
 * before PD-41 (pd040-legacy-bundles.spec.ts pins the two to each other):
 *   - Operations: a supervisor (admin/coverage) or the manager, as PD-8 places them;
 *   - the Teachers department: PD-12's canSupervise;
 *   - the super admin: every key.
 */
export function legacyCertificateKeys(
  actor: Actor,
  operationsRole: OperationsDepartmentRole,
  teachersRole: TeachersDepartmentRole,
): ReadonlySet<PermissionKey> {
  const keys = new Set<PermissionKey>();
  if (actor.kind !== ActorKind.STAFF || !actor.isActive || !actor.organizationId) return keys;
  if (actor.staffRole === StaffRole.SUPER_ADMIN) return new Set(CERTIFICATE_KEYS);
  const requester = (category: CertificateCategory, manager: boolean) => {
    keys.add('certificates.view');
    keys.add(REQUEST_KEY[category]);
    keys.add('certificates.deliver');
    keys.add('certificates.story');
    if (manager) keys.add('certificates.oversee');
  };
  const opsManager = operationsRole === 'manager' && actor.staffRole === StaffRole.MANAGER;
  const opsMember = operationsRole === 'member' && (actor.staffRole === StaffRole.ADMIN || actor.staffRole === StaffRole.COVERAGE);
  if (opsManager || opsMember) requester(CertificateCategory.STUDENT, opsManager);
  if (decidePd012StaffAccess(actor, teachersRole).canSupervise) {
    requester(CertificateCategory.TEACHER, teachersRole === 'manager');
    // The transition rule (design §6.2): PD-12's issuers keep designing until
    // the organization has a Designer; PR-3 takes it away.
    keys.add('certificates.design');
  }
  return keys;
}

/** What a set of keys allows, per category. */
export interface CertificateAccess {
  view: boolean;
  design: boolean;
  types: boolean;
  /** Per category: request (and own), send, Story, oversee. */
  categories: Readonly<Record<CertificateCategory, CategoryAccess>>;
}

export interface CategoryAccess {
  request: boolean;
  deliver: boolean;
  story: boolean;
  /** Every request of the category: the full record, cancel, release a stuck design. */
  oversee: boolean;
}

export const NO_CERTIFICATE_ACCESS: CertificateAccess = Object.freeze({
  view: false,
  design: false,
  types: false,
  categories: Object.freeze({
    student: Object.freeze({ request: false, deliver: false, story: false, oversee: false }),
    teacher: Object.freeze({ request: false, deliver: false, story: false, oversee: false }),
  }),
});

export function certificateAccessFrom(keys: ReadonlySet<string>): CertificateAccess {
  if (!keys.has('certificates.view')) return NO_CERTIFICATE_ACCESS;
  const category = (c: CertificateCategory): CategoryAccess => {
    const request = keys.has(REQUEST_KEY[c]);
    return {
      request,
      // Send and Story belong to the requester of record, so to the categories one requests.
      deliver: request && keys.has('certificates.deliver'),
      story: request && keys.has('certificates.story'),
      oversee: request && keys.has('certificates.oversee'),
    };
  };
  return {
    view: true,
    design: keys.has('certificates.design'),
    types: keys.has('certificates.types'),
    categories: { student: category(CertificateCategory.STUDENT), teacher: category(CertificateCategory.TEACHER) },
  };
}

/** Does this account see the full record of a category, or only the Designer's projection? */
export function fullViewOf(access: CertificateAccess, category: CertificateCategory): boolean {
  const c = access.categories[category];
  return c.request || c.oversee;
}

// ---------------------------------------------------------------------------
// The acts on one certificate
// ---------------------------------------------------------------------------

export const CertificateAct = {
  EDIT: 'edit',
  RESUBMIT: 'resubmit',
  CANCEL: 'cancel',
  ACCEPT: 'accept',
  DECLINE: 'decline',
  START: 'start',
  RETURN: 'return',
  RELEASE: 'release',
  UPLOAD: 'upload',
  APPROVE: 'approve',
  REDESIGN: 'redesign',
  WITHDRAW_APPROVAL: 'withdraw_approval',
  SEND: 'send',
  CONSENT: 'consent',
  STORY: 'story',
} as const;
export type CertificateAct = (typeof CertificateAct)[keyof typeof CertificateAct];

/** What the caller is to this certificate, resolved by the service. */
export interface CertificateRelation {
  category: CertificateCategory;
  state: CertificateState;
  /**
   * Answers for it NOW (chat.certificate_responsible): for a student, whoever
   * acts for the learner's current supervisor -- a PD-24 transfer moves it --
   * or the requester of record when nobody supervises the learner; for a
   * teacher, the requester of record while they still request teacher
   * certificates. Their active PD-33 cover counts as them.
   */
  actsAsRequester: boolean;
  /** For a suggestion: the learner's assigned Operations supervisor or their cover; the Operations manager when nobody supervises the learner. */
  decidesSuggestion: boolean;
  /** Holds certificates.oversee in some category: may cancel an undecided suggestion. */
  anyOversee?: boolean;
  isAssignedDesigner: boolean;
  /** Uploaded the current revision (and so may not approve it). */
  uploadedCurrent: boolean;
  /**
   * PD-41 "Their manager" (chat.certificate_overseer_approves): the requester of
   * record uploaded the current revision themself and nobody else answers for
   * it -- no active PD-33 cover -- so the category's overseer approves it.
   */
  overseerApproves?: boolean;
  publishStory: boolean;
  storyPublished: boolean;
  storyWithdrawn: boolean;
}

const OPEN_FOR_CANCEL: ReadonlySet<string> = new Set([
  CertificateState.REQUESTED,
  CertificateState.IN_DESIGN,
  CertificateState.CHANGES_REQUESTED,
  CertificateState.UPLOADED,
  CertificateState.APPROVED,
]);
const CONSENT_STATES: ReadonlySet<string> = new Set([...OPEN_FOR_CANCEL, CertificateState.SENT]);

/**
 * The acts this caller may take now. It mirrors the trigger's rules so that
 * the page offers exactly what the server will accept; it never grants
 * anything the trigger would refuse. A Story is offered only after approval
 * and only when the request opted in; whether the family consented is
 * re-checked when the Story is published (owner safeguard 4).
 */
export function allowedActs(access: CertificateAccess, r: CertificateRelation): CertificateAct[] {
  const acts: CertificateAct[] = [];
  const c = access.categories[r.category];
  const requester = c.request && r.actsAsRequester;
  const s = r.state;
  const storyLive = r.storyPublished && !r.storyWithdrawn;
  if (s === CertificateState.PROPOSED && r.category === CertificateCategory.STUDENT && c.request && r.decidesSuggestion) {
    acts.push(CertificateAct.ACCEPT, CertificateAct.DECLINE);
  }
  // An orphaned suggestion is cancelled by an overseer (the Teachers or Operations manager, the super admin).
  if (s === CertificateState.PROPOSED && r.anyOversee) acts.push(CertificateAct.CANCEL);
  if (requester) {
    if (s === CertificateState.REQUESTED || s === CertificateState.CHANGES_REQUESTED) acts.push(CertificateAct.EDIT);
    if (s === CertificateState.CHANGES_REQUESTED) acts.push(CertificateAct.RESUBMIT);
    if (s === CertificateState.UPLOADED && !r.uploadedCurrent) acts.push(CertificateAct.APPROVE);
    if (s === CertificateState.UPLOADED) acts.push(CertificateAct.REDESIGN);
    // A live Story pins the approval: take the Story down (consent) first.
    if (s === CertificateState.APPROVED && !storyLive) acts.push(CertificateAct.WITHDRAW_APPROVAL);
    if (s === CertificateState.APPROVED && c.deliver) acts.push(CertificateAct.SEND);
    if (c.story && r.publishStory && r.category === CertificateCategory.STUDENT && CONSENT_STATES.has(s) && !r.storyWithdrawn) {
      acts.push(CertificateAct.CONSENT);
    }
    if (c.story && r.publishStory && !r.storyPublished && (s === CertificateState.APPROVED || s === CertificateState.SENT)) {
      acts.push(CertificateAct.STORY);
    }
  }
  // "Their manager": the overseer approves what only its uploader could otherwise answer for.
  if (s === CertificateState.UPLOADED && !r.uploadedCurrent && c.oversee && r.overseerApproves) acts.push(CertificateAct.APPROVE);
  if (OPEN_FOR_CANCEL.has(s) && !storyLive && (requester || c.oversee)) acts.push(CertificateAct.CANCEL);
  if (access.design) {
    if (s === CertificateState.REQUESTED) acts.push(CertificateAct.START, CertificateAct.RETURN);
    if (s === CertificateState.IN_DESIGN && r.isAssignedDesigner) acts.push(CertificateAct.UPLOAD, CertificateAct.RETURN);
    if (s === CertificateState.UPLOADED && r.isAssignedDesigner) acts.push(CertificateAct.UPLOAD);
  }
  if (s === CertificateState.IN_DESIGN && ((access.design && r.isAssignedDesigner) || c.oversee)) acts.push(CertificateAct.RELEASE);
  return [...new Set(acts)];
}
