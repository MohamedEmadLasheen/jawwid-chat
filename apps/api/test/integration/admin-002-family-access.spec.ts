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

  it('past its end: not found again, a support session under it ends on its next request, and the sweep logs the expiry once', async () => {
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
});
