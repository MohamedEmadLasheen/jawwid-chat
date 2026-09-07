/**
 * Tenant isolation, and the agreement between the permission model in the
 * database and its TypeScript mirror.
 *
 * Jawwid is the only organization operating today. The point of these tests is
 * that the boundary is REAL rather than hypothetical: a second organization is
 * created here and the first one cannot see it, cannot name it, and cannot
 * reach it by changing an id.
 */
import { randomUUID } from 'node:crypto';
import { buildGraph, seed, truncate, Scenario } from './harness';
import { CommErrorCode } from '@platform/errors';
import { ALL_PERMISSIONS, AuthzRole, ROLE_PERMISSIONS } from '@platform/rbac/permissions';

const g = buildGraph();
let s: Scenario;

const OTHER_ORG = '00000000-0000-0000-0000-0000000000ff';
let alienAdminId: string;
let alienFamilyId: string;
let alienParentId: string;

const actorOf = async (id: string) => (await g.identity.resolveActor(id))!;

async function seedSecondOrganization(): Promise<void> {
  alienAdminId = randomUUID();
  alienFamilyId = randomUUID();
  alienParentId = randomUUID();
  const adminAccount = randomUUID();
  const parentAccount = randomUUID();

  await g.prisma.$executeRawUnsafe(
    `insert into chat.organization (id, slug, display_name)
     values ('${OTHER_ORG}'::uuid, 'other-academy', 'Other Academy')
     on conflict (id) do nothing`,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.account (id, subject, kind, status, organization_id) values
       ('${adminAccount}'::uuid, 'subject_alien_admin', 'staff', 'active', '${OTHER_ORG}'::uuid),
       ('${parentAccount}'::uuid, 'subject_alien_parent', 'family', 'active', '${OTHER_ORG}'::uuid)`,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.staff (id, account_id, name, role, organization_id)
     values ('${alienAdminId}'::uuid, '${adminAccount}'::uuid, 'alien_admin', 'admin', '${OTHER_ORG}'::uuid)`,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.family (id, display_name, owner_id, organization_id)
     values ('${alienFamilyId}'::uuid, 'alien_family', '${alienAdminId}'::uuid, '${OTHER_ORG}'::uuid)`,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.contact (id, account_id, family_id, name, role_preset, can_message,
                               can_view_progress, can_manage_schedule, can_manage_billing,
                               can_manage_contacts, can_cancel, organization_id)
     values ('${alienParentId}'::uuid, '${parentAccount}'::uuid, '${alienFamilyId}'::uuid,
             'alien_parent', 'primary_guardian', true, true, true, true, true, true,
             '${OTHER_ORG}'::uuid)`,
  );
}

beforeAll(async () => {
  await truncate(g.prisma);
  s = await seed(g.prisma);
  await seedSecondOrganization();
});

afterAll(async () => {
  // The organization row is left in place. Every row that referenced it is
  // removed by the next suite's truncate, and deleting the tenant here would
  // race that -- the FK is doing exactly what it should.
  await g.prisma.$disconnect();
});

// -------------------------------------------------------------------------
describe('tenant isolation', () => {
  it('the two organizations exist and the actors carry their own', async () => {
    const jawwid = await actorOf(s.managerId);
    const alien = await actorOf(alienAdminId);
    expect(jawwid.organizationId).not.toBe(alien.organizationId);
    expect(alien.organizationId).toBe(OTHER_ORG);
  });

  it('a MANAGER of one organization does not see the other\'s families', async () => {
    // The strongest case: "organization-wide" is the widest scope in the model,
    // and it still stops at the organization.
    const families = await g.families.list(await actorOf(s.managerId));
    expect(families.map((f) => f.id)).toContain(s.familyId);
    expect(families.map((f) => f.id)).not.toContain(alienFamilyId);
  });

  it('search does not cross the boundary either', async () => {
    expect(await g.families.list(await actorOf(s.managerId), 'alien_family')).toEqual([]);
  });

  it('naming another tenant\'s family id reads as NOT FOUND', async () => {
    await expect(g.families.get(await actorOf(s.managerId), alienFamilyId)).rejects.toMatchObject({
      code: CommErrorCode.CONVERSATION_NOT_FOUND,
    });
  });

  it('a conversation cannot be opened across organizations', async () => {
    // CROSS_TENANT rather than OUT_OF_SCOPE: the two actors are not merely in
    // different scopes, they are in different organizations, and the more
    // specific answer is the more useful one to an operator reading a log.
    await expect(
      g.conversations.getOrCreateDirect(s.ownerId, alienParentId),
    ).rejects.toMatchObject({ code: CommErrorCode.CROSS_TENANT });
    await expect(
      g.conversations.getOrCreateDirect(alienAdminId, s.parentId),
    ).rejects.toMatchObject({ code: CommErrorCode.CROSS_TENANT });
  });

  it('the database refuses a cross-organization child row outright', async () => {
    // Defence in depth: even with the service layer bypassed entirely.
    await expect(
      g.prisma.$executeRawUnsafe(
        `insert into chat.contact (family_id, name, role_preset, can_message, can_view_progress,
                                   can_manage_schedule, can_manage_billing, can_manage_contacts,
                                   can_cancel, organization_id)
         values ('${alienFamilyId}'::uuid, 'smuggled', 'authorized_contact', true, true, true,
                 true, true, true, chat.default_organization_id())`,
      ),
    ).rejects.toThrow(/cross-organization reference/);
  });

  it('account administration is confined to the administrator\'s own organization', async () => {
    const superAccount = await g.prisma.account.findUnique({
      where: { id: s.accounts[s.managerId] },
    });
    // Promote the manager so the users.manage surface is reachable at all.
    await g.prisma.staff.update({ where: { id: s.managerId }, data: { role: 'super_admin' } });
    const superActor = await actorOf(s.managerId);

    const listed = await g.userAdmin.list(superActor);
    expect(listed.map((a) => a.id)).toContain(superAccount!.id);
    expect(listed.map((a) => a.subject)).not.toContain('subject_alien_admin');

    const alienAccount = await g.prisma.account.findFirst({
      where: { subject: 'subject_alien_admin' },
    });
    await expect(g.userAdmin.get(superActor, alienAccount!.id)).rejects.toMatchObject({
      code: 'AUTH.NOT_FOUND',
    });
    await expect(
      g.userAdmin.deactivate(superActor, alienAccount!.id, 'cross-tenant attempt'),
    ).rejects.toMatchObject({ code: 'AUTH.NOT_FOUND' });

    await g.prisma.staff.update({ where: { id: s.managerId }, data: { role: 'manager' } });
  });
});

// -------------------------------------------------------------------------
describe('the permission model in the database and its TypeScript mirror', () => {
  it('the vocabulary matches, key for key', async () => {
    const rows = await g.prisma.permission.findMany({ select: { key: true } });
    expect(rows.map((r) => r.key).sort()).toEqual([...ALL_PERMISSIONS].sort());
  });

  it('the role mapping matches, role for role', async () => {
    const rows = await g.prisma.rolePermission.findMany();
    const fromDatabase: Record<string, string[]> = {};
    for (const row of rows) (fromDatabase[row.role] ??= []).push(row.permission);

    const fromCode: Record<string, string[]> = {};
    for (const [role, keys] of Object.entries(ROLE_PERMISSIONS)) fromCode[role] = [...keys];

    expect(Object.keys(fromDatabase).sort()).toEqual(Object.keys(fromCode).sort());
    for (const role of Object.keys(fromCode)) {
      expect({ role, keys: fromDatabase[role].sort() }).toEqual({
        role,
        keys: fromCode[role].sort(),
      });
    }
  });

  it('the database resolver agrees with the mirror, including on overrides', async () => {
    const accountId = s.accounts[s.ownerId];

    const holds = async (permission: string): Promise<boolean> => {
      const rows = await g.prisma.$queryRawUnsafe<Array<{ ok: boolean }>>(
        `select chat.account_has_permission('${accountId}'::uuid, '${permission}') as ok`,
      );
      return rows[0].ok;
    };

    expect(await holds('messages.send')).toBe(true);
    expect(await holds('users.manage')).toBe(false);

    // A DENY on a permission the role grants.
    await g.prisma.accountPermissionOverride.create({
      data: {
        accountId,
        permission: 'messages.send',
        effect: 'deny',
        reason: 'test: precedence',
      },
    });
    expect(await holds('messages.send')).toBe(false);
    // and the API resolves it the same way, on the very next request
    expect((await actorOf(s.ownerId)).permissions!.has('messages.send')).toBe(false);

    // An ALLOW on one it does not.
    await g.prisma.accountPermissionOverride.create({
      data: { accountId, permission: 'audit.read', effect: 'allow', reason: 'test: precedence' },
    });
    expect(await holds('audit.read')).toBe(true);
    expect((await actorOf(s.ownerId)).permissions!.has('audit.read')).toBe(true);

    await g.prisma.accountPermissionOverride.deleteMany({ where: { accountId } });
    expect(await holds('messages.send')).toBe(true);
  });

  it('a non-active account holds nothing, whatever its role says', async () => {
    const accountId = s.accounts[s.ownerId];
    await g.accounts.suspend(accountId, s.managerId, 'test: suspended');

    const rows = await g.prisma.$queryRawUnsafe<Array<{ ok: boolean }>>(
      `select chat.account_has_permission('${accountId}'::uuid, 'messages.send') as ok`,
    );
    expect(rows[0].ok).toBe(false);
    expect((await actorOf(s.ownerId)).permissions!.size).toBe(0);

    await g.accounts.activate(accountId, s.managerId, 'test: restore');
  });

  it('a departmental staff member resolves to no role and therefore no permissions', async () => {
    await g.prisma.staff.update({
      where: { id: s.otherAdminId },
      data: { department: 'finance' },
    });
    const actor = await actorOf(s.otherAdminId);
    expect(actor.permissions!.size).toBe(0);

    const rows = await g.prisma.$queryRawUnsafe<Array<{ role: string | null }>>(
      `select chat.account_role('${s.accounts[s.otherAdminId]}'::uuid) as role`,
    );
    expect(rows[0].role).toBeNull();

    await g.prisma.staff.update({ where: { id: s.otherAdminId }, data: { department: null } });
  });

  it('every canonical role is representable in the database', async () => {
    for (const role of Object.values(AuthzRole)) {
      const rows = await g.prisma.rolePermission.findMany({ where: { role } });
      expect({ role, granted: rows.length > 0 }).toEqual({ role, granted: true });
    }
  });
});
