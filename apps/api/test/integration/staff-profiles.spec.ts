/**
 * Staff profiles -- against the real migrated database.
 *
 * What this proves, end to end through StaffProfileService:
 *   - each role sees exactly the profiles its relation allows, and a profile it
 *     may not see answers like one that does not exist;
 *   - each field group is refused server-side to a caller who may not change
 *     it, whatever the request contains -- role, permissions, account status
 *     and login are not reachable at all;
 *   - photos are judged by their stored BYTES, bound to their owner's key
 *     prefix, and replaced without leaving the old object behind;
 *   - every workload number equals an independent SQL count and does not
 *     double-count (shared teachers, churned families, inactive contacts);
 *   - every change is audited in the same transaction, and audit rows are
 *     immutable;
 *   - the database itself refuses an unlawful reporting line, and the RLS
 *     policies say the same thing as the service.
 *
 * Synthetic fixtures only (QA gate G-16).
 */
import { randomUUID } from 'node:crypto';
import { CommError, CommErrorCode } from '@platform/errors';
import type { Actor } from '@platform/types';
import { ActorScopedDatabase } from '@platform/actor-database';
import { LocalFsBlobStore } from '@communication/attachments/blob-store';
import { StaffProfileService } from '../../src/staff-profile/staff-profile.service';
import { StaffWorkloadService } from '../../src/staff-profile/staff-workload.service';
import { buildGraph, legacyHeldMessage, seed, truncate, Scenario, withAssignmentGate } from './harness';
import { png } from '../support/images';
import { SignedLocalObjectStorage } from '@communication/attachments/object-storage';
import { MediaUrlSigner } from '@platform/media-url';
import { StaffPhotoController } from '../../src/staff-profile/staff-photo.controller';

// RT-037: a staff photo link is a link to the access-checked media route.
const STAFF_PHOTO_LINK = /\/media\/staff\/[0-9a-f-]{36}\?v=o&a=[0-9a-f-]{36}&e=\d+&s=[A-Za-z0-9_-]{43}$/;

jest.setTimeout(90_000);

const g = buildGraph();
const workload = new StaffWorkloadService(g.prisma);
/**
 * STAFF_PROFILE_SCOPED=1 runs every call on chat_app inside a trusted actor
 * context (ActorScopedDatabase, DATABASE_APP_URL) -- the restricted runtime --
 * instead of the owner connection. Same assertions in both modes.
 */
const scoped = process.env.STAFF_PROFILE_SCOPED === '1' ? new ActorScopedDatabase(g.prisma) : undefined;
if (process.env.STAFF_PROFILE_SCOPED === '1' && !scoped?.enabled) throw new Error('STAFF_PROFILE_SCOPED=1 needs DATABASE_APP_URL');
const profiles = new StaffProfileService(g.prisma, g.authz, workload, g.storage, scoped);
const blobs = new LocalFsBlobStore();
const DEFAULT_ORG = '00000000-0000-0000-0000-000000000001';

interface World extends Scenario {
  superAdminId: string;
  otherManagerId: string;
  otherFamilyId: string;
  churnedFamilyId: string;
  accounts: { admin: string; manager: string; superAdmin: string; otherAdmin: string };
}
let w: World;

const actor = async (id: string): Promise<Actor> => (await g.identity.resolveActor(id))!;

async function expectCode(p: Promise<unknown>, code: CommErrorCode, status?: number): Promise<void> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(CommError);
    expect((e as CommError).code).toBe(code);
    if (status) expect((e as CommError).status).toBe(status);
    return;
  }
  throw new Error(`expected ${code}, but the call succeeded`);
}

async function world(): Promise<World> {
  const s = await seed(g.prisma);
  const superAdminId = randomUUID();
  const otherManagerId = randomUUID();
  const otherFamilyId = randomUUID();
  const churnedFamilyId = randomUUID();
  const accounts = { admin: randomUUID(), manager: randomUUID(), superAdmin: randomUUID(), otherAdmin: randomUUID() };

  // truncate() does not reach chat.account; these subjects are this suite's own.
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@example.test'`);
  await g.prisma.$executeRawUnsafe(
    `insert into chat.account (id, subject, kind) values
       ('${accounts.admin}'::uuid, 'admin_a@example.test', 'staff'),
       ('${accounts.manager}'::uuid, 'manager_c@example.test', 'staff'),
       ('${accounts.superAdmin}'::uuid, 'owner_s@example.test', 'staff'),
       ('${accounts.otherAdmin}'::uuid, 'admin_b@example.test', 'staff')`,
  );
  await g.prisma.$executeRawUnsafe(
    `update chat.staff set account_id = '${accounts.admin}'::uuid where id = '${s.ownerId}'::uuid`,
  );
  await g.prisma.$executeRawUnsafe(
    `update chat.staff set account_id = '${accounts.manager}'::uuid where id = '${s.managerId}'::uuid`,
  );
  await g.prisma.$executeRawUnsafe(
    `update chat.staff set account_id = '${accounts.otherAdmin}'::uuid where id = '${s.otherAdminId}'::uuid`,
  );
  // super_admin exists only through the bootstrap gate (20261013120000).
  await g.prisma.$transaction([
    g.prisma.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`),
    g.prisma.$executeRawUnsafe(
      `insert into chat.staff (id, name, role, account_id) values
         ('${superAdminId}'::uuid, 'owner_s', 'super_admin', '${accounts.superAdmin}'::uuid)`,
    ),
  ]);
  await g.prisma.$executeRawUnsafe(
    `insert into chat.staff (id, name, role) values ('${otherManagerId}'::uuid, 'manager_d', 'manager')`,
  );

  // Teams: admin_a -> manager_c, admin_b -> manager_d; both managers -> the super admin.
  await g.prisma.$executeRawUnsafe(
    `insert into chat.staff_reporting_line (staff_id, manager_id) values
       ('${s.ownerId}'::uuid, '${s.managerId}'::uuid),
       ('${s.otherAdminId}'::uuid, '${otherManagerId}'::uuid),
       ('${s.managerId}'::uuid, '${superAdminId}'::uuid),
       ('${otherManagerId}'::uuid, '${superAdminId}'::uuid)`,
  );

  // admin_b owns a family whose learner is taught by teacher_c -- the SAME
  // teacher as admin_a's learner_l. A team or organization teacher count that
  // summed per-staff numbers would count teacher_c twice.
  await g.prisma.$executeRawUnsafe(
    `insert into chat.family (id, display_name, owner_id, language, state) values
       ('${otherFamilyId}'::uuid, 'family_y', '${s.otherAdminId}'::uuid, 'ar', 'active'),
       ('${churnedFamilyId}'::uuid, 'family_z', '${s.ownerId}'::uuid, 'ar', 'churned')`,
  );
  await withAssignmentGate(
    g.prisma,
    `insert into chat.learner (family_id, name, teacher_id) values
       ('${otherFamilyId}'::uuid, 'learner_y', '${s.teacherId}'::uuid),
       ('${churnedFamilyId}'::uuid, 'learner_z', '${s.newTeacherId}'::uuid)`,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.contact (family_id, name, role_preset, can_message, is_active) values
       ('${s.familyId}'::uuid, 'parent_gone', 'authorized_contact', false, false),
       ('${otherFamilyId}'::uuid, 'parent_y', 'primary_guardian', true, true),
       ('${churnedFamilyId}'::uuid, 'parent_z', 'primary_guardian', true, true)`,
  );

  return { ...s, superAdminId, otherManagerId, otherFamilyId, churnedFamilyId, accounts };
}

beforeAll(async () => {
  await g.prisma.$connect();
});
afterAll(async () => {
  await g.prisma.$disconnect();
});
beforeEach(async () => {
  await truncate(g.prisma);
  w = await world();
  g.coverage.onDutyId = w.ownerId;
});

// ===========================================================================
describe('an admin opens and edits their own profile', () => {
  it('opens with nothing filled in, and says what is missing instead of crashing', async () => {
    const p = await profiles.profile(await actor(w.ownerId), 'me');
    expect(p.staffId).toBe(w.ownerId);
    expect(p.jobTitle).toBeNull();
    expect(p.about).toBeNull();
    expect(p.avatarUrl).toBeNull();
    expect(p.version).toBeNull();
    expect(p.signInIdentity).toBe('admin_a@example.test');
    expect(p.reportingManager?.staffId).toBe(w.managerId);
    expect(p.completeness.missing).toEqual(['photo', 'job_title', 'about', 'responsibility']);
    expect(p.access).toMatchObject({ relation: 'self', canEditProfessional: true, canEditDisplayName: false });
  });

  it('saves job title and introduction, changes only what was sent, and audits it', async () => {
    const me = await actor(w.ownerId);
    await profiles.updateProfile(me, 'me', { jobTitle: 'مشرفة متابعة الأسر', about: 'First line\nSecond line' });
    const after = await profiles.updateProfile(me, 'me', { jobTitle: 'Family Follow-up Lead' });

    expect(after.jobTitle).toBe('Family Follow-up Lead');
    expect(after.about).toBe('First line\nSecond line'); // untouched by the second save
    const audit = await g.prisma.auditLog.findMany({ where: { entityId: w.ownerId }, orderBy: { id: 'asc' } });
    expect(audit).toHaveLength(2);
    expect(audit[1]).toMatchObject({ actorId: w.ownerId, action: 'staff_profile.updated', reason: 'self-service profile edit' });
    expect(audit[1].before).toEqual({ jobTitle: 'مشرفة متابعة الأسر' });
    expect(audit[1].after).toEqual({ jobTitle: 'Family Follow-up Lead' });
  });

  it('a save that changes nothing writes no audit row', async () => {
    const me = await actor(w.ownerId);
    await profiles.updateProfile(me, 'me', { jobTitle: 'Supervisor' });
    await profiles.updateProfile(me, 'me', { jobTitle: '  Supervisor ' });
    expect(await g.prisma.auditLog.count({ where: { entityId: w.ownerId } })).toBe(1);
  });

  it('a stale save is refused with a conflict and loses nothing', async () => {
    const me = await actor(w.ownerId);
    const first = await profiles.updateProfile(me, 'me', { about: 'original' });
    await profiles.updateProfile(me, 'me', { about: 'newer', expectedVersion: first.version });
    await expectCode(
      profiles.updateProfile(me, 'me', { about: 'stale overwrite', expectedVersion: first.version }),
      CommErrorCode.STAFF_PROFILE_CONFLICT,
      409,
    );
    expect((await profiles.profile(me, 'me')).about).toBe('newer');
  });

  it('over-long or non-text input is refused, and the stored value survives', async () => {
    const me = await actor(w.ownerId);
    await profiles.updateProfile(me, 'me', { jobTitle: 'Supervisor' });
    await expectCode(profiles.updateProfile(me, 'me', { jobTitle: 'x'.repeat(81) }), CommErrorCode.STAFF_PROFILE_INVALID, 400);
    await expectCode(profiles.updateProfile(me, 'me', { about: { html: '<b>' } }), CommErrorCode.STAFF_PROFILE_INVALID, 400);
    expect((await profiles.profile(me, 'me')).jobTitle).toBe('Supervisor');
  });
});

// ===========================================================================
describe('no profile edit reaches role, permissions, account or reporting line', () => {
  it('a hand-built request naming role, permissions, status or account is refused outright', async () => {
    const me = await actor(w.ownerId);
    for (const body of [
      { role: 'manager' },
      { staffRole: 'super_admin' },
      { permissions: ['users.manage'] },
      { isActive: false },
      { accountId: randomUUID() },
      { managerId: w.superAdminId },
      { organizationId: randomUUID() },
      { jobTitle: 'ok', role: 'manager' },
    ]) {
      await expectCode(profiles.updateProfile(me, 'me', body), CommErrorCode.STAFF_PROFILE_INVALID, 400);
    }
    const row = await g.prisma.staff.findUniqueOrThrow({ where: { id: w.ownerId } });
    expect(row).toMatchObject({ role: 'admin', isActive: true, accountId: w.accounts.admin });
    expect(await g.prisma.staffProfile.count()).toBe(0);
  });

  it('an admin cannot rename themselves, assign themselves a responsibility, or pick a manager', async () => {
    const me = await actor(w.ownerId);
    await expectCode(profiles.updateProfile(me, 'me', { displayName: 'Jawwid Management' }), CommErrorCode.STAFF_PROFILE_EDIT_DENIED, 403);
    await expectCode(
      profiles.assignResponsibility(me, 'me', { category: 'team_management' }),
      CommErrorCode.STAFF_ASSIGNMENT_DENIED,
      403,
    );
    await expectCode(
      profiles.setReportingLine(me, 'me', { managerStaffId: w.superAdminId, reason: 'promote me' }),
      CommErrorCode.STAFF_ASSIGNMENT_DENIED,
      403,
    );
    expect((await g.prisma.staff.findUniqueOrThrow({ where: { id: w.ownerId } })).name).toBe('admin_a');
    expect(await g.prisma.staffResponsibility.count()).toBe(0);
    expect((await g.prisma.staffReportingLine.findUniqueOrThrow({ where: { staffId: w.ownerId } })).managerId).toBe(w.managerId);
  });

  it('an admin cannot see or edit another admin, a manager or the super admin -- "not found", not "forbidden"', async () => {
    const me = await actor(w.ownerId);
    for (const id of [w.otherAdminId, w.managerId, w.superAdminId, randomUUID(), 'not-a-uuid']) {
      await expectCode(profiles.profile(me, id), CommErrorCode.STAFF_PROFILE_NOT_FOUND, 404);
      await expectCode(profiles.updateProfile(me, id, { jobTitle: 'x' }), CommErrorCode.STAFF_PROFILE_NOT_FOUND, 404);
    }
    expect((await profiles.team(me)).members).toEqual([]);
    await expectCode(profiles.organization(me), CommErrorCode.STAFF_DIRECTORY_DENIED, 403);
    await expectCode(profiles.activity(me, 'me'), CommErrorCode.STAFF_PROFILE_EDIT_DENIED, 403);
  });

  it('a parent or teacher has no staff-profile surface at all', async () => {
    for (const id of [w.parentId, w.teacherId]) {
      await expectCode(profiles.profile(await actor(id), w.ownerId), CommErrorCode.STAFF_PROFILE_NOT_FOUND, 404);
    }
  });

  it('a deactivated admin cannot edit, even their own profile', async () => {
    // A family owner cannot be deactivated at all (offboarding invariant), so a
    // staff member with no families stands in.
    const gone = randomUUID();
    await g.prisma.$executeRawUnsafe(`insert into chat.staff (id, name, role) values ('${gone}'::uuid, 'admin_e', 'admin')`);
    await g.prisma.staff.update({ where: { id: gone }, data: { isActive: false, leftAt: new Date() } });
    await expectCode(
      profiles.updateProfile(await actor(gone), 'me', { jobTitle: 'x' }),
      CommErrorCode.ACTOR_INACTIVE,
      403,
    );
  });
});

// ===========================================================================
describe('a manager and their team', () => {
  it('sees exactly their own team: not another manager\'s report, not the super admin', async () => {
    const team = await profiles.team(await actor(w.managerId));
    expect(team.members.map((m) => m.staffId)).toEqual([w.ownerId]);

    const mgr = await actor(w.managerId);
    await expectCode(profiles.profile(mgr, w.otherAdminId), CommErrorCode.STAFF_PROFILE_NOT_FOUND, 404);
    await expectCode(profiles.profile(mgr, w.otherManagerId), CommErrorCode.STAFF_PROFILE_NOT_FOUND, 404);
    await expectCode(profiles.profile(mgr, w.superAdminId), CommErrorCode.STAFF_PROFILE_NOT_FOUND, 404);
    await expectCode(profiles.organization(mgr), CommErrorCode.STAFF_DIRECTORY_DENIED, 403);
  });

  it('may edit a report\'s professional info; the audit names the manager as the actor', async () => {
    const mgr = await actor(w.managerId);
    const p = await profiles.updateProfile(mgr, w.ownerId, { jobTitle: 'Senior Supervisor', reason: 'annual review' });
    expect(p.jobTitle).toBe('Senior Supervisor');
    expect(p.profileUpdatedBy).toEqual({ staffId: w.managerId, displayName: 'manager_c' });
    const [row] = await g.prisma.auditLog.findMany({ where: { entityId: w.ownerId } });
    expect(row).toMatchObject({ actorId: w.managerId, entityId: w.ownerId, reason: 'annual review' });

    // The report keeps their own self-service access afterwards.
    const own = await profiles.updateProfile(await actor(w.ownerId), 'me', { about: 'my words' });
    expect(own.jobTitle).toBe('Senior Supervisor');
    expect(own.about).toBe('my words');
  });

  it('may NOT change a report\'s name or photo, or anyone\'s reporting line', async () => {
    const mgr = await actor(w.managerId);
    await expectCode(profiles.updateProfile(mgr, w.ownerId, { displayName: 'renamed' }), CommErrorCode.STAFF_PROFILE_EDIT_DENIED, 403);
    await expectCode(profiles.authorizeAvatarUpload(mgr, w.ownerId, { mimeType: 'image/png', byteSize: 100 }), CommErrorCode.STAFF_PROFILE_EDIT_DENIED, 403);
    await expectCode(profiles.removeAvatar(mgr, w.ownerId), CommErrorCode.STAFF_PROFILE_EDIT_DENIED, 403);
    await expectCode(
      profiles.setReportingLine(mgr, w.ownerId, { managerStaffId: null, reason: 'x' }),
      CommErrorCode.STAFF_ASSIGNMENT_DENIED,
      403,
    );
    // Nor move another manager's report into their own team.
    await expectCode(
      profiles.setReportingLine(mgr, w.otherAdminId, { managerStaffId: w.managerId, reason: 'x' }),
      CommErrorCode.STAFF_PROFILE_NOT_FOUND,
      404,
    );
  });

  it('cannot edit another manager\'s team, the other manager, or the super admin', async () => {
    const mgr = await actor(w.managerId);
    for (const id of [w.otherAdminId, w.otherManagerId, w.superAdminId]) {
      await expectCode(profiles.updateProfile(mgr, id, { jobTitle: 'x' }), CommErrorCode.STAFF_PROFILE_NOT_FOUND, 404);
      await expectCode(profiles.assignResponsibility(mgr, id, { category: 'customer_support' }), CommErrorCode.STAFF_PROFILE_NOT_FOUND, 404);
    }
    expect(await g.prisma.staffProfile.count()).toBe(0);
  });

  it('manages a report\'s responsibilities; a duplicate cannot inflate them; ending needs a reason', async () => {
    const mgr = await actor(w.managerId);
    const p = await profiles.assignResponsibility(mgr, w.ownerId, { category: 'family_follow_up', scopeNote: 'Cairo families' });
    expect(p.responsibilities.map((r) => r.category)).toEqual(['family_follow_up']);
    await expectCode(profiles.assignResponsibility(mgr, w.ownerId, { category: 'family_follow_up' }), CommErrorCode.STAFF_ASSIGNMENT_INVALID, 409);
    await expectCode(profiles.assignResponsibility(mgr, w.ownerId, { category: 'superpowers' }), CommErrorCode.STAFF_PROFILE_INVALID, 400);
    await expectCode(profiles.assignResponsibility(mgr, w.ownerId, { category: 'other' }), CommErrorCode.STAFF_PROFILE_INVALID, 400);

    // The database is the backstop for a race the service check could miss.
    await expect(
      g.prisma.$executeRawUnsafe(
        `insert into chat.staff_responsibility (staff_id, category) values ('${w.ownerId}'::uuid, 'family_follow_up')`,
      ),
    ).rejects.toThrow();

    const id = p.responsibilities[0].id;
    await expectCode(profiles.endResponsibility(mgr, w.ownerId, id, {}), CommErrorCode.STAFF_PROFILE_INVALID, 400);
    const ended = await profiles.endResponsibility(mgr, w.ownerId, id, { reason: 'moved to support' });
    expect(ended.responsibilities[0].endedAt).not.toBeNull();
    await expectCode(profiles.endResponsibility(mgr, w.ownerId, id, { reason: 'again' }), CommErrorCode.STAFF_ASSIGNMENT_INVALID, 409);

    // The report sees active labels only; history stays with those who manage it.
    const own = await profiles.profile(await actor(w.ownerId), 'me');
    expect(own.responsibilities).toEqual([]);
    // Ordered: without orderBy Postgres may return the two rows either way (seen in CI on 2026-10-27).
    expect((await g.prisma.auditLog.findMany({ where: { entityId: w.ownerId }, orderBy: { createdAt: 'asc' } })).map((a) => a.action)).toEqual([
      'staff_responsibility.assigned',
      'staff_responsibility.ended',
    ]);
  });

  it('a responsibility row cannot be rewritten after the fact, even by direct SQL', async () => {
    const p = await profiles.assignResponsibility(await actor(w.managerId), w.ownerId, { category: 'customer_support' });
    await expect(
      g.prisma.$executeRawUnsafe(
        `update chat.staff_responsibility set category = 'team_management' where id = '${p.responsibilities[0].id}'::uuid`,
      ),
    ).rejects.toThrow(/immutable/);
  });

  it('cannot end a responsibility that belongs to someone outside the team by naming its id', async () => {
    const sa = await actor(w.superAdminId);
    const other = await profiles.assignResponsibility(sa, w.otherAdminId, { category: 'customer_support' });
    const foreignId = other.responsibilities[0].id;
    // Routed through the manager's OWN report: the id is narrowed to that profile and not found.
    await expectCode(
      profiles.endResponsibility(await actor(w.managerId), w.ownerId, foreignId, { reason: 'x' }),
      CommErrorCode.STAFF_ASSIGNMENT_INVALID,
      409,
    );
    expect((await g.prisma.staffResponsibility.findUniqueOrThrow({ where: { id: foreignId } })).endedAt).toBeNull();
  });

  it('loses the report the moment the reporting line moves, even mid-session', async () => {
    const mgr = await actor(w.managerId);
    const loaded = await profiles.profile(mgr, w.ownerId);
    expect(loaded.access.canEditProfessional).toBe(true);
    await profiles.setReportingLine(await actor(w.superAdminId), w.ownerId, { managerStaffId: w.otherManagerId, reason: 're-team' });
    await expectCode(profiles.updateProfile(mgr, w.ownerId, { jobTitle: 'too late' }), CommErrorCode.STAFF_PROFILE_NOT_FOUND, 404);
  });

  it('a manager demoted after their token was minted cannot finish a write', async () => {
    const mgr = await actor(w.managerId); // resolved while still a manager
    await g.prisma.staff.update({ where: { id: w.managerId }, data: { role: 'admin' } });
    await expectCode(profiles.updateProfile(mgr, w.ownerId, { jobTitle: 'x' }), CommErrorCode.STAFF_PROFILE_NOT_FOUND, 404);
  });
});

// ===========================================================================
describe('the super admin', () => {
  it('opens and manages any administrative profile, through the same audited paths', async () => {
    const sa = await actor(w.superAdminId);
    const p = await profiles.updateProfile(sa, w.otherAdminId, { displayName: 'admin_b2', jobTitle: 'Support Lead' });
    expect(p).toMatchObject({ displayName: 'admin_b2', jobTitle: 'Support Lead' });
    expect(p.access.relation).toBe('organization');
    await profiles.assignResponsibility(sa, w.otherManagerId, { category: 'team_management' });
    const m = await profiles.profile(sa, w.otherManagerId);
    expect(m.responsibilities.map((r) => r.category)).toEqual(['team_management']);

    const audit = await profiles.activity(sa, w.otherAdminId);
    expect(audit.entries[0]).toMatchObject({ action: 'staff_profile.updated', actor: { staffId: w.superAdminId } });
    expect(audit.entries[0].changedFields.sort()).toEqual(['displayName', 'jobTitle']);
  });

  it('renaming changes the display name only -- login identity and ids are untouched', async () => {
    const sa = await actor(w.superAdminId);
    await profiles.updateProfile(sa, w.ownerId, { displayName: 'admin_a2' });
    const row = await g.prisma.staff.findUniqueOrThrow({ where: { id: w.ownerId }, include: { account: true } });
    expect(row.name).toBe('admin_a2');
    expect(row.account!.subject).toBe('admin_a@example.test');
    expect(row.accountId).toBe(w.accounts.admin);
    expect((await g.prisma.family.findUniqueOrThrow({ where: { id: w.familyId } })).ownerId).toBe(w.ownerId);
  });

  it('moves staff between teams; the hierarchy is enforced', async () => {
    const sa = await actor(w.superAdminId);
    const moved = await profiles.setReportingLine(sa, w.otherAdminId, { managerStaffId: w.managerId, reason: 'rebalance' });
    expect(moved.reportingManager?.staffId).toBe(w.managerId);
    expect((await profiles.team(await actor(w.managerId))).members.map((m) => m.staffId).sort()).toEqual(
      [w.ownerId, w.otherAdminId].sort(),
    );

    await expectCode(profiles.setReportingLine(sa, w.ownerId, { managerStaffId: w.otherAdminId, reason: 'x' }), CommErrorCode.STAFF_ASSIGNMENT_INVALID, 409);
    await expectCode(profiles.setReportingLine(sa, w.managerId, { managerStaffId: w.otherManagerId, reason: 'x' }), CommErrorCode.STAFF_ASSIGNMENT_INVALID, 409);
    await expectCode(profiles.setReportingLine(sa, w.ownerId, { managerStaffId: w.ownerId, reason: 'x' }), CommErrorCode.STAFF_ASSIGNMENT_INVALID, 409);
    await expectCode(profiles.setReportingLine(sa, w.ownerId, { managerStaffId: w.managerId }), CommErrorCode.STAFF_PROFILE_INVALID, 400);

    const cleared = await profiles.setReportingLine(sa, w.otherAdminId, { managerStaffId: null, reason: 'leaving team' });
    expect(cleared.reportingManager).toBeNull();
    const actions = (await g.prisma.auditLog.findMany({ where: { entityId: w.otherAdminId }, orderBy: { id: 'asc' } })).map((a) => a.action);
    expect(actions).toEqual(['staff_reporting_line.set', 'staff_reporting_line.cleared']);
  });

  it('cannot give themselves a manager, demote themselves, or lose their login through the profile', async () => {
    const sa = await actor(w.superAdminId);
    await expectCode(
      profiles.setReportingLine(sa, 'me', { managerStaffId: w.managerId, reason: 'x' }),
      CommErrorCode.STAFF_ASSIGNMENT_DENIED,
      403,
    );
    await expectCode(profiles.updateProfile(sa, 'me', { role: 'admin' }), CommErrorCode.STAFF_PROFILE_INVALID, 400);
    await profiles.updateProfile(sa, 'me', { jobTitle: 'Academy Director', displayName: 'owner_s2' });
    const row = await g.prisma.staff.findUniqueOrThrow({ where: { id: w.superAdminId } });
    expect(row).toMatchObject({ role: 'super_admin', isActive: true, accountId: w.accounts.superAdmin, name: 'owner_s2' });
    // And the database still refuses an ungated demotion, whoever asks.
    await expect(
      g.prisma.$executeRawUnsafe(`update chat.staff set role = 'admin' where id = '${w.superAdminId}'::uuid`),
    ).rejects.toThrow(/bootstrap procedure/);
  });

  it('the database refuses an unlawful reporting line written directly', async () => {
    for (const [staff, manager] of [
      [w.superAdminId, w.managerId], // the super admin reports to nobody
      [w.parentId, w.managerId], // not staff
    ]) {
      await expect(
        g.prisma.$executeRawUnsafe(
          `insert into chat.staff_reporting_line (staff_id, manager_id) values ('${staff}'::uuid, '${manager}'::uuid)`,
        ),
      ).rejects.toThrow();
    }
    await expect(
      g.prisma.$executeRawUnsafe(
        `update chat.staff_reporting_line set manager_id = '${w.otherAdminId}'::uuid where staff_id = '${w.ownerId}'::uuid`,
      ),
    ).rejects.toThrow(/only a manager or the super admin/);
    await expect(
      g.prisma.$executeRawUnsafe(
        `update chat.staff_reporting_line set manager_id = '${w.otherManagerId}'::uuid where staff_id = '${w.managerId}'::uuid`,
      ),
    ).rejects.toThrow(/reports only to the super admin/);
  });

  it('cannot reach another organization\'s staff', async () => {
    const otherOrg = randomUUID();
    const foreign = randomUUID();
    await g.prisma.$executeRawUnsafe(
      `insert into chat.organization (id, slug, display_name) values ('${otherOrg}'::uuid, 'other-${otherOrg.slice(0, 8)}', 'Other')`,
    );
    await g.prisma.$executeRawUnsafe(
      `insert into chat.staff (id, organization_id, name, role) values ('${foreign}'::uuid, '${otherOrg}'::uuid, 'admin_x', 'admin')`,
    );
    try {
      const sa = await actor(w.superAdminId);
      await expectCode(profiles.profile(sa, foreign), CommErrorCode.STAFF_PROFILE_NOT_FOUND, 404);
      await expectCode(profiles.updateProfile(sa, foreign, { jobTitle: 'x' }), CommErrorCode.STAFF_PROFILE_NOT_FOUND, 404);
      const org = await profiles.organization(sa);
      expect(org.directory.map((d) => d.staffId)).not.toContain(foreign);
      // Nor can a reporting line cross the tenant boundary at the database.
      await expect(
        g.prisma.$executeRawUnsafe(
          `insert into chat.staff_reporting_line (staff_id, manager_id) values ('${foreign}'::uuid, '${w.managerId}'::uuid)`,
        ),
      ).rejects.toThrow(/cross organizations/);
    } finally {
      await g.prisma.$executeRawUnsafe(`delete from chat.staff where id = '${foreign}'::uuid`);
      await g.prisma.$executeRawUnsafe(`delete from chat.organization where id = '${otherOrg}'::uuid`);
    }
  });
});

// ===========================================================================
describe('workload numbers are counts of authoritative rows', () => {
  async function sql(q: string): Promise<number> {
    const [row] = await g.prisma.$queryRawUnsafe<Array<{ n: number }>>(q);
    return Number(row.n);
  }

  it('match independent SQL, exclude churned families and inactive contacts, and never double-count teachers', async () => {
    // One live student group with a parent message still held from before
    // PD-14: an open conversation, awaiting a reply, with one pending approval.
    const group = await g.conversations.ensureStudentGroup(w.learnerId);
    await legacyHeldMessage(g, { conversationId: group.id, senderId: w.parentId, body: 'question' });

    const mine = (await profiles.profile(await actor(w.ownerId), 'me')).workload;
    expect(mine).toEqual({
      assignedFamilies: 1, // family_x; family_z is churned
      studentsInAssignedFamilies: 2, // learner_l, learner_m
      parentContacts: 2, // parent_p, parent_q; parent_gone is inactive
      teachersOfAssignedStudents: 2, // teacher_c, teacher_d
      openConversations: await sql(
        `select count(*)::int as n from chat.conversation where family_id = '${w.familyId}'::uuid and archived_at is null and resolved_at is null`,
      ),
      awaitingReply: await sql(
        `select count(*)::int as n from chat.conversation where family_id = '${w.familyId}'::uuid and archived_at is null and resolved_at is null
           and last_customer_message_at is not null and (last_staff_message_at is null or last_customer_message_at > last_staff_message_at)`,
      ),
      pendingApprovals: await sql(
        `select count(*)::int as n from chat.message_approval where conversation_id = '${group.id}'::uuid and decision = 'pending'`,
      ),
      directReports: 0,
    });
    expect(mine.openConversations).toBeGreaterThanOrEqual(1);
    expect(mine.pendingApprovals).toBe(1);

    const org = await profiles.organization(await actor(w.superAdminId));
    expect(org.workload.unique).toMatchObject({
      families: await sql(`select count(*)::int as n from chat.family where state <> 'churned'`),
      studentsInFamilies: 3,
      activeParentContacts: 3,
      teachersWithStudents: 2, // teacher_c is shared by admin_a and admin_b: counted ONCE
      pendingApprovals: 1,
      familiesOwnedByInactiveStaff: 0,
    });
    // Per-staff teacher counts sum to 3; the distinct organization figure is 2.
    const sumPerStaff = org.directory.reduce((n, d) => n + d.workload.teachersOfAssignedStudents, 0);
    expect(sumPerStaff).toBe(3);

    // Teams: each manager's totals are exactly their members' families.
    const team = org.teams.find((t) => t.manager.staffId === w.managerId)!;
    expect(team).toMatchObject({ memberCount: 1, distinctTeachers: 2 });
    expect(team.totals.assignedFamilies).toBe(1);
    expect(org.workload.sumOfTeams.assignedFamilies).toBe(2);
    expect(org.workload.familiesOutsideTeams).toBe(0);
  });

  it('a manager\'s team totals are their reports\' sums, with teachers counted distinct', async () => {
    const sa = await actor(w.superAdminId);
    await profiles.setReportingLine(sa, w.otherAdminId, { managerStaffId: w.managerId, reason: 'merge teams' });
    const team = await profiles.team(await actor(w.managerId));
    expect(team.totals.assignedFamilies).toBe(2);
    expect(team.totals.studentsInAssignedFamilies).toBe(3);
    expect(team.distinctTeachers).toBe(2); // not 3
    expect(team.totals.teachersOfAssignedStudents).toBe(0); // the summed figure is never reported
  });

  it('a manager sees their direct-report count; a family owned outside every team is reported as such', async () => {
    const mgr = await profiles.profile(await actor(w.managerId), 'me');
    expect(mgr.workload.directReports).toBe(1);
    expect(mgr.derivedResponsibilities).toEqual([{ kind: 'team_management', count: 1 }]);

    await g.prisma.staffReportingLine.delete({ where: { staffId: w.otherAdminId } });
    const org = await profiles.organization(await actor(w.superAdminId));
    expect(org.workload.familiesOutsideTeams).toBe(1);
    expect(org.health.withoutReportingLine.map((p) => p.staffId)).toEqual([w.otherAdminId]);
  });

  it('a member whose role changed to manager leaves the team counts and is flagged as a stale line', async () => {
    // manager_d has no login in the fixture; a request on chat_app needs one.
    await g.prisma.$executeRawUnsafe(
      `with a as (insert into chat.account (subject, kind) values ('manager_d@example.test', 'staff') returning id)
       update chat.staff set account_id = (select id from a) where id = '${w.otherManagerId}'::uuid`,
    );
    await g.prisma.staff.update({ where: { id: w.otherAdminId }, data: { role: 'manager' } });
    const org = await profiles.organization(await actor(w.superAdminId));
    const team = org.teams.find((t) => t.manager.staffId === w.otherManagerId)!;
    expect(team.memberCount).toBe(0);
    expect(team.totals.assignedFamilies).toBe(0);
    expect(org.health.staleReportingLines.map((l) => l.member.staffId)).toEqual([w.otherAdminId]);
    await expectCode(profiles.profile(await actor(w.otherManagerId), w.otherAdminId), CommErrorCode.STAFF_PROFILE_NOT_FOUND, 404);
  });

  it('responsibility coverage counts live holders only', async () => {
    const sa = await actor(w.superAdminId);
    const gone = randomUUID();
    await g.prisma.$executeRawUnsafe(`insert into chat.staff (id, name, role) values ('${gone}'::uuid, 'admin_e', 'admin')`);
    await profiles.assignResponsibility(sa, gone, { category: 'sales_admissions' });
    await profiles.assignResponsibility(sa, w.ownerId, { category: 'sales_admissions' });
    await g.prisma.staff.update({ where: { id: gone }, data: { isActive: false, leftAt: new Date() } });
    const org = await profiles.organization(await actor(w.superAdminId));
    const sales = org.responsibilityCoverage.find((c) => c.category === 'sales_admissions')!;
    expect(sales.holders.map((h) => h.staffId)).toEqual([w.ownerId]);
  });

  it('the overview counts accounts by role and status from the staff table', async () => {
    const gone = randomUUID();
    await g.prisma.$executeRawUnsafe(
      `insert into chat.staff (id, name, role, is_active, left_at) values ('${gone}'::uuid, 'admin_e', 'admin', false, now())`,
    );
    const org = await profiles.organization(await actor(w.superAdminId));
    expect(org.accounts).toMatchObject({ managers: 2, adminsAndSupervisors: 2, active: 5, inactive: 1 });
    expect(org.accounts.byRole.admin).toEqual({ active: 2, inactive: 1 });
    expect(org.health.withoutReportingLine.map((p) => p.staffId)).toEqual([]); // inactive accounts are not a gap
    expect(org.health.withoutLogin.map((p) => p.staffId)).toEqual([w.otherManagerId]);
  });
});

// ===========================================================================
describe('profile photos', () => {
  const put = async (key: string, mime: string, bytes: Buffer) => blobs.put(key, mime, bytes);

  it('uploads under the owner\'s prefix, is judged by its bytes, and replaces without an orphan', async () => {
    const me = await actor(w.ownerId);
    const photo = png(256, 256);
    const grant = await profiles.authorizeAvatarUpload(me, 'me', { mimeType: 'image/png', byteSize: photo.length });
    expect(grant.objectKey.startsWith(`avatars/staff/${w.ownerId}/`)).toBe(true);
    await put(grant.objectKey, 'image/png', photo);

    const set = await profiles.commitAvatar(me, 'me', { objectKey: grant.objectKey });
    expect(set.avatarUrl).toMatch(STAFF_PHOTO_LINK); // RT-037: the media route, bound to the reader
    expect((await g.prisma.staff.findUniqueOrThrow({ where: { id: w.ownerId } })).avatarObjectKey).toBe(grant.objectKey);

    const next = await profiles.authorizeAvatarUpload(me, 'me', { mimeType: 'image/png', byteSize: photo.length });
    await put(next.objectKey, 'image/png', photo);
    await profiles.commitAvatar(me, 'me', { objectKey: next.objectKey });
    expect(await blobs.get(grant.objectKey)).toBeNull(); // the replaced photo is gone
    expect(await blobs.get(next.objectKey)).not.toBeNull();

    const removed = await profiles.removeAvatar(me, 'me');
    expect(removed.avatarUrl).toBeNull();
    expect(await blobs.get(next.objectKey)).toBeNull();
    expect((await g.prisma.auditLog.findMany({ where: { entityId: w.ownerId }, orderBy: { id: 'asc' } })).map((a) => a.action)).toEqual([
      'staff_profile.photo_set',
      'staff_profile.photo_set',
      'staff_profile.photo_removed',
    ]);
  });

  it('refuses HTML uploaded as image/png, deletes it, and keeps the existing photo', async () => {
    const me = await actor(w.ownerId);
    const good = await profiles.authorizeAvatarUpload(me, 'me', { mimeType: 'image/png', byteSize: 100 });
    await put(good.objectKey, 'image/png', png(128, 128));
    await profiles.commitAvatar(me, 'me', { objectKey: good.objectKey });

    const html = Buffer.from('<!doctype html><script>alert(document.cookie)</script>');
    const bad = await profiles.authorizeAvatarUpload(me, 'me', { mimeType: 'image/png', byteSize: html.length });
    await put(bad.objectKey, 'image/png', html);
    await expectCode(profiles.commitAvatar(me, 'me', { objectKey: bad.objectKey }), CommErrorCode.STAFF_AVATAR_INVALID, 400);
    expect(await blobs.get(bad.objectKey)).toBeNull();
    expect((await g.prisma.staff.findUniqueOrThrow({ where: { id: w.ownerId } })).avatarObjectKey).toBe(good.objectKey);
  });

  it('refuses oversized, wrong-type, tiny and type-mismatched photos', async () => {
    const me = await actor(w.ownerId);
    await expectCode(profiles.authorizeAvatarUpload(me, 'me', { mimeType: 'image/png', byteSize: 3 * 1024 * 1024 }), CommErrorCode.STAFF_AVATAR_INVALID, 400);
    await expectCode(profiles.authorizeAvatarUpload(me, 'me', { mimeType: 'image/gif', byteSize: 100 }), CommErrorCode.STAFF_AVATAR_INVALID, 400);
    await expectCode(profiles.authorizeAvatarUpload(me, 'me', { mimeType: 'image/svg+xml', byteSize: 100 }), CommErrorCode.STAFF_AVATAR_INVALID, 400);

    const tiny = await profiles.authorizeAvatarUpload(me, 'me', { mimeType: 'image/png', byteSize: 100 });
    await put(tiny.objectKey, 'image/png', png(16, 16));
    await expectCode(profiles.commitAvatar(me, 'me', { objectKey: tiny.objectKey }), CommErrorCode.STAFF_AVATAR_INVALID, 400);

    const lie = await profiles.authorizeAvatarUpload(me, 'me', { mimeType: 'image/jpeg', byteSize: 100 });
    await put(lie.objectKey, 'image/jpeg', png(128, 128));
    await expectCode(profiles.commitAvatar(me, 'me', { objectKey: lie.objectKey }), CommErrorCode.STAFF_AVATAR_INVALID, 400);
    expect((await g.prisma.staff.findUniqueOrThrow({ where: { id: w.ownerId } })).avatarObjectKey).toBeNull();
  });

  it('a key lifted from another profile cannot be committed as one\'s own photo', async () => {
    const other = await actor(w.otherAdminId);
    const theirs = await profiles.authorizeAvatarUpload(other, 'me', { mimeType: 'image/png', byteSize: 100 });
    await put(theirs.objectKey, 'image/png', png(128, 128));
    await profiles.commitAvatar(other, 'me', { objectKey: theirs.objectKey });

    await expectCode(
      profiles.commitAvatar(await actor(w.ownerId), 'me', { objectKey: theirs.objectKey }),
      CommErrorCode.STAFF_PROFILE_EDIT_DENIED,
      403,
    );
    expect((await g.prisma.staff.findUniqueOrThrow({ where: { id: w.ownerId } })).avatarObjectKey).toBeNull();
    expect(await blobs.get(theirs.objectKey)).not.toBeNull(); // and their photo is untouched
  });

  it('nobody but the owner and the super admin may set a photo, and nobody may commit one that was never uploaded', async () => {
    const sa = await actor(w.superAdminId);
    const grant = await profiles.authorizeAvatarUpload(sa, w.ownerId, { mimeType: 'image/png', byteSize: 100 });
    expect(grant.objectKey.startsWith(`avatars/staff/${w.ownerId}/`)).toBe(true);
    await expectCode(profiles.commitAvatar(sa, w.ownerId, { objectKey: grant.objectKey }), CommErrorCode.STAFF_AVATAR_INVALID, 400);
    await expectCode(
      profiles.authorizeAvatarUpload(await actor(w.otherAdminId), w.ownerId, { mimeType: 'image/png', byteSize: 100 }),
      CommErrorCode.STAFF_PROFILE_NOT_FOUND,
      404,
    );
  });

  it('a photo URL is only minted for a viewer allowed to see the profile', async () => {
    const me = await actor(w.ownerId);
    const grant = await profiles.authorizeAvatarUpload(me, 'me', { mimeType: 'image/png', byteSize: 100 });
    await put(grant.objectKey, 'image/png', png(128, 128));
    await profiles.commitAvatar(me, 'me', { objectKey: grant.objectKey });

    expect((await profiles.profile(await actor(w.managerId), w.ownerId)).avatarUrl).toMatch(STAFF_PHOTO_LINK);
    await expectCode(profiles.profile(await actor(w.otherAdminId), w.ownerId), CommErrorCode.STAFF_PROFILE_NOT_FOUND, 404);
  });
});

// ===========================================================================
describe('audit and database policy', () => {
  it('audit rows for profile changes are append-only', async () => {
    await profiles.updateProfile(await actor(w.ownerId), 'me', { jobTitle: 'x' });
    await expect(g.prisma.$executeRawUnsafe(`update chat.audit_log set reason = 'rewritten'`)).rejects.toThrow();
    await expect(g.prisma.$executeRawUnsafe(`delete from chat.audit_log`)).rejects.toThrow();
  });

  /**
   * RLS is not the live control yet (RLS-STRATEGY §7), but the policies must
   * already say what the service says, so the day the API connects as chat_app
   * nothing becomes wider. Each check runs as chat_app with the subject of a
   * real staff login set, inside a transaction that is rolled back.
   */
  async function asSubject<T>(subject: string, fn: (tx: typeof g.prisma) => Promise<T>): Promise<T | 'rolled-back'> {
    let out: T | 'rolled-back' = 'rolled-back';
    await g.prisma
      .$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`set local role chat_app`);
        await tx.$executeRawUnsafe(`select set_config('chat.actor_subject', '${subject}', true)`);
        await tx.$executeRawUnsafe(`select set_config('chat.actor_organization', '${DEFAULT_ORG}', true)`);
        out = await fn(tx as unknown as typeof g.prisma);
        throw new Error('rollback');
      })
      .catch((e: Error) => {
        if (e.message !== 'rollback') throw e;
      });
    return out;
  }
  const count = async (tx: typeof g.prisma, table: string) =>
    Number((await tx.$queryRawUnsafe<Array<{ n: number }>>(`select count(*)::int as n from chat.${table}`))[0].n);

  beforeEach(async () => {
    const sa = await actor(w.superAdminId);
    for (const id of [w.ownerId, w.otherAdminId, w.managerId, w.superAdminId]) {
      await profiles.updateProfile(sa, id, { jobTitle: 'filled' });
    }
    await profiles.assignResponsibility(sa, w.ownerId, { category: 'customer_support' });
    await profiles.assignResponsibility(sa, w.otherAdminId, { category: 'customer_support' });
  });

  it('an admin reads only their own profile rows and cannot write official ones', async () => {
    const seen = await asSubject('admin_a@example.test', async (tx) => ({
      profiles: await count(tx, 'staff_profile'),
      responsibilities: await count(tx, 'staff_responsibility'),
      lines: await count(tx, 'staff_reporting_line'),
    }));
    // Own profile row + their manager's (staff_profile_visible_to_reports, 20261014110100).
    expect(seen).toEqual({ profiles: 2, responsibilities: 1, lines: 1 });

    for (const sqlText of [
      `insert into chat.staff_responsibility (staff_id, category) values ('${w.ownerId}'::uuid, 'team_management')`,
      `update chat.staff_reporting_line set manager_id = '${w.superAdminId}'::uuid where staff_id = '${w.ownerId}'::uuid returning 1`,
      `update chat.staff_profile set job_title = 'hijack' where staff_id = '${w.otherAdminId}'::uuid returning 1`,
    ]) {
      const result = await asSubject('admin_a@example.test', async (tx) => {
        try {
          return (await tx.$queryRawUnsafe<unknown[]>(sqlText)).length;
        } catch {
          return 'refused';
        }
      });
      expect([0, 'refused']).toContain(result);
    }
    const own = await asSubject('admin_a@example.test', async (tx) =>
      (await tx.$queryRawUnsafe<unknown[]>(`update chat.staff_profile set about = 'mine' where staff_id = '${w.ownerId}'::uuid returning 1`)).length,
    );
    expect(own).toBe(1);
  });

  it('a manager reads their team\'s rows; the super admin reads everything', async () => {
    const mgr = await asSubject('manager_c@example.test', async (tx) => ({
      profiles: await count(tx, 'staff_profile'),
      responsibilities: await count(tx, 'staff_responsibility'),
    }));
    // self + admin_a (their report) + owner_s (their own manager); admin_a's label only
    expect(mgr).toEqual({ profiles: 3, responsibilities: 1 });

    const sa = await asSubject('owner_s@example.test', async (tx) => ({
      profiles: await count(tx, 'staff_profile'),
      responsibilities: await count(tx, 'staff_responsibility'),
      lines: await count(tx, 'staff_reporting_line'),
    }));
    expect(sa).toEqual({ profiles: 4, responsibilities: 2, lines: 4 });
  });

  it('with no subject, chat_app sees nothing', async () => {
    const seen = await asSubject('', async (tx) => count(tx, 'staff_profile'));
    expect(seen).toBe(0);
  });
});

// ===========================================================================
// RT-037 -- staff photos are served through the access-checked media route.
// The reader must be live, and may read a photo exactly where the service
// shows it: a profile they may view, the reporting-manager card of such a
// profile, or the organization overview. Re-decided on every request.
// ===========================================================================
describe('RT-037 · profile photos through the access-checked media route', () => {
  const withIdentity = new StaffProfileService(g.prisma, g.authz, workload, g.storage, scoped, g.identity);
  const route = () => new StaffPhotoController(g.prisma, new SignedLocalObjectStorage(), withIdentity);
  async function fetchPhoto(url: string) {
    const u = new URL(url, 'http://api.test');
    const id = u.pathname.split('/media/staff/')[1];
    const state: { status: number; body: Buffer } = { status: 0, body: Buffer.alloc(0) as Buffer };
    const res = {
      status(c: number) { state.status = c; return res; },
      setHeader() {},
      send(b?: string | Buffer) { state.body = Buffer.isBuffer(b) ? b : Buffer.from(b ?? ''); },
      write(c: Uint8Array) { state.body = Buffer.concat([state.body, Buffer.from(c)]); return true; },
      end() {},
    };
    await route().photo(id, u.searchParams.get('v')!, u.searchParams.get('a')!, u.searchParams.get('e')!, u.searchParams.get('s')!, { headers: {} }, res);
    return state;
  }
  async function photoOf(staffId: string): Promise<{ key: string; bytes: Buffer }> {
    const who = await actor(staffId);
    const bytes = png(160, 160);
    const grant = await profiles.authorizeAvatarUpload(who, 'me', { mimeType: 'image/png', byteSize: bytes.length });
    await blobs.put(grant.objectKey, 'image/png', bytes);
    await profiles.commitAvatar(who, 'me', { objectKey: grant.objectKey });
    return { key: grant.objectKey, bytes };
  }
  const forged = (staffId: string, readerId: string, ttl = 300) => new MediaUrlSigner().url('staff', staffId, 'o', readerId, ttl);

  it('legitimate readers get the bytes: self, the manager of the profile, the reporting-manager card, the organization overview', async () => {
    const owner = await photoOf(w.ownerId);
    const mgr = await photoOf(w.managerId);
    const self = await withIdentity.profile(await actor(w.ownerId), 'me');
    expect((await fetchPhoto(self.avatarUrl!)).body.equals(owner.bytes)).toBe(true);
    const asManager = await withIdentity.profile(await actor(w.managerId), w.ownerId);
    expect((await fetchPhoto(asManager.avatarUrl!)).status).toBe(200);
    // The reporting-manager card on the owner's own profile shows manager_c's photo.
    const card = self.reportingManager!.avatarUrl!;
    const fromCard = await fetchPhoto(card);
    expect(fromCard.status).toBe(200);
    expect(fromCard.body.equals(mgr.bytes)).toBe(true);
    const org = await withIdentity.organization(await actor(w.superAdminId));
    const anyPhoto = JSON.stringify(org).match(/"avatarUrl":"([^"]+)"/)![1];
    expect((await fetchPhoto(anyPhoto)).status).toBe(200);
  });

  it('no object key or storage-provider URL reaches the client', async () => {
    const owner = await photoOf(w.ownerId);
    const dto = JSON.stringify(await withIdentity.profile(await actor(w.managerId), w.ownerId));
    expect(dto).not.toContain(owner.key);
    expect(dto).not.toMatch(/\/storage\/|X-Amz-|expires=|sig=/);
  });

  it('cross-account: a peer admin, a manager of ANOTHER team, and a parent are refused even with a validly signed link', async () => {
    await photoOf(w.ownerId);
    for (const reader of [w.otherAdminId, w.otherManagerId, w.parentId]) {
      expect((await fetchPhoto(forged(w.ownerId, reader))).status).toBe(404);
    }
  });

  it('forged, tampered and expired links are refused', async () => {
    await photoOf(w.ownerId);
    const good = (await withIdentity.profile(await actor(w.managerId), w.ownerId)).avatarUrl!;
    const u = new URL(good, 'http://api.test');
    u.searchParams.set('s', u.searchParams.get('s')!.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')));
    expect((await fetchPhoto(u.toString())).status).toBe(403);
    const longer = new URL(good, 'http://api.test');
    longer.searchParams.set('e', String(Number(longer.searchParams.get('e')) + 600));
    expect((await fetchPhoto(longer.toString())).status).toBe(403);
    expect((await fetchPhoto(forged(w.ownerId, w.managerId, -1))).status).toBe(403);
  });

  it('deactivation, and losing the reporting line, refuse the SAME link on the next request', async () => {
    await photoOf(w.ownerId);
    const link = (await withIdentity.profile(await actor(w.managerId), w.ownerId)).avatarUrl!;
    expect((await fetchPhoto(link)).status).toBe(200);
    await g.prisma.$executeRawUnsafe(`delete from chat.staff_reporting_line where staff_id = '${w.ownerId}'::uuid`);
    expect((await fetchPhoto(link)).status).toBe(404); // no longer the owner's manager
    await g.prisma.$executeRawUnsafe(`insert into chat.staff_reporting_line (staff_id, manager_id) values ('${w.ownerId}'::uuid, '${w.managerId}'::uuid)`);
    expect((await fetchPhoto(link)).status).toBe(200);
    await g.prisma.$executeRawUnsafe(`update chat.staff set is_active = false, left_at = now() where id = '${w.managerId}'::uuid`);
    expect((await fetchPhoto(link)).status).toBe(403); // the reader is no longer live
  });
});
