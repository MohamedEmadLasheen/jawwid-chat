/**
 * PD-41, the pure parts of the owner's safeguards (design §14): who holds which
 * certificate key, and which acts one person may take on one certificate.
 *
 * The database trigger re-checks every act (test/integration/pd041-certificates.spec.ts);
 * this pins the matrix the page and the service offer, so the two cannot drift.
 */
import { CertificateState } from '@communication/contracts/vocab';
import {
  CERTIFICATE_KEYS,
  CertificateAct,
  allowedActs,
  certificateAccessFrom,
  fullViewOf,
  legacyCertificateKeys,
  type CertificateRelation,
} from '@platform/pd041-policy';
import type { Actor } from '@platform/types';

const ORG = '11111111-1111-1111-1111-111111111111';
const staff = (role: string, over: Partial<Actor> = {}): Actor => ({
  actorId: 's',
  kind: 'staff',
  displayName: 's',
  locale: 'ar',
  isActive: true,
  staffRole: role as never,
  organizationId: ORG,
  ...over,
});

const keys = (...k: string[]) => new Set(k);
const OPS_SUPERVISOR = keys('certificates.view', 'certificates.request.student', 'certificates.deliver', 'certificates.story');
const TEACHERS_MEMBER = keys('certificates.view', 'certificates.request.teacher', 'certificates.design', 'certificates.deliver', 'certificates.story');
const DESIGNER = keys('certificates.view', 'certificates.design');
const OPS_MANAGER = keys(...OPS_SUPERVISOR, 'certificates.oversee');

const rel = (over: Partial<CertificateRelation>): CertificateRelation => ({
  category: 'student',
  state: CertificateState.REQUESTED,
  actsAsRequester: false,
  decidesSuggestion: false,
  isAssignedDesigner: false,
  uploadedCurrent: false,
  publishStory: false,
  storyPublished: false,
  storyWithdrawn: false,
  ...over,
});

describe('PD-41: the legacy certificate keys', () => {
  it.each`
    label                            | role             | ops          | teachers     | want
    ${'Operations supervisor'}       | ${'admin'}       | ${'member'}  | ${null}      | ${['certificates.deliver', 'certificates.request.student', 'certificates.story', 'certificates.view']}
    ${'Operations coverage'}         | ${'coverage'}    | ${'member'}  | ${null}      | ${['certificates.deliver', 'certificates.request.student', 'certificates.story', 'certificates.view']}
    ${'Operations manager'}          | ${'manager'}     | ${'manager'} | ${null}      | ${['certificates.deliver', 'certificates.oversee', 'certificates.request.student', 'certificates.story', 'certificates.view']}
    ${'Teachers member'}             | ${'admin'}       | ${null}      | ${'member'}  | ${['certificates.deliver', 'certificates.design', 'certificates.request.teacher', 'certificates.story', 'certificates.view']}
    ${'Teachers manager'}            | ${'manager'}     | ${null}      | ${'manager'} | ${['certificates.deliver', 'certificates.design', 'certificates.oversee', 'certificates.request.teacher', 'certificates.story', 'certificates.view']}
    ${'a manager of no department'}  | ${'manager'}     | ${null}      | ${null}      | ${[]}
    ${'a stale Operations row'}      | ${'manager'}     | ${'member'}  | ${null}      | ${[]}
    ${'finance'}                     | ${'finance'}     | ${null}      | ${null}      | ${[]}
  `('$label holds $want', ({ role, ops, teachers, want }) => {
    expect([...legacyCertificateKeys(staff(role), ops, teachers)].sort()).toEqual(want);
  });

  it('the super admin holds every certificate key, the types included (owner safeguard 6)', () => {
    expect([...legacyCertificateKeys(staff('super_admin'), null, null)].sort()).toEqual([...CERTIFICATE_KEYS].sort());
  });

  it('only the super admin manages types', () => {
    for (const [role, ops, teachers] of [
      ['manager', 'manager', null],
      ['manager', null, 'manager'],
      ['admin', 'member', null],
    ] as const) {
      expect(legacyCertificateKeys(staff(role), ops, teachers).has('certificates.types')).toBe(false);
    }
  });

  it('nobody who is not live staff holds anything', () => {
    expect([...legacyCertificateKeys(staff('super_admin', { isActive: false }), null, null)]).toEqual([]);
    expect([...legacyCertificateKeys({ ...staff('admin'), kind: 'teacher' }, 'member', null)]).toEqual([]);
  });
});

describe('PD-41: what the keys allow', () => {
  it('a Designer sees the design projection, requests nothing and sends nothing (owner safeguard 1)', () => {
    const a = certificateAccessFrom(DESIGNER);
    expect(a.design).toBe(true);
    expect(a.categories.student).toEqual({ request: false, deliver: false, story: false, oversee: false });
    expect(a.categories.teacher).toEqual({ request: false, deliver: false, story: false, oversee: false });
    expect(fullViewOf(a, 'student')).toBe(false);
  });

  it('send, Story and oversight follow the categories one requests', () => {
    const a = certificateAccessFrom(OPS_MANAGER);
    expect(a.categories.student).toEqual({ request: true, deliver: true, story: true, oversee: true });
    expect(a.categories.teacher).toEqual({ request: false, deliver: false, story: false, oversee: false });
  });

  it('without certificates.view nothing is open', () => {
    expect(certificateAccessFrom(keys('certificates.request.student')).view).toBe(false);
  });
});

describe('PD-41: the acts on one certificate', () => {
  const ops = certificateAccessFrom(OPS_SUPERVISOR);
  const designer = certificateAccessFrom(DESIGNER);
  const manager = certificateAccessFrom(OPS_MANAGER);

  it('the Designer takes, uploads and returns -- never approves, sends, cancels or publishes (safeguard 1)', () => {
    expect(allowedActs(designer, rel({ state: CertificateState.REQUESTED })).sort()).toEqual([CertificateAct.RETURN, CertificateAct.START].sort());
    expect(allowedActs(designer, rel({ state: CertificateState.IN_DESIGN, isAssignedDesigner: true })).sort()).toEqual(
      [CertificateAct.RELEASE, CertificateAct.RETURN, CertificateAct.UPLOAD].sort(),
    );
    expect(allowedActs(designer, rel({ state: CertificateState.IN_DESIGN, isAssignedDesigner: false }))).toEqual([]);
    expect(allowedActs(designer, rel({ state: CertificateState.UPLOADED, isAssignedDesigner: true }))).toEqual([CertificateAct.UPLOAD]);
    for (const state of [CertificateState.APPROVED, CertificateState.SENT]) {
      expect(allowedActs(designer, rel({ state, isAssignedDesigner: true, publishStory: true }))).toEqual([]);
    }
  });

  it('send is offered only once the requester approved, and only to the requester (safeguard 1)', () => {
    expect(allowedActs(ops, rel({ state: CertificateState.UPLOADED, actsAsRequester: true }))).not.toContain(CertificateAct.SEND);
    expect(allowedActs(ops, rel({ state: CertificateState.APPROVED, actsAsRequester: true }))).toContain(CertificateAct.SEND);
    expect(allowedActs(ops, rel({ state: CertificateState.APPROVED, actsAsRequester: false }))).not.toContain(CertificateAct.SEND);
    // An overseer oversees: cancels, never approves or sends someone else's.
    const overseen = allowedActs(manager, rel({ state: CertificateState.APPROVED, actsAsRequester: false }));
    expect(overseen).toEqual([CertificateAct.CANCEL]);
    expect(allowedActs(manager, rel({ state: CertificateState.UPLOADED }))).not.toContain(CertificateAct.APPROVE);
  });

  it('the person who uploaded a revision does not approve it (four eyes)', () => {
    const both = certificateAccessFrom(new Set([...TEACHERS_MEMBER]));
    const r = rel({ category: 'teacher', state: CertificateState.UPLOADED, actsAsRequester: true, isAssignedDesigner: true });
    expect(allowedActs(both, { ...r, uploadedCurrent: true })).not.toContain(CertificateAct.APPROVE);
    expect(allowedActs(both, { ...r, uploadedCurrent: false })).toContain(CertificateAct.APPROVE);
  });

  it('"Their manager": the overseer approves when the requester uploaded it and has no cover (owner, 2026-10-29)', () => {
    const uploaded = rel({ state: CertificateState.UPLOADED, overseerApproves: true });
    // Only the approval: the overseer still never sends, publishes or asks for a redesign of someone else's request.
    expect(allowedActs(manager, uploaded).sort()).toEqual([CertificateAct.APPROVE, CertificateAct.CANCEL].sort());
    expect(allowedActs(manager, { ...uploaded, state: CertificateState.APPROVED })).toEqual([CertificateAct.CANCEL]);
    // A supervisor without oversight, and the other category's overseer, do not.
    expect(allowedActs(ops, uploaded)).not.toContain(CertificateAct.APPROVE);
    expect(allowedActs(manager, { ...uploaded, category: 'teacher' })).not.toContain(CertificateAct.APPROVE);
    const teachersManager = certificateAccessFrom(keys(...TEACHERS_MEMBER, 'certificates.oversee'));
    expect(allowedActs(teachersManager, { ...uploaded, category: 'teacher' })).toContain(CertificateAct.APPROVE);
    // With a cover the case does not hold: the cover approves, the overseer does not.
    expect(allowedActs(manager, { ...uploaded, overseerApproves: false })).not.toContain(CertificateAct.APPROVE);
    expect(allowedActs(ops, rel({ state: CertificateState.UPLOADED, actsAsRequester: true }))).toContain(CertificateAct.APPROVE);
    // The uploader never approves, overseer or not.
    expect(allowedActs(manager, { ...uploaded, uploadedCurrent: true })).not.toContain(CertificateAct.APPROVE);
    expect(allowedActs(manager, { ...uploaded, actsAsRequester: true, uploadedCurrent: true })).not.toContain(CertificateAct.APPROVE);
  });

  it('a Story is offered only after approval, only when the request opted in, and only once (safeguards 3 and 4)', () => {
    expect(allowedActs(ops, rel({ state: CertificateState.UPLOADED, actsAsRequester: true, publishStory: true }))).not.toContain(CertificateAct.STORY);
    expect(allowedActs(ops, rel({ state: CertificateState.APPROVED, actsAsRequester: true, publishStory: false }))).not.toContain(CertificateAct.STORY);
    expect(allowedActs(ops, rel({ state: CertificateState.APPROVED, actsAsRequester: true, publishStory: true }))).toContain(CertificateAct.STORY);
    expect(allowedActs(ops, rel({ state: CertificateState.SENT, actsAsRequester: true, publishStory: true, storyPublished: true }))).not.toContain(
      CertificateAct.STORY,
    );
  });

  it('family consent is recorded for a student certificate that opted in; a teacher Story needs none', () => {
    expect(allowedActs(ops, rel({ state: CertificateState.SENT, actsAsRequester: true, publishStory: true }))).toContain(CertificateAct.CONSENT);
    expect(allowedActs(ops, rel({ state: CertificateState.SENT, actsAsRequester: true, publishStory: false }))).not.toContain(CertificateAct.CONSENT);
    const teachers = certificateAccessFrom(TEACHERS_MEMBER);
    expect(allowedActs(teachers, rel({ category: 'teacher', state: CertificateState.SENT, actsAsRequester: true, publishStory: true }))).not.toContain(
      CertificateAct.CONSENT,
    );
  });

  it('a teacher\'s suggestion is decided only by the learner\'s assigned supervisor or their cover (safeguard 5)', () => {
    expect(allowedActs(ops, rel({ state: CertificateState.PROPOSED, decidesSuggestion: true })).sort()).toEqual([CertificateAct.ACCEPT, CertificateAct.DECLINE].sort());
    expect(allowedActs(ops, rel({ state: CertificateState.PROPOSED, decidesSuggestion: false }))).toEqual([]);
    expect(allowedActs(manager, rel({ state: CertificateState.PROPOSED, decidesSuggestion: false }))).toEqual([]);
    expect(allowedActs(designer, rel({ state: CertificateState.PROPOSED }))).toEqual([]);
  });

  it('a return or redesign comes back to the requester, who edits and resubmits (safeguard 2)', () => {
    expect(allowedActs(ops, rel({ state: CertificateState.CHANGES_REQUESTED, actsAsRequester: true })).sort()).toEqual(
      [CertificateAct.CANCEL, CertificateAct.EDIT, CertificateAct.RESUBMIT].sort(),
    );
    expect(allowedActs(ops, rel({ state: CertificateState.UPLOADED, actsAsRequester: true }))).toContain(CertificateAct.REDESIGN);
    expect(allowedActs(ops, rel({ state: CertificateState.APPROVED, actsAsRequester: true }))).toContain(CertificateAct.WITHDRAW_APPROVAL);
  });

  it('a live Story pins the approval: no withdrawal or cancellation until it is taken down', () => {
    const live = rel({ state: CertificateState.APPROVED, actsAsRequester: true, publishStory: true, storyPublished: true });
    expect(allowedActs(ops, live)).not.toContain(CertificateAct.WITHDRAW_APPROVAL);
    expect(allowedActs(ops, live)).not.toContain(CertificateAct.CANCEL);
    expect(allowedActs(ops, { ...live, storyWithdrawn: true })).toContain(CertificateAct.CANCEL);
  });

  it('an undecided suggestion is cancelled only by an overseer; its supervisor decides it', () => {
    expect(allowedActs(ops, rel({ state: CertificateState.PROPOSED, decidesSuggestion: true }))).not.toContain(CertificateAct.CANCEL);
    expect(allowedActs(certificateAccessFrom(TEACHERS_MEMBER), rel({ state: CertificateState.PROPOSED, anyOversee: true }))).toEqual([CertificateAct.CANCEL]);
  });

  it('nothing moves a closed certificate', () => {
    for (const state of [CertificateState.CANCELLED, CertificateState.DECLINED]) {
      expect(allowedActs(manager, rel({ state, actsAsRequester: true, publishStory: true }))).toEqual([]);
    }
  });
});
