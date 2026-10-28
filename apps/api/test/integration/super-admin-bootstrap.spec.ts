import { randomUUID } from 'node:crypto';
import { PrismaService } from '@platform/prisma.service';
import { PrismaIdentityService } from '@platform/identity.service';
import { PrismaAuditService } from '@platform/audit.service';
import { AuthorizationService } from '@platform/authorization.service';
import { AuthService } from '@platform/auth/auth.service';
import { AuthErrorCode } from '@platform/auth/auth.errors';
import { toActorDto } from '@platform/auth/auth.dto';
import { CommErrorCode } from '@platform/errors';
import { ARGON2ID_PREFIX, hashPassword } from '@platform/auth/password';
import { AdminInspectionService } from '../../src/admin/admin-inspection.service';
import {
  BOOTSTRAP_AUDIT_ACTION,
  BootstrapRefusal,
  BootstrapRefusalCode,
  bootstrapSuperAdmin,
} from '../../src/cli/super-admin-bootstrap';
import { PinnedCoverage, seed, truncate } from './harness';

/**
 * The super admin bootstrap, against Postgres (PD-5).
 *
 * What a double cannot prove and this does:
 *   - the CHECK admits `super_admin`, and the guard trigger refuses every
 *     ungated way of acquiring, losing, deleting or re-binding it;
 *   - the bootstrap writes an account the REAL login flow accepts, and /me
 *     reports the role the backend will enforce;
 *   - the /admin inspection surface is scoped to the inspector's organization
 *     and refuses every role but super_admin;
 *   - existing parent/teacher logins are untouched by any of it.
 */
process.env.JWT_ACCESS_SECRET ??= 'integration-access-secret-32-chars-min!';
process.env.JWT_REFRESH_SECRET ??= 'integration-refresh-secret-32-chars-min!';

const PASSWORD = 'an-integration-password-1';
const DOMAIN = 'superadmin.qa.jawwid.test';

describe('super admin bootstrap against Postgres', () => {
  const prisma = new PrismaService();
  const identity = new PrismaIdentityService(prisma);
  const auth = new AuthService(prisma, identity, new PrismaAuditService());
  const authz = new AuthorizationService(new PinnedCoverage(null));
  const inspection = new AdminInspectionService(prisma, authz, identity);

  let email: string;

  async function gated(sql: string): Promise<void> {
    await prisma.$transaction([
      prisma.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`),
      prisma.$executeRawUnsafe(sql),
    ]);
  }

  beforeAll(async () => {
    await prisma.$connect();
  });

  beforeEach(async () => {
    // TRUNCATE fires no row trigger, so the delete guard does not apply to it.
    await truncate(prisma);
    await prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
    email = `owner-${randomUUID().slice(0, 8)}@${DOMAIN}`;
  });

  afterAll(async () => {
    await truncate(prisma);
    await prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
    await prisma.$disconnect();
  });

  // -------------------------------------------------------------------------
  describe('the grant guard', () => {
    it('refuses an ungated INSERT as super_admin', async () => {
      await expect(
        prisma.$executeRawUnsafe(`insert into chat.staff (name, role) values ('x_x', 'super_admin')`),
      ).rejects.toThrow(/granted, revoked and re-bound only by the bootstrap procedure/);
    });

    it('refuses an ungated promotion of an existing manager', async () => {
      const { managerId } = await seed(prisma);
      await expect(
        prisma.$executeRawUnsafe(`update chat.staff set role = 'super_admin' where id = '${managerId}'::uuid`),
      ).rejects.toThrow(/bootstrap procedure/);
      const row = await prisma.staff.findUniqueOrThrow({ where: { id: managerId } });
      expect(row.role).toBe('manager');
    });

    it('refuses an ungated demotion, deletion, or re-binding of the super admin row', async () => {
      const result = await bootstrapSuperAdmin(prisma, { email, password: PASSWORD, displayName: 'owner_o' });
      const staffId = result.staffId as string;
      const intruder = randomUUID();
      await prisma.$executeRawUnsafe(
        `insert into chat.account (id, subject, kind) values ('${intruder}'::uuid, 'intruder@${DOMAIN}', 'staff')`,
      );

      for (const sql of [
        `update chat.staff set role = 'manager' where id = '${staffId}'::uuid`,
        `delete from chat.staff where id = '${staffId}'::uuid`,
        `update chat.staff set account_id = '${intruder}'::uuid where id = '${staffId}'::uuid`,
      ]) {
        await expect(prisma.$executeRawUnsafe(sql)).rejects.toThrow(/bootstrap procedure/);
      }
      const row = await prisma.staff.findUniqueOrThrow({ where: { id: staffId } });
      expect(row.role).toBe('super_admin');
      expect(row.accountId).toBe(result.accountId);
    });

    it('leaves every other staff write alone', async () => {
      const { managerId, ownerId } = await seed(prisma);
      await prisma.$executeRawUnsafe(`update chat.staff set role = 'coverage' where id = '${ownerId}'::uuid`);
      await prisma.$executeRawUnsafe(`update chat.staff set name = 'manager_z' where id = '${managerId}'::uuid`);
      expect((await prisma.staff.findUniqueOrThrow({ where: { id: ownerId } })).role).toBe('coverage');
    });

    it('the gate is transaction-local: it does not outlive the bootstrap', async () => {
      await gated(`select 1`);
      await expect(
        prisma.$executeRawUnsafe(`insert into chat.staff (name, role) values ('x_x', 'super_admin')`),
      ).rejects.toThrow(/bootstrap procedure/);
    });
  });

  // -------------------------------------------------------------------------
  describe('bootstrapSuperAdmin', () => {
    it('creates one staff login, hashed with Argon2id, and audits it without the password', async () => {
      const result = await bootstrapSuperAdmin(prisma, { email, password: PASSWORD, displayName: 'owner_o' });
      expect(result.outcome).toBe('created');
      expect(result.passwordSet).toBe(true);

      const account = await prisma.account.findUniqueOrThrow({
        where: { subject: email },
        include: { staff: true, credential: true },
      });
      expect(account.kind).toBe('staff');
      expect(account.status).toBe('active');
      expect(account.staff?.role).toBe('super_admin');
      expect(account.credential?.passwordHash.startsWith(ARGON2ID_PREFIX)).toBe(true);
      expect(account.credential?.passwordHash).not.toContain(PASSWORD);

      const audit = await prisma.auditLog.findMany({ where: { action: BOOTSTRAP_AUDIT_ACTION } });
      expect(audit).toHaveLength(1);
      expect(audit[0].entityId).toBe(result.staffId);
      const recorded = JSON.stringify([audit[0].before, audit[0].after, audit[0].reason]);
      expect(recorded).not.toContain(PASSWORD);
      expect(recorded).not.toContain(email);
    });

    it('authenticates through the real login flow, and /me says super_admin', async () => {
      await bootstrapSuperAdmin(prisma, { email, password: PASSWORD, displayName: 'owner_o' });

      const pair = await auth.login(email, PASSWORD);
      const me = toActorDto(pair.actor);
      expect(me.kind).toBe('staff');
      expect(me.staffRole).toBe('super_admin');
      expect(me.organizationId).toBe('00000000-0000-0000-0000-000000000001');

      // The token verifies, and resolves to the same principal on every request.
      const session = await auth.authenticate(pair.accessToken);
      expect(session?.actor.staffRole).toBe('super_admin');

      await expect(auth.login(email, 'a-wrong-password-123')).rejects.toMatchObject({
        code: AuthErrorCode.INVALID_CREDENTIALS,
      });
    });

    it('is idempotent: a second run changes nothing and keeps the password', async () => {
      const first = await bootstrapSuperAdmin(prisma, { email, password: PASSWORD, displayName: 'owner_o' });
      const second = await bootstrapSuperAdmin(prisma, {
        email,
        password: 'a-different-password-2',
        displayName: 'owner_o',
      });
      expect(second).toMatchObject({
        outcome: 'already_super_admin',
        accountId: first.accountId,
        staffId: first.staffId,
        passwordSet: false,
      });
      expect(await prisma.account.count({ where: { subject: email } })).toBe(1);
      expect(await prisma.auditLog.count({ where: { action: BOOTSTRAP_AUDIT_ACTION } })).toBe(1);
      await expect(auth.login(email, PASSWORD)).resolves.toBeDefined();
    });

    it('--reset-password replaces the credential and revokes every live session', async () => {
      await bootstrapSuperAdmin(prisma, { email, password: PASSWORD, displayName: 'owner_o' });
      const old = await auth.login(email, PASSWORD);

      const reset = await bootstrapSuperAdmin(prisma, {
        email,
        password: 'a-different-password-2',
        displayName: 'owner_o',
        resetPassword: true,
      });
      expect(reset).toMatchObject({ outcome: 'already_super_admin', passwordSet: true, sessionsRevoked: 1 });
      expect(await auth.authenticate(old.accessToken)).toBeNull();
      await expect(auth.login(email, PASSWORD)).rejects.toMatchObject({
        code: AuthErrorCode.INVALID_CREDENTIALS,
      });
      await expect(auth.login(email, 'a-different-password-2')).resolves.toBeDefined();
    });

    it('PD-40: gives its organization the template roles, once (review of #231)', async () => {
      const org = '00000000-0000-0000-0000-000000000001';
      const templates = () =>
        prisma.$queryRawUnsafe<{ key: string; is_template: boolean }[]>(
          `select key, is_template from chat.access_role where organization_id = '${org}'::uuid and key = 'designer'`,
        );
      // Start from an organization without them, whatever earlier specs left.
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`select set_config('chat.pd040_access_change', 'on', true)`);
        const roles = `select id from chat.access_role where organization_id = '${org}'::uuid and key = 'designer'`;
        await tx.$executeRawUnsafe(`delete from chat.staff_access_role where role_id in (${roles})`);
        await tx.$executeRawUnsafe(`delete from chat.access_role_permission where role_id in (${roles})`);
        await tx.$executeRawUnsafe(`delete from chat.access_role where id in (${roles})`);
      });
      expect(await templates()).toEqual([]);

      const dry = await bootstrapSuperAdmin(prisma, { email, password: PASSWORD, displayName: 'owner_o', dryRun: true });
      expect(dry.templatesSeeded).toBe(0);
      expect(await templates()).toEqual([]);

      const first = await bootstrapSuperAdmin(prisma, { email, password: PASSWORD, displayName: 'owner_o' });
      expect(first.templatesSeeded).toBe(1);
      expect(await templates()).toEqual([{ key: 'designer', is_template: true }]);
      const again = await bootstrapSuperAdmin(prisma, { email, password: PASSWORD, displayName: 'owner_o' });
      expect(again.templatesSeeded).toBe(0);
      expect(await templates()).toEqual([{ key: 'designer', is_template: true }]);
    });

    it('a dry run writes nothing', async () => {
      const result = await bootstrapSuperAdmin(prisma, {
        email,
        password: PASSWORD,
        displayName: 'owner_o',
        dryRun: true,
      });
      expect(result).toMatchObject({ outcome: 'created', dryRun: true, accountId: null });
      expect(await prisma.account.count({ where: { subject: email } })).toBe(0);
    });

    async function refusalOf(promise: Promise<unknown>): Promise<BootstrapRefusal> {
      try {
        await promise;
      } catch (error) {
        if (error instanceof BootstrapRefusal) return error;
        throw error;
      }
      throw new Error('expected a refusal');
    }

    it('never converts a parent or teacher login, and leaves it able to sign in', async () => {
      const { parentId } = await seed(prisma);
      const accountId = randomUUID();
      await prisma.$executeRawUnsafe(
        `insert into chat.account (id, subject, kind) values ('${accountId}'::uuid, '${email}', 'family')`,
      );
      await prisma.$executeRawUnsafe(
        `update chat.contact set account_id = '${accountId}'::uuid where id = '${parentId}'::uuid`,
      );
      await prisma.accountCredential.create({
        data: { accountId, passwordHash: await hashPassword(PASSWORD) },
      });

      const refusal = await refusalOf(
        bootstrapSuperAdmin(prisma, { email, password: 'a-different-password-2', displayName: 'owner_o' }),
      );
      expect(refusal.code).toBe(BootstrapRefusalCode.ACCOUNT_NOT_STAFF);
      expect(await prisma.staff.count({ where: { role: 'super_admin' } })).toBe(0);

      // The parent's login is exactly as it was.
      const pair = await auth.login(email, PASSWORD);
      expect(pair.actor.kind).toBe('contact');
    });

    it('refuses the same address in different letter case', async () => {
      await prisma.$executeRawUnsafe(
        `insert into chat.account (subject, kind) values ('${email.toUpperCase()}', 'staff')`,
      );
      const refusal = await refusalOf(bootstrapSuperAdmin(prisma, { email, password: PASSWORD, displayName: 'o' }));
      expect(refusal.code).toBe(BootstrapRefusalCode.SUBJECT_CASE_CONFLICT);
    });

    it('never grants the role to a second account', async () => {
      await bootstrapSuperAdmin(prisma, { email, password: PASSWORD, displayName: 'owner_o' });
      const refusal = await refusalOf(
        bootstrapSuperAdmin(prisma, { email: `second@${DOMAIN}`, password: PASSWORD, displayName: 'second_s' }),
      );
      expect(refusal.code).toBe(BootstrapRefusalCode.ANOTHER_SUPER_ADMIN);
      expect(await prisma.staff.count({ where: { role: 'super_admin' } })).toBe(1);
      expect(await prisma.account.count({ where: { subject: `second@${DOMAIN}` } })).toBe(0);
    });

    it('promotes an existing staff login only when told to', async () => {
      const { managerId } = await seed(prisma);
      const accountId = randomUUID();
      await prisma.$executeRawUnsafe(
        `insert into chat.account (id, subject, kind) values ('${accountId}'::uuid, '${email}', 'staff')`,
      );
      await prisma.$executeRawUnsafe(
        `update chat.staff set account_id = '${accountId}'::uuid where id = '${managerId}'::uuid`,
      );

      const refusal = await refusalOf(bootstrapSuperAdmin(prisma, { email, password: PASSWORD, displayName: 'o' }));
      expect(refusal.code).toBe(BootstrapRefusalCode.STAFF_HAS_OTHER_ROLE);
      expect((await prisma.staff.findUniqueOrThrow({ where: { id: managerId } })).role).toBe('manager');

      const promoted = await bootstrapSuperAdmin(prisma, {
        email,
        password: PASSWORD,
        displayName: 'o',
        promoteExistingStaff: true,
      });
      expect(promoted).toMatchObject({ outcome: 'promoted', staffId: managerId, passwordSet: true });
      expect((await prisma.staff.findUniqueOrThrow({ where: { id: managerId } })).role).toBe('super_admin');
    });

    it('refuses an inactive account rather than reactivating it', async () => {
      await prisma.$executeRawUnsafe(
        `insert into chat.account (subject, kind, status, is_active, deactivated_at)
         values ('${email}', 'staff', 'suspended', false, now())`,
      );
      const refusal = await refusalOf(bootstrapSuperAdmin(prisma, { email, password: PASSWORD, displayName: 'o' }));
      expect(refusal.code).toBe(BootstrapRefusalCode.ACCOUNT_INACTIVE);
    });
  });

  // -------------------------------------------------------------------------
  describe('the /admin inspection surface', () => {
    it('shows the super admin its organization, and refuses every other role', async () => {
      const scenario = await seed(prisma);
      await prisma.$executeRawUnsafe(
        `insert into chat.conversation (id, type, family_id) values ('${randomUUID()}'::uuid, 'official', '${scenario.familyId}'::uuid)`,
      );
      await bootstrapSuperAdmin(prisma, { email, password: PASSWORD, displayName: 'owner_o' });
      const owner = (await auth.login(email, PASSWORD)).actor;

      const overview = await inspection.overview(owner);
      expect(overview.organization.slug).toBe('jawwid');
      expect(overview.staffByRole).toMatchObject({ super_admin: 1, manager: 1, admin: 2 });
      expect(overview.families).toBe(1);

      const { users } = await inspection.users(owner);
      expect(users.map((u) => u.principalKind).sort()).toEqual(
        expect.arrayContaining(['contact', 'staff', 'teacher']),
      );
      // No login identifier, no credential material, in any row.
      expect(JSON.stringify(users)).not.toContain(email);
      expect(JSON.stringify(users)).not.toContain('argon2');

      const { conversations } = await inspection.conversations(owner);
      expect(conversations).toHaveLength(1);
      await expect(inspection.messages(owner, conversations[0].id)).resolves.toEqual({ messages: [] });

      const manager = await identity.resolveActor(scenario.managerId);
      const parentActor = await identity.resolveActor(scenario.parentId);
      const teacherActor = await identity.resolveActor(scenario.teacherId);
      for (const actor of [manager, parentActor, teacherActor]) {
        await expect(inspection.overview(actor!)).rejects.toMatchObject({
          code: CommErrorCode.ADMIN_INSPECTION_DENIED,
        });
        await expect(inspection.users(actor!)).rejects.toMatchObject({
          code: CommErrorCode.ADMIN_INSPECTION_DENIED,
        });
      }
    });

    it('never crosses into another organization: its conversation is "not found"', async () => {
      await bootstrapSuperAdmin(prisma, { email, password: PASSWORD, displayName: 'owner_o' });
      const owner = (await auth.login(email, PASSWORD)).actor;

      const otherOrg = randomUUID();
      const otherConversation = randomUUID();
      await prisma.$executeRawUnsafe(
        `insert into chat.organization (id, slug, display_name)
         values ('${otherOrg}'::uuid, 'other-${otherOrg.slice(0, 8)}', 'Other org')`,
      );
      await prisma.$executeRawUnsafe(
        `insert into chat.conversation (id, organization_id, type, title)
         values ('${otherConversation}'::uuid, '${otherOrg}'::uuid, 'official', 'other_org_conv')`,
      );

      const { conversations } = await inspection.conversations(owner);
      expect(conversations.map((c) => c.id)).not.toContain(otherConversation);
      await expect(inspection.messages(owner, otherConversation)).rejects.toMatchObject({
        code: CommErrorCode.CONVERSATION_NOT_FOUND,
        status: 404,
      });
      await expect(inspection.messages(owner, 'not-a-uuid')).rejects.toMatchObject({
        code: CommErrorCode.CONVERSATION_NOT_FOUND,
      });

      await prisma.$executeRawUnsafe(`delete from chat.conversation where id = '${otherConversation}'::uuid`);
      await prisma.$executeRawUnsafe(`delete from chat.organization where id = '${otherOrg}'::uuid`);
    });
  });
});
