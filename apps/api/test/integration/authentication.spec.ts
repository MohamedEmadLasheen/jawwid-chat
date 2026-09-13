import { randomUUID } from 'node:crypto';
import { PrismaService } from '@platform/prisma.service';
import { PrismaIdentityService } from '@platform/identity.service';
import { PrismaAuditService } from '@platform/audit.service';
import { AuthService } from '@platform/auth/auth.service';
import { AuthErrorCode } from '@platform/auth/auth.errors';
import { ARGON2ID_PREFIX } from '@platform/auth/password';

/**
 * Authentication against the REAL database (PR-B).
 *
 * The unit suites prove the rules with a double. This one proves they hold
 * against Postgres, where the constraints PR-A wrote are actually enforced:
 * `session.refresh_token_hash UNIQUE`, `session_revocation_is_complete`,
 * `account_status_matches_is_active`, and the foreign keys that make an
 * account's principal real.
 *
 * It also proves the thing a double cannot: that the Prisma models PR-B
 * touches -- including `staff.account_id`, which existed in SQL but was
 * missing from schema.prisma -- map to columns that exist.
 */
process.env.JWT_ACCESS_SECRET ??= 'integration-access-secret-32-chars-min!';
process.env.JWT_REFRESH_SECRET ??= 'integration-refresh-secret-32-chars-min!';

const PASSWORD = 'an-integration-password-1';

describe('authentication against Postgres', () => {
  const prisma = new PrismaService();
  const auth = new AuthService(prisma, new PrismaIdentityService(prisma), new PrismaAuditService());

  const org = randomUUID();
  const ids = {
    staffAccount: randomUUID(),
    staff: randomUUID(),
    contactAccount: randomUUID(),
    contact: randomUUID(),
    family: randomUUID(),
    teacherAccount: randomUUID(),
    teacher: randomUUID(),
  };

  beforeAll(async () => {
    await prisma.$connect();

    await prisma.$executeRawUnsafe(
      `insert into chat.organization (id, slug, display_name)
       values ('${org}'::uuid, 'prb-${org.slice(0, 8)}', 'PR-B test org')`,
    );

    // Three accounts, one per principal kind, so the kind -> table routing is
    // exercised for real rather than asserted.
    for (const [id, kind, subject] of [
      [ids.staffAccount, 'staff', `staff-${org.slice(0, 8)}`],
      [ids.contactAccount, 'family', `parent-${org.slice(0, 8)}`],
      [ids.teacherAccount, 'teacher', `teacher-${org.slice(0, 8)}`],
    ] as const) {
      await prisma.$executeRawUnsafe(
        `insert into chat.account (id, organization_id, subject, kind, status, is_active)
         values ('${id}'::uuid, '${org}'::uuid, '${subject}', '${kind}', 'active', true)`,
      );
    }

    await prisma.$executeRawUnsafe(
      `insert into chat.staff (id, organization_id, name, role, account_id)
       values ('${ids.staff}'::uuid, '${org}'::uuid, 'manager_m', 'manager', '${ids.staffAccount}'::uuid)`,
    );
    // The family is owned by the staff row above -- chat.family.owner_id is NOT NULL.
    await prisma.$executeRawUnsafe(
      `insert into chat.family (id, organization_id, display_name, owner_id, language)
       values ('${ids.family}'::uuid, '${org}'::uuid, 'family_f', '${ids.staff}'::uuid, 'ar')`,
    );
    await prisma.$executeRawUnsafe(
      `insert into chat.contact
         (id, organization_id, family_id, name, role_preset, can_message, account_id)
       values ('${ids.contact}'::uuid, '${org}'::uuid, '${ids.family}'::uuid, 'parent_p',
               'primary_guardian', true, '${ids.contactAccount}'::uuid)`,
    );
    await prisma.$executeRawUnsafe(
      `insert into chat.teacher (id, organization_id, name, is_active, account_id)
       values ('${ids.teacher}'::uuid, '${org}'::uuid, 'teacher_t', true, '${ids.teacherAccount}'::uuid)`,
    );

    for (const accountId of [ids.staffAccount, ids.contactAccount, ids.teacherAccount]) {
      await auth.setPassword(accountId, PASSWORD);
    }
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(`delete from chat.session where organization_id = '${org}'::uuid`);
    await prisma.$executeRawUnsafe(`delete from chat.device where organization_id = '${org}'::uuid`);
    await prisma.$executeRawUnsafe(`delete from chat.teacher where organization_id = '${org}'::uuid`);
    await prisma.$executeRawUnsafe(`delete from chat.contact where organization_id = '${org}'::uuid`);
    await prisma.$executeRawUnsafe(`delete from chat.family where organization_id = '${org}'::uuid`);
    await prisma.$executeRawUnsafe(`delete from chat.staff where organization_id = '${org}'::uuid`);
    await prisma.$executeRawUnsafe(
      `delete from chat.account_credential where account_id in
         ('${ids.staffAccount}'::uuid, '${ids.contactAccount}'::uuid, '${ids.teacherAccount}'::uuid)`,
    );
    await prisma.$executeRawUnsafe(`delete from chat.account where organization_id = '${org}'::uuid`);
    await prisma.$executeRawUnsafe(`delete from chat.organization where id = '${org}'::uuid`);
    await prisma.$disconnect();
  });

  it('stores an Argon2id hash and never the password', async () => {
    const credential = await prisma.accountCredential.findUnique({
      where: { accountId: ids.staffAccount },
    });
    expect(credential!.passwordHash.startsWith(ARGON2ID_PREFIX)).toBe(true);
    expect(credential!.passwordHash).toContain('m=19456,t=2,p=1');
    expect(credential!.passwordHash).not.toContain(PASSWORD);
  });

  it('resolves a STAFF account through chat.staff.account_id', async () => {
    const pair = await auth.login(`staff-${org.slice(0, 8)}`, PASSWORD);
    expect(pair.actor).toMatchObject({
      actorId: ids.staff,
      kind: 'staff',
      displayName: 'manager_m',
      staffRole: 'manager',
      organizationId: org,
    });
  });

  it('resolves a CONTACT account, with the family and the capability flag', async () => {
    const pair = await auth.login(`parent-${org.slice(0, 8)}`, PASSWORD);
    expect(pair.actor).toMatchObject({
      actorId: ids.contact,
      kind: 'contact',
      displayName: 'parent_p',
      familyId: ids.family,
      canMessage: true,
      organizationId: org,
    });
  });

  it('resolves a TEACHER from chat.teacher, with a real name -- not the literal "Teacher"', async () => {
    const pair = await auth.login(`teacher-${org.slice(0, 8)}`, PASSWORD);
    expect(pair.actor).toMatchObject({
      actorId: ids.teacher,
      kind: 'teacher',
      displayName: 'teacher_t',
      isActive: true,
    });
    expect(pair.actor.displayName).not.toBe('Teacher');
    expect(pair.actor.staffRole).toBeUndefined();
  });

  it('the full bearer chain resolves the same actor the login returned', async () => {
    const pair = await auth.login(`parent-${org.slice(0, 8)}`, PASSWORD);
    const authenticated = await auth.authenticate(pair.accessToken);

    expect(authenticated).not.toBeNull();
    expect(authenticated!.actor.actorId).toBe(ids.contact);
    expect(authenticated!.claims.sub).toBe(`parent-${org.slice(0, 8)}`);
    expect(authenticated!.accountId).toBe(ids.contactAccount);
  });

  it('the session row is written with a hashed refresh token and no plaintext', async () => {
    const pair = await auth.login(`parent-${org.slice(0, 8)}`, PASSWORD, {
      ip: '198.51.100.4',
      userAgent: 'jest',
      device: { platform: 'ios', name: 'iPhone' },
    });

    const row = await prisma.session.findUnique({ where: { id: pair.sessionId } });
    expect(row!.refreshTokenHash).not.toBe(pair.refreshToken);
    expect(row!.ipHash).not.toContain('198.51.100.4');
    expect(row!.deviceId).toBeTruthy();

    const device = await prisma.device.findUnique({ where: { id: row!.deviceId! } });
    expect(device).toMatchObject({ platform: 'ios', name: 'iPhone', accountId: ids.contactAccount });

    // REGRESSION. The organization must be the ACCOUNT'S, not the column
    // default. chat.device.organization_id and chat.session.organization_id both
    // default to chat.default_organization_id(), which is the default tenant --
    // so leaving it to the default stamps every row of every other organization
    // with the wrong one, and the restrictive
    // `organization_id = chat.current_organization_id()` policy hides the row
    // from the tenant that owns it the moment RLS is engaged. Found by this
    // test, which is why it asserts an id rather than "not null".
    expect(device!.organizationId).toBe(org);
    expect(row!.organizationId).toBe(org);
  });

  it('refresh rotates against the real UNIQUE constraint, and the old token dies', async () => {
    const first = await auth.login(`parent-${org.slice(0, 8)}`, PASSWORD);
    const second = await auth.refresh(first.refreshToken);

    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(await auth.authenticate(first.accessToken)).toBeNull();
    expect(await auth.authenticate(second.accessToken)).not.toBeNull();

    const retired = await prisma.session.findUnique({ where: { id: first.sessionId } });
    expect(retired!.revokedReason).toBe('rotated');
  });

  it('revocation satisfies session_revocation_is_complete -- the DB requires a reason', async () => {
    const pair = await auth.login(`parent-${org.slice(0, 8)}`, PASSWORD);
    await auth.logout(pair.sessionId);

    const row = await prisma.session.findUnique({ where: { id: pair.sessionId } });
    expect(row!.revokedAt).not.toBeNull();
    expect(row!.revokedReason).toBe('logout');
    expect(await auth.authenticate(pair.accessToken)).toBeNull();
  });

  it('a suspended account cannot log in -- and the DB forbids the inconsistent state', async () => {
    // account_status_matches_is_active: is_active must equal (status='active').
    await expect(
      prisma.$executeRawUnsafe(
        `update chat.account set status = 'suspended' where id = '${ids.staffAccount}'::uuid`,
      ),
    ).rejects.toThrow();

    await prisma.$executeRawUnsafe(
      `update chat.account set status = 'suspended', is_active = false where id = '${ids.staffAccount}'::uuid`,
    );
    await expect(auth.login(`staff-${org.slice(0, 8)}`, PASSWORD)).rejects.toMatchObject({
      code: AuthErrorCode.ACCOUNT_DISABLED,
    });

    await prisma.$executeRawUnsafe(
      `update chat.account set status = 'active', is_active = true where id = '${ids.staffAccount}'::uuid`,
    );
  });

  it('an offboarded teacher loses a live session at once', async () => {
    const pair = await auth.login(`teacher-${org.slice(0, 8)}`, PASSWORD);
    expect(await auth.authenticate(pair.accessToken)).not.toBeNull();

    await prisma.$executeRawUnsafe(
      `update chat.teacher set is_active = false, left_at = now() where id = '${ids.teacher}'::uuid`,
    );

    // The access token is untouched and unexpired; the principal is gone.
    expect(await auth.authenticate(pair.accessToken)).toBeNull();
    await expect(auth.refresh(pair.refreshToken)).rejects.toMatchObject({
      code: AuthErrorCode.ACCOUNT_DISABLED,
    });

    await prisma.$executeRawUnsafe(
      `update chat.teacher set is_active = true, left_at = null where id = '${ids.teacher}'::uuid`,
    );
  });

  it('an unknown subject and a wrong password are indistinguishable', async () => {
    const unknown = await auth.login('no-such-subject-at-all', PASSWORD).catch((e: Error) => e);
    const wrong = await auth.login(`parent-${org.slice(0, 8)}`, 'wrong').catch((e: Error) => e);

    expect((unknown as unknown as { code: string }).code).toBe(AuthErrorCode.INVALID_CREDENTIALS);
    expect((wrong as unknown as { code: string }).code).toBe(AuthErrorCode.INVALID_CREDENTIALS);
    expect((unknown as Error).message).toBe((wrong as Error).message);

    await prisma.accountCredential.update({
      where: { accountId: ids.contactAccount },
      data: { failedAttempts: 0, lockedUntil: null },
    });
  });
});
