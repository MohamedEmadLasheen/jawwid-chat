import { randomUUID } from 'node:crypto';
import { PrismaService } from '@platform/prisma.service';
import { PrismaIdentityService } from '@platform/identity.service';
import { PrismaAuditService } from '@platform/audit.service';
import { AUDIT_ACTION, AUTH_EVENT, AuthService, REUSE_REASON } from '@platform/auth/auth.service';
import { subjectHash } from '@platform/auth/subject-hash';

/**
 * The authentication audit trail, against the REAL database.
 *
 * The unit suite proves the service calls the audit seam. This proves the ROWS
 * land in chat.audit_log and chat.event_log -- through the real
 * PrismaAuditService, inside real Prisma transactions, against the real CHECK
 * constraints. In particular `event_log_type_check` is a closed vocabulary, so
 * a wrong event name fails here in a way no double can simulate.
 *
 * IDENTITY-MODEL §6 and API-CONTRACT §3.1 are the contract under test.
 */
process.env.JWT_ACCESS_SECRET ??= 'integration-access-secret-32-chars-min!';
process.env.JWT_REFRESH_SECRET ??= 'integration-refresh-secret-32-chars-min!';

const PASSWORD = 'an-integration-password-1';

describe('the authentication audit trail against Postgres', () => {
  const prisma = new PrismaService();
  const auth = new AuthService(prisma, new PrismaIdentityService(prisma), new PrismaAuditService());

  const org = randomUUID();
  const ids = { account: randomUUID(), staff: randomUUID(), family: randomUUID(), contact: randomUUID() };
  const subject = `audit-${org.slice(0, 8)}`;

  /** Only the rows this spec produced: the log tables are append-only and shared. */
  const auditRows = (action?: string) =>
    prisma.auditLog.findMany({
      where: {
        ...(action ? { action } : {}),
        OR: [{ entityId: ids.account }, { actorId: ids.contact }],
      },
      orderBy: { at: 'asc' },
    });

  const eventRows = (type: string) =>
    prisma.$queryRawUnsafe<Array<{ type: string; actor_type: string; actor_id: string | null; payload: unknown }>>(
      `select type, actor_type, actor_id, payload from chat.event_log
        where type = $1 and payload->>'accountId' = $2 order by at asc`,
      type,
      ids.account,
    );

  beforeAll(async () => {
    await prisma.$connect();
    await prisma.$executeRawUnsafe(
      `insert into chat.organization (id, slug, display_name)
       values ('${org}'::uuid, 'aud-${org.slice(0, 8)}', 'audit test org')`,
    );
    await prisma.$executeRawUnsafe(
      `insert into chat.account (id, organization_id, subject, kind, status, is_active)
       values ('${ids.account}'::uuid, '${org}'::uuid, '${subject}', 'family', 'active', true)`,
    );
    await prisma.$executeRawUnsafe(
      `insert into chat.staff (id, organization_id, name, role)
       values ('${ids.staff}'::uuid, '${org}'::uuid, 'owner_o', 'manager')`,
    );
    await prisma.$executeRawUnsafe(
      `insert into chat.family (id, organization_id, display_name, owner_id, language)
       values ('${ids.family}'::uuid, '${org}'::uuid, 'family_f', '${ids.staff}'::uuid, 'ar')`,
    );
    await prisma.$executeRawUnsafe(
      `insert into chat.contact
         (id, organization_id, family_id, name, role_preset, can_message, account_id)
       values ('${ids.contact}'::uuid, '${org}'::uuid, '${ids.family}'::uuid, 'parent_p',
               'primary_guardian', true, '${ids.account}'::uuid)`,
    );
    await auth.setPassword(ids.account, PASSWORD);
  });

  afterAll(async () => {
    // The log rows are deliberately NOT cleaned up: chat.audit_log and
    // chat.event_log carry BEFORE DELETE OR UPDATE triggers
    // (chat.forbid_mutation), so they are append-only and the database refuses
    // to remove them. That is the point of an audit trail, and it is why these
    // rows are written with a random per-run organization and account id --
    // they are inert once the run ends, and they name nothing that still
    // exists. Neither table has a foreign key to the rows deleted below, so
    // leaving them does not block the rest of this cleanup.
    await prisma.$executeRawUnsafe(`delete from chat.session where organization_id = '${org}'::uuid`);
    await prisma.$executeRawUnsafe(`delete from chat.device where organization_id = '${org}'::uuid`);
    await prisma.$executeRawUnsafe(`delete from chat.contact where organization_id = '${org}'::uuid`);
    await prisma.$executeRawUnsafe(`delete from chat.family where organization_id = '${org}'::uuid`);
    await prisma.$executeRawUnsafe(`delete from chat.staff where organization_id = '${org}'::uuid`);
    await prisma.$executeRawUnsafe(`delete from chat.account_credential where account_id = '${ids.account}'::uuid`);
    await prisma.$executeRawUnsafe(`delete from chat.account where organization_id = '${org}'::uuid`);
    await prisma.$executeRawUnsafe(`delete from chat.organization where id = '${org}'::uuid`);
    await prisma.$disconnect();
  });

  it('the database admits the two canonical auth event types — and nothing else with an auth prefix', async () => {
    // 20260912090000 extended event_log_type_check. If that migration is
    // missing, every other test in this file fails with a constraint violation
    // rather than a confusing absence of rows -- so assert it first.
    const [{ def }] = await prisma.$queryRawUnsafe<Array<{ def: string }>>(
      `select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'event_log_type_check'`,
    );
    expect(def).toContain(AUTH_EVENT.LOGIN_FAILED);
    expect(def).toContain(AUTH_EVENT.REFRESH_REUSE_DETECTED);

    // The vocabulary stayed closed: an invented name is still refused.
    await expect(
      prisma.$executeRawUnsafe(
        `insert into chat.event_log (actor_type, type, payload) values ('system', 'auth.made_up', '{}'::jsonb)`,
      ),
    ).rejects.toThrow();
  });

  it('a successful login persists session.created in chat.audit_log', async () => {
    const pair = await auth.login(subject, PASSWORD);

    const rows = await prisma.auditLog.findMany({
      where: { action: AUDIT_ACTION.SESSION_CREATED, entityId: pair.sessionId },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorId: ids.contact,
      entity: 'session',
      entityId: pair.sessionId,
      reason: 'login',
    });
    // The row points at a session that really exists.
    expect(await prisma.session.findUnique({ where: { id: pair.sessionId } })).not.toBeNull();
  });

  it('a failed login persists auth.login_failed with a hashed subject and no credential material', async () => {
    await auth.login(subject, 'the-wrong-password').catch(() => undefined);

    const rows = await eventRows(AUTH_EVENT.LOGIN_FAILED);
    expect(rows.length).toBeGreaterThan(0);

    const row = rows[rows.length - 1];
    expect(row.actor_type).toBe('system');
    expect(row.actor_id).toBeNull();
    expect(row.payload).toMatchObject({
      subjectHash: subjectHash(subject),
      reason: 'invalid_credentials',
    });

    const serialised = JSON.stringify(row);
    expect(serialised).not.toContain('the-wrong-password');
    expect(serialised).not.toContain(subject);
    expect(serialised).not.toContain('argon2id');

    await prisma.accountCredential.update({
      where: { accountId: ids.account },
      data: { failedAttempts: 0, lockedUntil: null },
    });
  });

  it('the failure counter and its event committed together', async () => {
    await prisma.accountCredential.update({
      where: { accountId: ids.account },
      data: { failedAttempts: 0, lockedUntil: null },
    });
    const before = (await eventRows(AUTH_EVENT.LOGIN_FAILED)).length;

    await auth.login(subject, 'wrong-again').catch(() => undefined);

    const credential = await prisma.accountCredential.findUnique({ where: { accountId: ids.account } });
    expect(credential!.failedAttempts).toBe(1);
    expect((await eventRows(AUTH_EVENT.LOGIN_FAILED)).length).toBe(before + 1);

    await prisma.accountCredential.update({
      where: { accountId: ids.account },
      data: { failedAttempts: 0, lockedUntil: null },
    });
  });

  it('logout persists session.revoked, and a second logout persists nothing more', async () => {
    const pair = await auth.login(subject, PASSWORD);
    await auth.logout(pair.sessionId, pair.actor.actorId);

    const after = await prisma.auditLog.findMany({
      where: { action: AUDIT_ACTION.SESSION_REVOKED, entityId: pair.sessionId },
    });
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ entity: 'session', reason: 'logout', actorId: ids.contact });

    await auth.logout(pair.sessionId, pair.actor.actorId);
    expect(
      await prisma.auditLog.findMany({
        where: { action: AUDIT_ACTION.SESSION_REVOKED, entityId: pair.sessionId },
      }),
    ).toHaveLength(1);
  });

  it('a rotation persists both the revocation and the creation', async () => {
    const first = await auth.login(subject, PASSWORD);
    const second = await auth.refresh(first.refreshToken);

    expect(
      await prisma.auditLog.findMany({
        where: { action: AUDIT_ACTION.SESSION_REVOKED, entityId: first.sessionId, reason: 'rotated' },
      }),
    ).toHaveLength(1);
    expect(
      await prisma.auditLog.findMany({
        where: { action: AUDIT_ACTION.SESSION_CREATED, entityId: second.sessionId, reason: 'refresh' },
      }),
    ).toHaveLength(1);

    await auth.revokeAllForAccount(ids.account, 'test cleanup');
  });

  it('REFRESH REUSE: the sweep and its record commit together', async () => {
    const first = await auth.login(subject, PASSWORD);
    const alsoLive = await auth.login(subject, PASSWORD, { device: { platform: 'web' } });
    const second = await auth.refresh(first.refreshToken);

    const eventsBefore = (await eventRows(AUTH_EVENT.REFRESH_REUSE_DETECTED)).length;

    // Replay the token that rotation retired.
    await expect(auth.refresh(first.refreshToken)).rejects.toMatchObject({
      code: 'AUTH.SESSION_REVOKED',
    });

    // Every live session on the account is gone...
    const live = await prisma.session.findMany({ where: { accountId: ids.account, revokedAt: null } });
    expect(live).toHaveLength(0);
    expect(await auth.authenticate(second.accessToken)).toBeNull();
    expect(await auth.authenticate(alsoLive.accessToken)).toBeNull();

    // ...and the durable record exists. Not a log line: a row.
    const events = await eventRows(AUTH_EVENT.REFRESH_REUSE_DETECTED);
    expect(events.length).toBe(eventsBefore + 1);
    expect(events[events.length - 1]).toMatchObject({ actor_type: 'system', actor_id: null });
    expect(events[events.length - 1].payload).toMatchObject({
      accountId: ids.account,
      sessionId: first.sessionId,
    });

    const audit = await auditRows(AUDIT_ACTION.SESSION_REVOKED);
    expect(audit.some((r) => r.reason === REUSE_REASON && r.entityId === ids.account)).toBe(true);

    // And no token or token hash was written anywhere. (chat.audit_log.id is a
    // bigint, which JSON.stringify refuses without a replacer.)
    const serialised = JSON.stringify([events, audit], (_k, v) =>
      typeof v === 'bigint' ? v.toString() : v,
    );
    expect(serialised).not.toContain(first.refreshToken);
    expect(serialised).not.toContain(second.refreshToken);
  });

  it('the trail is APPEND-ONLY — an attacker who gets in cannot erase their login', async () => {
    const rows = await auditRows();
    expect(rows.length).toBeGreaterThan(0);

    // Every row carries a non-empty reason; the database enforces it, and a
    // sensitive action without one is a bug (audit_log_reason_check).
    for (const row of rows) {
      expect(row.reason.trim().length).toBeGreaterThan(0);
    }

    // chat.forbid_mutation() on BEFORE DELETE OR UPDATE. This is what makes the
    // rows above evidence rather than a convenience: the authentication path
    // can write them and nothing -- including the authentication path -- can
    // take them back.
    await expect(
      prisma.$executeRawUnsafe(
        `delete from chat.audit_log where entity_id = '${ids.account}'::uuid`,
      ),
    ).rejects.toThrow();
    await expect(
      prisma.$executeRawUnsafe(
        `update chat.audit_log set reason = 'tampered' where entity_id = '${ids.account}'::uuid`,
      ),
    ).rejects.toThrow();
    await expect(
      prisma.$executeRawUnsafe(
        `delete from chat.event_log where payload->>'accountId' = '${ids.account}'`,
      ),
    ).rejects.toThrow();

    expect((await auditRows()).length).toBe(rows.length);
  });
});
