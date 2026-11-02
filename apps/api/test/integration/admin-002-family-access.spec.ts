/**
 * ADMIN-002 (owner decision 2026-10-31): parent accounts are administered
 * within the caller's staff scope, and exceptional access to ONE family is
 * granted, time-boxed, purpose-bound and logged.
 *
 * The seed's PD-8 structure: manager_c runs Operations; admin_a supervises
 * family_x's children; admin_b is in Operations with no family. family_x's
 * parent signs in.
 *
 *   A   admin_b administers no parent account of family_x (404 on every act);
 *       admin_a does; the Operations Manager and the super admin stay org-wide
 *   B   the Operations Manager grants admin_b family_x for a purpose: every
 *       act is allowed and each writes a 'family_access.used' row carrying
 *       the authorizer, the accessor, the reason and the window
 *   exp past ends_at: 404 again; a support session opened under the grant
 *       ends on its next request; the worker sweep writes 'expired' once
 *   rev the grantor revokes: 404 at once; 'revoked' carries the actual end
 *   who only the Operations Manager or the super admin grants; never to
 *       oneself; to Operations staff only; at most 7 days
 *
 * Synthetic fixtures only (G-16).
 */
import { randomUUID } from 'node:crypto';
import { PrismaAuditService } from '@platform/audit.service';
import { CommError, CommErrorCode } from '@platform/errors';
import { PrismaIdentityService } from '@platform/identity.service';
import { AuthService } from '@platform/auth/auth.service';
import { PasswordResetService } from '@platform/auth/password-reset.service';
import type { Actor } from '@platform/types';
import { AccountAdminService } from '../../src/account-admin/account-admin.service';
import { ImpersonationService } from '../../src/account-admin/impersonation.service';
import { FamilyAccessService } from '../../src/account-admin/family-access.service';
import { buildGraph, seed, truncate, Scenario } from './harness';

const g = buildGraph();
const audit = new PrismaAuditService();
const identity = new PrismaIdentityService(g.prisma);
const auth = new AuthService(g.prisma, identity, audit, undefined, g.authz);
const accounts = new AccountAdminService(g.prisma, g.authz, auth, new PasswordResetService(g.prisma, auth, audit), audit);
const impersonation = new ImpersonationService(g.prisma, g.authz, auth, identity, audit);
const access = new FamilyAccessService(g.prisma, audit);

jest.setTimeout(120_000);

const PASSWORD = 'admin-002-spec-password-1';

let s: Scenario;
let superId: string;
/** family_x's parent account, and admin_b's own (a support session needs a signed-in administrator). */
let parentAccount: string;
let adminBAccount: string;

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof CommError) return e.code;
    throw e;
  }
  throw new Error('expected a refusal, got success');
}

const actor = (id: string): Promise<Actor> => g.conversations.requireActor(id);
const auditRows = (action: string) =>
  g.prisma.auditLog.findMany({ where: { action }, orderBy: { id: 'asc' } });
/** ADMIN-013: the record of a support session's end. */
const endedRows = (impersonationId: string) => g.prisma.auditLog.findMany({ where: { action: 'impersonation.ended', impersonationId } });
/** Moves a grant's window into the past, as time would (the guard forbids it to the application). */
async function expire(grantId: string) {
  await g.prisma.$transaction([
    g.prisma.$executeRawUnsafe(`set local session_replication_role = replica`),
    g.prisma.$executeRawUnsafe(
      `update chat.family_access_grant set starts_at = now() - interval '2 hours', ends_at = now() - interval '1 minute' where id = $1::uuid`,
      grantId,
    ),
  ]);
}

beforeAll(async () => {
  await g.prisma.$connect();
});
afterAll(async () => {
  await truncate(g.prisma);
  await g.prisma.$disconnect();
});
beforeEach(async () => {
  await truncate(g.prisma);
  s = await seed(g.prisma);
  superId = randomUUID();
  await g.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`);
    await tx.$executeRawUnsafe(`insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'root_d', 'super_admin', true)`, superId);
  });
  const parent = await g.prisma.account.create({ data: { subject: `p-${randomUUID()}@acct.test`, kind: 'family', status: 'active', isActive: true } });
  await g.prisma.contact.update({ where: { id: s.parentId }, data: { accountId: parent.id } });
  parentAccount = parent.id;
  const b = await g.prisma.account.create({ data: { subject: `b-${randomUUID()}@acct.test`, kind: 'staff', status: 'active', isActive: true } });
  await g.prisma.staff.update({ where: { id: s.otherAdminId }, data: { accountId: b.id } });
  adminBAccount = b.id;
});

describe('ADMIN-002 A: parent accounts within the staff scope', () => {
  it("an Operations supervisor administers only her families' parent accounts", async () => {
    const b = await actor(s.otherAdminId);
    expect((await accounts.list(b, { kind: 'family' })).accounts.map((a) => a.accountId)).not.toContain(parentAccount);
    expect(await code(accounts.get(b, parentAccount))).toBe(CommErrorCode.ACCOUNT_ADMIN_NOT_FOUND);
    expect(await code(accounts.issuePasswordReset(b, adminBAccount, parentAccount, { reason: 'qa' }))).toBe(CommErrorCode.ACCOUNT_ADMIN_NOT_FOUND);
    expect(await code(accounts.suspend(b, adminBAccount, parentAccount, { reason: 'qa' }))).toBe(CommErrorCode.ACCOUNT_ADMIN_NOT_FOUND);
    expect(await code(accounts.revokeAllSessions(b, adminBAccount, parentAccount, { reason: 'qa' }))).toBe(CommErrorCode.ACCOUNT_ADMIN_NOT_FOUND);
    expect(
      await code(impersonation.start({ actor: b, accountId: adminBAccount, sessionId: randomUUID() }, { accountId: parentAccount, reason: 'qa' })),
    ).toBe(CommErrorCode.ACCOUNT_ADMIN_NOT_FOUND);
    // admin_a supervises family_x: yes.
    expect((await accounts.get(await actor(s.ownerId), parentAccount)).allowed.resetPassword).toBe(true);
  });

  it('the Operations Manager and the super admin stay organization-wide', async () => {
    expect((await accounts.get(await actor(s.managerId), parentAccount)).allowed.suspend).toBe(true);
    expect((await accounts.get(await actor(superId), parentAccount)).allowed.suspend).toBe(true);
  });
});

describe('ADMIN-002 B: exceptional access to one family', () => {
  it('a grant opens every act, and each use is logged with the authorizer, the accessor, the reason and the window', async () => {
    const grant = await access.grant(await actor(s.managerId), { familyId: s.familyId, granteeId: s.otherAdminId, purpose: 'parent locked out, admin_a away', hours: 24 });
    const b = await actor(s.otherAdminId);
    expect((await accounts.list(b, { kind: 'family' })).accounts.map((a) => a.accountId)).toContain(parentAccount);
    expect((await accounts.get(b, parentAccount)).allowed.resetPassword).toBe(true);
    await accounts.issuePasswordReset(b, adminBAccount, parentAccount, { reason: 'locked out' });

    const [granted] = await auditRows('family_access.granted');
    expect(granted).toMatchObject({ actorId: s.managerId, entityId: grant.id, reason: 'parent locked out, admin_a away' });
    expect(granted!.after).toMatchObject({ grantedBy: s.managerId, granteeId: s.otherAdminId, familyId: s.familyId, startsAt: grant.startsAt, endsAt: grant.endsAt });
    const used = await auditRows('family_access.used');
    expect(used.length).toBeGreaterThanOrEqual(2); // the get and the reset
    for (const row of used) {
      expect(row).toMatchObject({ actorId: s.otherAdminId, entityId: grant.id, reason: 'parent locked out, admin_a away' });
      expect(row.after).toMatchObject({ grantedBy: s.managerId, accessorId: s.otherAdminId, startsAt: grant.startsAt, endsAt: grant.endsAt });
    }
    // The grantee sees it, with its expiry.
    expect((await access.list(b)).grants.map((x) => [x.id, x.endsAt])).toEqual([[grant.id, grant.endsAt]]);
  });

  it('past its end: not found again, a support session under it ends on its next request (impersonation.ended, ADMIN-013), and the sweep logs the expiry once', async () => {
    const grant = await access.grant(await actor(s.managerId), { familyId: s.familyId, granteeId: s.otherAdminId, purpose: 'support', hours: 2 });
    await auth.setPassword(adminBAccount, PASSWORD);
    const subject = (await g.prisma.account.findUniqueOrThrow({ where: { id: adminBAccount } })).subject;
    const pair = await auth.login(subject, PASSWORD);
    const b = await actor(s.otherAdminId);
    const support = await impersonation.start({ actor: b, accountId: adminBAccount, sessionId: pair.sessionId }, { accountId: parentAccount, reason: 'support' });
    expect(await auth.authenticate(support.accessToken)).not.toBeNull();

    await expire(grant.id);
    expect(await code(accounts.get(b, parentAccount))).toBe(CommErrorCode.ACCOUNT_ADMIN_NOT_FOUND);
    expect(await auth.authenticate(support.accessToken)).toBeNull();
    expect((await g.prisma.impersonationSession.findUniqueOrThrow({ where: { id: support.session.id } })).endedAt).not.toBeNull();
    // ADMIN-013: on the record, once, as Exit would be.
    await auth.authenticate(support.accessToken);
    const ended = await endedRows(support.session.id);
    expect(ended).toHaveLength(1);
    expect(ended[0]).toMatchObject({ actorId: s.otherAdminId, entityId: parentAccount, reason: "the family is no longer in the administrator's scope" });

    expect(await access.sweepExpired()).toBe(1);
    expect(await access.sweepExpired()).toBe(0);
    const [expired] = await auditRows('family_access.expired');
    expect(expired!.after).toMatchObject({ grantedBy: s.managerId, granteeId: s.otherAdminId, reason: 'support' });
    expect((expired!.after as { endedAt?: string }).endedAt).toBeTruthy();
  });

  it('the grantor revokes it early: not found at once, and the revocation carries the actual end', async () => {
    const grant = await access.grant(await actor(s.managerId), { familyId: s.familyId, granteeId: s.otherAdminId, purpose: 'support', hours: 24 });
    await access.revoke(await actor(s.managerId), grant.id, { reason: 'done early' });
    expect(await code(accounts.get(await actor(s.otherAdminId), parentAccount))).toBe(CommErrorCode.ACCOUNT_ADMIN_NOT_FOUND);
    const [revoked] = await auditRows('family_access.revoked');
    expect(revoked).toMatchObject({ actorId: s.managerId, entityId: grant.id, reason: 'done early' });
    expect((revoked!.after as { endedAt?: string }).endedAt).toBeTruthy();
    expect(await code(access.revoke(await actor(s.managerId), grant.id, { reason: 'again' }))).toBe(CommErrorCode.ACCOUNT_ADMIN_STATE);
  });

  it('only the Operations Manager or the super admin grants; never to oneself; to Operations staff only; at most 7 days', async () => {
    const asks = { familyId: s.familyId, granteeId: s.otherAdminId, purpose: 'support', hours: 24 };
    expect(await code(access.grant(await actor(s.ownerId), asks))).toBe(CommErrorCode.ACCOUNT_ADMIN_DENIED);
    expect(await code(access.grant(await actor(s.managerId), { ...asks, granteeId: s.managerId }))).toBe(CommErrorCode.VALIDATION);
    expect(await code(access.grant(await actor(s.managerId), { ...asks, granteeId: s.teacherId }))).toBe(CommErrorCode.VALIDATION);
    expect(await code(access.grant(await actor(s.managerId), { ...asks, hours: 169 }))).toBe(CommErrorCode.VALIDATION);
    expect(await code(access.grant(await actor(s.managerId), { ...asks, purpose: ' ' }))).toBe(CommErrorCode.VALIDATION);
    expect(await code(access.grant(await actor(s.parentId), asks))).toBe(CommErrorCode.ACCOUNT_ADMIN_DENIED);
    // The super admin may; the default is 24 hours.
    const byRoot = await access.grant(await actor(superId), { familyId: s.familyId, granteeId: s.otherAdminId, purpose: 'support' });
    expect(Date.parse(byRoot.endsAt) - Date.parse(byRoot.startsAt)).toBe(24 * 3_600_000);
    // The database refuses what the API refuses (8 days).
    await expect(
      g.prisma.$executeRawUnsafe(
        `insert into chat.family_access_grant (organization_id, family_id, grantee_id, granted_by, purpose, ends_at)
         values (chat.default_organization_id(), $1::uuid, $2::uuid, $3::uuid, 'x', now() + interval '8 days')`,
        s.familyId, s.otherAdminId, s.managerId,
      ),
    ).rejects.toThrow(/family_access_grant_window/);
  });

  it('the Admin Web needs: a grantor learns who may receive a grant, anyone else only their own; an account row carries its family', async () => {
    const manager = await access.list(await actor(s.managerId));
    expect(manager.canGrant).toBe(true);
    const ids = (manager.grantees ?? []).map((x) => x.id);
    expect(ids).toEqual(expect.arrayContaining([s.ownerId, s.otherAdminId]));
    expect(ids).not.toContain(s.managerId);
    expect(ids).not.toContain(s.teacherId);
    expect((await access.list(await actor(superId))).canGrant).toBe(true);

    const b = await access.list(await actor(s.otherAdminId));
    expect(b).toEqual({ grants: [], canGrant: false });

    expect((await accounts.get(await actor(s.managerId), parentAccount)).familyId).toBe(s.familyId);
  });
});

describe('ADMIN-002 review (#363): the edges', () => {
  /** family_y: a second family (nobody's in the seed), its parent with a sign-in. */
  async function otherFamilyAccount(): Promise<{ familyId: string; accountId: string }> {
    const template = await g.prisma.contact.findUniqueOrThrow({ where: { id: s.parentId } });
    const [{ id: familyId }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `insert into chat.family (display_name, owner_id, language) values ('family_y', $1::uuid, 'ar') returning id::text as id`,
      s.managerId,
    );
    const account = await g.prisma.account.create({ data: { subject: `y-${randomUUID()}@acct.test`, kind: 'family', status: 'active', isActive: true } });
    await g.prisma.contact.create({
      data: {
        familyId, name: 'parent_y', accountId: account.id, rolePreset: template.rolePreset,
        canViewProgress: true, canManageSchedule: true, canManageBilling: true, canManageContacts: true, canCancel: true,
      },
    });
    return { familyId, accountId: account.id };
  }
  const grantB = (hours = 24) =>
    actor(s.managerId).then((m) => access.grant(m, { familyId: s.familyId, granteeId: s.otherAdminId, purpose: 'support', hours }));

  it('a grant for family_x opens family_x only: family_y stays not found, in the list and by id', async () => {
    const y = await otherFamilyAccount();
    expect(y.familyId).not.toBe(s.familyId);
    await grantB();
    const b = await actor(s.otherAdminId);
    const listed = (await accounts.list(b, { kind: 'family' })).accounts.map((a) => a.accountId);
    expect(listed).toContain(parentAccount);
    expect(listed).not.toContain(y.accountId);
    expect(await code(accounts.get(b, y.accountId))).toBe(CommErrorCode.ACCOUNT_ADMIN_NOT_FOUND);
  });

  it('out of scope and absent read word for word the same', async () => {
    const b = await actor(s.otherAdminId);
    const message = async (p: Promise<unknown>) => p.then(() => 'allowed', (e: CommError) => `${e.code} ${e.message}`);
    const outOfScope = await message(accounts.get(b, parentAccount));
    expect(outOfScope).toBe(await message(accounts.get(b, randomUUID())));
    expect(await message(impersonation.start({ actor: b, accountId: adminBAccount, sessionId: randomUUID() }, { accountId: parentAccount, reason: 'x' })))
      .toBe(await message(impersonation.start({ actor: b, accountId: adminBAccount, sessionId: randomUUID() }, { accountId: randomUUID(), reason: 'x' })));
  });

  it('viewing the Accounts list under a grant is a use: one "used" row (act list) per grant per request, none for a family reached anyway', async () => {
    const grant = await grantB();
    await accounts.list(await actor(s.otherAdminId), { kind: 'family' });
    const used = (await auditRows('family_access.used')).filter((r) => (r.after as { act?: string }).act === 'list');
    expect(used).toHaveLength(1);
    expect(used[0]).toMatchObject({ actorId: s.otherAdminId, entityId: grant.id, reason: 'support' });
    expect(used[0]!.after).toMatchObject({ grantedBy: s.managerId, accessorId: s.otherAdminId, accountIds: [parentAccount] });

    // admin_a reaches family_x on her own: her list uses no grant.
    await accounts.list(await actor(s.ownerId), { kind: 'family' });
    expect((await auditRows('family_access.used')).filter((r) => (r.after as { act?: string }).act === 'list')).toHaveLength(1);
  });

  it('only the Operations Manager or the super admin grants: an Operations supervisor and the grantee are refused', async () => {
    const asks = { familyId: s.familyId, granteeId: s.otherAdminId, purpose: 'support' };
    expect(await code(access.grant(await actor(s.ownerId), asks))).toBe(CommErrorCode.ACCOUNT_ADMIN_DENIED);
    expect(await code(access.grant(await actor(s.otherAdminId), { ...asks, granteeId: s.ownerId }))).toBe(CommErrorCode.ACCOUNT_ADMIN_DENIED);
  });

  it('the database refuses what the API refuses: a self-grant, a non-manager grantor and a grant across organizations, on a direct insert', async () => {
    const insert = (org: string, grantee: string, grantor: string) =>
      g.prisma.$executeRawUnsafe(
        `insert into chat.family_access_grant (organization_id, family_id, grantee_id, granted_by, purpose, ends_at)
         values (${org}, $1::uuid, $2::uuid, $3::uuid, 'x', now() + interval '1 hour')`,
        s.familyId, grantee, grantor,
      );
    const home = 'chat.default_organization_id()';
    await expect(insert(home, s.otherAdminId, s.otherAdminId)).rejects.toThrow(/Operations Manager or the super admin|family_access_grant_not_self/);
    await expect(insert(home, s.managerId, s.managerId)).rejects.toThrow(/live Operations staff member|family_access_grant_not_self/);
    await expect(insert(home, s.otherAdminId, s.ownerId)).rejects.toThrow(/only the Operations Manager or the super admin/);
    const [{ id: other }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `insert into chat.organization (slug, display_name) values ('admin002-${randomUUID().slice(0, 8)}', 'Other') returning id::text as id`,
    );
    await expect(insert(`'${other}'::uuid`, s.otherAdminId, superId)).rejects.toThrow(/organization|Operations staff member/);
    expect(await g.prisma.familyAccessGrant.count()).toBe(0);
  });

  it('a revoke is the grantor\'s (or a grantor\'s): an Operations supervisor and the grantee get not found', async () => {
    const grant = await grantB();
    expect(await code(access.revoke(await actor(s.ownerId), grant.id, { reason: 'x' }))).toBe(CommErrorCode.ACCOUNT_ADMIN_NOT_FOUND);
    expect(await code(access.revoke(await actor(s.otherAdminId), grant.id, { reason: 'x' }))).toBe(CommErrorCode.ACCOUNT_ADMIN_NOT_FOUND);
    expect((await g.prisma.familyAccessGrant.findUniqueOrThrow({ where: { id: grant.id } })).revokedAt).toBeNull();
    // The super admin may revoke what the Operations Manager granted.
    expect((await access.revoke(await actor(superId), grant.id, { reason: 'closing it' })).status).toBe('revoked');
  });

  it('two revokes at once: one revokes, the other is a 409 -- never a 500 -- and one revoked row is logged', async () => {
    const grant = await grantB();
    const m = await actor(s.managerId);
    const outcomes = await Promise.all([
      access.revoke(m, grant.id, { reason: 'one' }).then(() => 'ok', (e: CommError) => e.code),
      access.revoke(await actor(superId), grant.id, { reason: 'two' }).then(() => 'ok', (e: CommError) => e.code),
    ]);
    expect(outcomes.sort()).toEqual([CommErrorCode.ACCOUNT_ADMIN_STATE, 'ok'].sort());
    expect(await auditRows('family_access.revoked')).toHaveLength(1);
  });

  it('a support session opened before a revoke ends on its next request, with an impersonation.ended row (ADMIN-013)', async () => {
    const grant = await grantB();
    await auth.setPassword(adminBAccount, PASSWORD);
    const subject = (await g.prisma.account.findUniqueOrThrow({ where: { id: adminBAccount } })).subject;
    const pair = await auth.login(subject, PASSWORD);
    const support = await impersonation.start(
      { actor: await actor(s.otherAdminId), accountId: adminBAccount, sessionId: pair.sessionId },
      { accountId: parentAccount, reason: 'support' },
    );
    expect(await auth.authenticate(support.accessToken)).not.toBeNull();
    await access.revoke(await actor(s.managerId), grant.id, { reason: 'resolved' });
    expect(await auth.authenticate(support.accessToken)).toBeNull();
    expect((await g.prisma.impersonationSession.findUniqueOrThrow({ where: { id: support.session.id } })).endedAt).not.toBeNull();
    // ADMIN-013: the end is on the record, once.
    await auth.authenticate(support.accessToken);
    const ended = await endedRows(support.session.id);
    expect(ended).toHaveLength(1);
    expect(ended[0]).toMatchObject({ actorId: s.otherAdminId, entityId: parentAccount, reason: "the family is no longer in the administrator's scope" });
  });

  it('a grant ends once: revoked, then past its end, the sweep logs no expiry', async () => {
    const grant = await grantB();
    await access.revoke(await actor(s.managerId), grant.id, { reason: 'resolved' });
    await expire(grant.id);
    expect(await access.sweepExpired()).toBe(0);
    expect(await auditRows('family_access.expired')).toHaveLength(0);
    // And the other order: expired and swept, a revoke is a 409.
    const later = await grantB();
    await expire(later.id);
    expect(await access.sweepExpired()).toBe(1);
    expect(await code(access.revoke(await actor(s.managerId), later.id, { reason: 'late' }))).toBe(CommErrorCode.ACCOUNT_ADMIN_STATE);
    expect(await auditRows('family_access.revoked')).toHaveLength(1);
  });

  it('a Sales manager who is also an Operations member keeps the Sales manager\'s reach', async () => {
    // PD-8's guards forbid this today (a member is admin or coverage; a manager is
    // a manager; one department each), so it is built past them: the narrowing
    // must not depend on them -- only an Operations role narrows.
    const salesManager = randomUUID();
    await g.prisma.$transaction([
      g.prisma.$executeRawUnsafe(`set local session_replication_role = replica`),
      g.prisma.$executeRawUnsafe(
        `insert into chat.staff (id, organization_id, name, role, is_active) values ($1::uuid, chat.default_organization_id(), 'sales_m', 'manager', true)`,
        salesManager,
      ),
      g.prisma.$executeRawUnsafe(
        `insert into chat.department (organization_id, kind, display_name, manager_id) values (chat.default_organization_id(), 'sales', 'sales', $1::uuid)`,
        salesManager,
      ),
      g.prisma.$executeRawUnsafe(
        `insert into chat.department_member (staff_id, organization_id, department_id, position)
         select $1::uuid, chat.default_organization_id(), d.id, 'supervisor' from chat.department d
          where d.kind = 'operations' and d.organization_id = chat.default_organization_id()`,
        salesManager,
      ),
    ]);
    // family_x is admin_a's, not theirs; the Sales manager's rule reaches it all the same.
    expect((await accounts.get(await actor(salesManager), parentAccount)).allowed.resetPassword).toBe(true);
  });
});
