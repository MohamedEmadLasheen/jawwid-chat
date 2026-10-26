/**
 * PD-33 -- "Hand over to backup", end to end on the PD-8 synthetic organization
 * (src/cli/org-chat-seed.ts), against the real SQL scope.
 *
 *   1. who may start, extend and end a cover -- and a refusal changes nothing
 *   2. THE WINDOW: a covering backup passes chat.staff_conversation_access,
 *      staff_principals and staff_reaches_family for every covered family
 *      conversation during the window, and fails after `until` and after an
 *      early end (no new predicate: the cover IS the link's activation)
 *   3. the one-open-cover guard (service and database)
 *   4. the eligibility trigger: not a primary, another department, inactive,
 *      away, at cover.max_concurrent
 *   5. lines and pushes: one silent line per affected conversation, no push
 *      for it; the backup's one summary push; the away supervisor's messages
 *      push the backup instead; the cover line on the conversation DTO
 *   6. Extend: the same window again, capped at cover.max_days
 *   7. the return: the sweep closes a cover past `until` with ONE return line,
 *      and racing "End cover now" against the sweep still posts exactly one
 *   8. Instalments responsible=me includes the covered supervisor's rows
 *      during the window and not after
 *   9. the Organization page's link deactivation ends the cover with it; a
 *      manual activation cannot overwrite a running cover's window
 *
 * Synthetic people only (G-20).
 */
import { randomUUID } from 'node:crypto';
import { PrismaAuditService } from '@platform/audit.service';
import { hashPassword } from '@platform/auth/password';
import { CommError, CommErrorCode } from '@platform/errors';
import { BillingService } from '../../src/billing/billing.service';
import { OrgStructureService } from '../../src/org/org-structure.service';
import { SupervisorCoverService } from '../../src/org/supervisor-cover.service';
import { seedOrgChat, type SeedManifest } from '../../src/cli/org-chat-seed';
import { buildGraph, truncate } from './harness';

jest.setTimeout(300_000);

const PASSWORD = 'pd33-cover-spec-password-1';
const DOMAIN = 'pd33cover.qa.jawwid.test';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const g = buildGraph();
const audit = new PrismaAuditService();
const covers = new SupervisorCoverService(g.prisma, g.authz, g.conversations, g.notifications, g.config, audit);
const org = new OrgStructureService(g.prisma, g.authz, g.conversations, audit, undefined, covers);
const billing = new BillingService(g.prisma, g.conversations, audit);

let m: SeedManifest;
let orgId: string;

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof CommError) return e.code;
    throw e;
  }
  throw new Error('expected a refusal, got success');
}

const access = async (staffId: string, conversationId: string, at: Date) =>
  (
    await g.prisma.$queryRaw<Array<{ a: string | null }>>`
      SELECT chat.staff_conversation_access(${staffId}::uuid, ${conversationId}::uuid, ${at}) AS a`
  )[0]?.a ?? null;
const principals = async (staffId: string, at: Date) =>
  (await g.prisma.$queryRaw<Array<{ id: string }>>`SELECT chat.staff_principals(${staffId}::uuid, ${at})::text AS id`).map((r) => r.id);
const reaches = async (staffId: string, familyId: string, at: Date) =>
  (
    await g.prisma.$queryRaw<Array<{ a: string | null }>>`
      SELECT chat.staff_reaches_family(${staffId}::uuid, ${familyId}::uuid, ${at}) AS a`
  )[0]?.a ?? null;
const lines = (conversationId: string, kind: string) =>
  g.prisma.message.count({ where: { conversationId, type: 'system', body: { contains: `"kind":"${kind}"` } } });

/** Every conversation of supervisor `s` the cover should touch: their families' groups and 1:1s. */
const caseload = (s: string) => {
  const fams = m.families.filter((f) => f.children.some((c) => c.supervisorId === s));
  return {
    families: fams.map((f) => f.id),
    groups: fams.flatMap((f) => f.groups.filter((x) => x.supervisorId === s).map((x) => x.conversationId)),
    directs: fams.flatMap((f) => f.directs.filter((x) => x.supervisorId === s).map((x) => x.conversationId)),
  };
};
const backupOf = (primaryId: string) => m.backups.find((b) => b.covers.includes(primaryId))!;
const inHours = (h: number) => new Date(Date.now() + h * HOUR).toISOString();

beforeAll(async () => {
  await g.prisma.$connect();
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd33-%'`);
  orgId = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.organization (id, slug, display_name) values ('${orgId}'::uuid, 'pd33-${orgId.slice(0, 8)}', 'PD-33 QA academy')`,
  );
  await g.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`);
    const account = await tx.account.create({
      data: { organizationId: orgId, subject: `owner@${DOMAIN}`, kind: 'staff', status: 'active', isActive: true },
    });
    await tx.staff.create({
      data: { organizationId: orgId, name: 'QA Organization Owner', role: 'super_admin', isActive: true, accountId: account.id },
    });
  });
  m = await seedOrgChat(g.prisma, {
    organizationId: orgId,
    emailDomain: DOMAIN,
    password: PASSWORD,
    passwordHash: await hashPassword(PASSWORD),
    messages: false,
  });
});

afterAll(async () => {
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd33-%'`);
  await g.prisma.$disconnect();
});

/** End every open cover, so each test starts from none. */
afterEach(async () => {
  const open = await g.prisma.supervisorCover.findMany({ where: { endedAt: null } });
  for (const c of open) await covers.end(m.superAdmin.id, c.id);
});

describe('1. who may hand a supervisor over', () => {
  it('the supervisor, their manager and the super admin start; nobody else; a refusal changes nothing', async () => {
    const p = m.supervisors[0]!;
    const until = inHours(4);
    for (const who of [m.salesManager, m.teachersManager, m.supervisors[1]!, backupOf(p.id), m.teacherSupervisors[0]!]) {
      expect({ who: who.name, code: await code(covers.start(who.id, { supervisorId: p.id, until })) })
        .toEqual({ who: who.name, code: CommErrorCode.ORG_STRUCTURE_DENIED });
    }
    expect(await g.prisma.supervisorCover.count()).toBe(0);
    for (const who of [p, m.operationsManager, m.superAdmin]) {
      const c = await covers.start(who.id, { supervisorId: p.id, until });
      expect(c.backup.id).toBe(backupOf(p.id).id); // pre-filled: the linked backup
      expect(c.status).toBe('active');
      await covers.end(who.id, c.id);
    }
  });

  it('the backup may END the cover they hold, but never start or extend one', async () => {
    const p = m.supervisors[0]!;
    const b = backupOf(p.id);
    const c = await covers.start(p.id, { supervisorId: p.id, until: inHours(4) });
    expect(await code(covers.extend(b.id, c.id))).toBe(CommErrorCode.ORG_STRUCTURE_DENIED);
    const ended = await covers.end(b.id, c.id);
    expect(ended.status).toBe('ended');
    expect(ended.endKind).toBe('ended_early');
  });

  it('every change is audited', async () => {
    const p = m.supervisors[0]!;
    const c = await covers.start(m.operationsManager.id, { supervisorId: p.id, until: inHours(4), note: 'annual leave' });
    await covers.extend(m.operationsManager.id, c.id);
    await covers.end(p.id, c.id);
    const rows = await g.prisma.auditLog.findMany({ where: { entityId: c.id }, orderBy: { at: 'asc' } });
    expect(rows.map((r) => r.action)).toEqual(['cover.started', 'cover.extended', 'cover.ended']);
    expect(rows[0]!.actorId).toBe(m.operationsManager.id);
    expect(rows[2]!.actorId).toBe(p.id);
  });
});

describe('2. the window: a cover is the link activation PD-8 already reads', () => {
  it('the backup is a principal for the covered caseload during the window, and not after `until`', async () => {
    const p = m.supervisors[0]!;
    const b = backupOf(p.id);
    const load = caseload(p.id);
    expect(load.groups.length + load.directs.length).toBeGreaterThan(0);
    const before = new Date();
    expect(await principals(b.id, before)).not.toContain(p.id);

    const c = await covers.start(p.id, { supervisorId: p.id, until: inHours(5) });
    const during = new Date(Date.now() + HOUR);
    const after = new Date(new Date(c.endsAt).getTime() + 1000);

    expect(await principals(b.id, during)).toContain(p.id);
    for (const id of [...load.groups, ...load.directs]) {
      expect({ id, during: await access(b.id, id, during), after: await access(b.id, id, after) })
        .toEqual({ id, during: 'backup', after: null });
    }
    for (const f of load.families) {
      expect({ f, during: await reaches(b.id, f, during), after: await reaches(b.id, f, after) })
        .toEqual({ f, during: 'backup', after: null });
    }
    expect(await principals(b.id, after)).not.toContain(p.id);
    // The list is the same rule.
    const listed = new Set((await g.conversations.listForActor(b.id)).map((x) => x.id));
    for (const id of [...load.groups, ...load.directs]) expect(listed.has(id)).toBe(true);
  });

  it('an early end shuts the backup out at once', async () => {
    const p = m.supervisors[0]!;
    const b = backupOf(p.id);
    const c = await covers.start(p.id, { supervisorId: p.id, until: inHours(5) });
    await covers.end(p.id, c.id);
    const now = new Date();
    expect(await principals(b.id, now)).not.toContain(p.id);
    for (const id of caseload(p.id).groups) expect(await access(b.id, id, now)).toBeNull();
  });

  it('the away supervisor keeps their own access (read and reply) throughout', async () => {
    const p = m.supervisors[0]!;
    await covers.start(p.id, { supervisorId: p.id, until: inHours(5) });
    const now = new Date();
    for (const id of caseload(p.id).groups) expect(await access(p.id, id, now)).toBe('responsible');
    for (const id of caseload(p.id).directs) expect(await access(p.id, id, now)).toBe('member');
  });

  it('a future-dated cover grants nothing until it begins', async () => {
    const p = m.supervisors[0]!;
    const b = backupOf(p.id);
    const c = await covers.start(p.id, { supervisorId: p.id, from: inHours(24), until: inHours(48) });
    expect(c.status).toBe('scheduled');
    expect(await principals(b.id, new Date())).not.toContain(p.id);
    expect(await principals(b.id, new Date(Date.now() + 30 * HOUR))).toContain(p.id);
    // Nothing announced yet.
    for (const id of caseload(p.id).groups) expect(await lines(id, 'cover.started')).toBe(0);
  });
});

describe('3. one open cover per supervisor', () => {
  it('a second hand-over is refused while one is open (service and database)', async () => {
    const p = m.supervisors[0]!;
    const c = await covers.start(p.id, { supervisorId: p.id, until: inHours(5) });
    expect(await code(covers.start(m.superAdmin.id, { supervisorId: p.id, until: inHours(6) }))).toBe(CommErrorCode.ORG_STRUCTURE_INVALID);
    const row = await g.prisma.supervisorCover.findUniqueOrThrow({ where: { id: c.id } });
    await expect(
      g.prisma.supervisorCover.create({
        data: { ...row, id: randomUUID(), createdAt: new Date(), startAnnouncedAt: null },
      }),
    ).rejects.toThrow();
    expect(await g.prisma.supervisorCover.count({ where: { primaryId: p.id, endedAt: null } })).toBe(1);
  });
});

describe('4. the eligibility trigger', () => {
  const insert = async (primaryId: string, backupId: string) => {
    const link =
      (await g.prisma.supervisorBackup.findFirst({ where: { primaryId, backupId, endedAt: null } })) ??
      null;
    return g.prisma.$executeRaw`
      INSERT INTO chat.supervisor_cover (organization_id, primary_id, backup_id, backup_link_id, starts_at, ends_at, window_seconds, started_by)
      VALUES (${orgId}::uuid, ${primaryId}::uuid, ${backupId}::uuid, ${link?.id ?? randomUUID()}::uuid, now(), now() + interval '1 hour', 3600, ${m.superAdmin.id}::uuid)`;
  };

  it('refuses a backup who is not a backup supervisor of the same department', async () => {
    const p = m.supervisors[0]!;
    await expect(insert(p.id, m.supervisors[1]!.id)).rejects.toThrow(/backup supervisor of the same department/);
    await expect(insert(p.id, m.teacherSupervisors[0]!.id)).rejects.toThrow(/backup supervisor of the same department/);
    expect(await code(covers.start(m.superAdmin.id, { supervisorId: p.id, backupId: m.supervisors[1]!.id, until: inHours(3) })))
      .toBe(CommErrorCode.ORG_STRUCTURE_INVALID);
  });

  it('refuses a supervisor who is not an Operations primary', async () => {
    await expect(insert(backupOf(m.supervisors[0]!.id).id, m.backups[1]!.id)).rejects.toThrow(/only a primary supervisor/);
  });

  it('refuses a cover past cover.max_days', async () => {
    const p = m.supervisors[0]!;
    expect(await code(covers.start(p.id, { supervisorId: p.id, until: new Date(Date.now() + 31 * DAY).toISOString() })))
      .toBe(CommErrorCode.VALIDATION);
  });

  it('a backup covers at most cover.max_concurrent supervisors at once', async () => {
    const amira = m.backups[0]!;
    const [a, b] = amira.covers;
    const third = m.supervisors.find((s) => !amira.covers.includes(s.id))!;
    await covers.start(m.superAdmin.id, { supervisorId: a!, backupId: amira.id, until: inHours(4) });
    await covers.start(m.superAdmin.id, { supervisorId: b!, backupId: amira.id, until: inHours(4) });
    expect(await code(covers.start(m.superAdmin.id, { supervisorId: third.id, backupId: amira.id, until: inHours(4) })))
      .toBe(CommErrorCode.ORG_STRUCTURE_INVALID);
    // The trigger holds even when the API's own check is skipped.
    const link = await g.prisma.supervisorBackup.create({ data: { organizationId: orgId, primaryId: third.id, backupId: amira.id } });
    await expect(g.prisma.$executeRaw`
      INSERT INTO chat.supervisor_cover (organization_id, primary_id, backup_id, backup_link_id, starts_at, ends_at, window_seconds, started_by)
      VALUES (${orgId}::uuid, ${third.id}::uuid, ${amira.id}::uuid, ${link.id}::uuid, now(), now() + interval '1 hour', 3600, ${m.superAdmin.id}::uuid)`)
      .rejects.toThrow(/already covers 2 supervisors/);
    await g.prisma.supervisorBackup.update({ where: { id: link.id }, data: { endedAt: new Date(), deactivatedAt: new Date() } });
  });

  it('refuses an inactive backup', async () => {
    const p = m.supervisors[0]!;
    const b = backupOf(p.id);
    await g.prisma.staff.update({ where: { id: b.id }, data: { isActive: false } });
    try {
      expect(await code(covers.start(p.id, { supervisorId: p.id, until: inHours(3) }))).toBe(CommErrorCode.ORG_STRUCTURE_INVALID);
    } finally {
      await g.prisma.staff.update({ where: { id: b.id }, data: { isActive: true } });
    }
  });
});

describe('5. lines, pushes and the cover line', () => {
  it('one silent line in each affected conversation, and no push for it', async () => {
    const p = m.supervisors[0]!;
    const load = caseload(p.id);
    await g.prisma.notification.deleteMany({});
    await g.prisma.outboxEvent.deleteMany({});
    const c = await covers.start(p.id, { supervisorId: p.id, until: inHours(5) });
    for (const id of [...load.groups, ...load.directs]) expect({ id, n: await lines(id, 'cover.started') }).toEqual({ id, n: 1 });
    // Nothing outside the caseload got a line.
    const others = m.families.flatMap((f) => f.groups).filter((x) => x.supervisorId !== p.id).map((x) => x.conversationId);
    for (const id of others) expect(await lines(id, 'cover.started')).toBe(0);
    await g.outboxWorker.drain(1000);
    expect(await g.prisma.notification.count({ where: { templateKey: 'new_message' } })).toBe(0);
    // The backup's ONE summary push.
    const summary = await g.prisma.notification.findMany({ where: { templateKey: 'cover_started' } });
    expect(summary.map((n) => n.recipientId)).toEqual([c.backup.id]);
    expect(summary[0]!.variables).toMatchObject({ supervisor: p.name, families: load.families.length });
  });

  it('a parent writing to the away supervisor pushes the backup, not the supervisor', async () => {
    const p = m.supervisors[0]!;
    const b = backupOf(p.id);
    const fam = m.families.find((f) => f.directs.some((d) => d.supervisorId === p.id))!;
    const direct = fam.directs.find((d) => d.supervisorId === p.id)!.conversationId;
    await covers.start(p.id, { supervisorId: p.id, until: inHours(5) });
    await g.prisma.notification.deleteMany({});
    await g.outboxWorker.drain(1000);
    const sent = await g.messages.send({ senderId: fam.parent.id, conversationId: direct, body: 'Is the lesson on today?', clientMessageId: randomUUID() } as never);
    await g.outboxWorker.drain(1000);
    const pushed = await g.prisma.notification.findMany({ where: { templateKey: 'new_message', dedupeKey: { contains: sent.id } } });
    expect(pushed.map((n) => n.recipientId)).toEqual([b.id]);
  });

  it('the conversation carries the cover line for every viewer, and not after the end', async () => {
    const p = m.supervisors[0]!;
    const load = caseload(p.id);
    const c = await covers.start(p.id, { supervisorId: p.id, until: inHours(5) });
    const during = await g.conversations.coversOf([...load.groups, ...load.directs]);
    for (const id of [...load.groups, ...load.directs]) {
      expect(during.get(id)).toEqual({ supervisorId: p.id, supervisorName: p.name, coverId: c.backup.id, coverName: c.backup.name, until: c.endsAt });
    }
    await covers.end(p.id, c.id);
    expect((await g.conversations.coversOf(load.groups)).size).toBe(0);
    for (const id of load.groups) expect(await lines(id, 'cover.ended')).toBe(1);
    expect(await g.prisma.notification.count({ where: { templateKey: 'cover_ended', recipientId: p.id } })).toBeGreaterThan(0);
  });
});

describe('6. Extend', () => {
  it('adds the same window again, and never past cover.max_days', async () => {
    const p = m.supervisors[0]!;
    const c = await covers.start(p.id, { supervisorId: p.id, until: new Date(Date.now() + 10 * DAY).toISOString() });
    const once = await covers.extend(p.id, c.id);
    expect(new Date(once.endsAt).getTime() - new Date(c.endsAt).getTime()).toBeGreaterThan(10 * DAY - 5000);
    const link = await g.prisma.supervisorBackup.findFirstOrThrow({ where: { primaryId: p.id, backupId: c.backup.id, endedAt: null } });
    expect(link.activeUntil?.toISOString()).toBe(once.endsAt);
    expect(await code(covers.extend(p.id, c.id))).toBe(CommErrorCode.VALIDATION); // 30 days max
    for (const id of caseload(p.id).groups) expect(await lines(id, 'cover.extended')).toBeGreaterThanOrEqual(1);
  });
});

describe('7. the automatic return', () => {
  /** A cover whose window has just closed (the link's too), as the sweep finds it. */
  const expire = async (coverId: string) => {
    const row = await g.prisma.supervisorCover.findUniqueOrThrow({ where: { id: coverId } });
    const end = new Date(Date.now() - 1000);
    const start = new Date(end.getTime() - 2 * HOUR);
    // Moving a window into the past is not a lawful edit (the trigger refuses a
    // changed start); the test stands in for the clock with triggers off.
    await g.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`set local session_replication_role = replica`);
      await tx.$executeRaw`UPDATE chat.supervisor_cover SET starts_at = ${start}, ends_at = ${end} WHERE id = ${coverId}::uuid`;
      await tx.$executeRaw`UPDATE chat.supervisor_backup SET activated_at = ${start}, active_until = ${end} WHERE id = ${row.backupLinkId}::uuid`;
    });
  };

  it('the sweep closes a cover past `until` with one return line, and the supervisor hears once', async () => {
    const p = m.supervisors[0]!;
    const c = await covers.start(p.id, { supervisorId: p.id, until: inHours(2) });
    await expire(c.id);
    const r1 = await covers.sweep();
    const r2 = await covers.sweep();
    expect(r1.returned).toBe(1);
    expect(r2.returned).toBe(0);
    const row = await g.prisma.supervisorCover.findUniqueOrThrow({ where: { id: c.id } });
    expect(row.endKind).toBe('returned');
    for (const id of [...caseload(p.id).groups, ...caseload(p.id).directs]) expect(await lines(id, 'cover.ended')).toBe(1);
    expect(await g.prisma.notification.count({ where: { dedupeKey: `cover_ended:${c.id}` } })).toBe(1);
  });

  it('racing "End cover now" against the sweep still posts exactly one return line', async () => {
    for (let round = 0; round < 5; round++) {
      const p = m.supervisors[0]!;
      const c = await covers.start(p.id, { supervisorId: p.id, until: inHours(2) });
      await expire(c.id);
      await Promise.allSettled([covers.sweep(), covers.end(p.id, c.id), covers.sweep()]);
      const row = await g.prisma.supervisorCover.findUniqueOrThrow({ where: { id: c.id } });
      expect(row.endedAt).not.toBeNull();
      for (const id of caseload(p.id).groups) {
        const ended = await g.prisma.message.count({
          where: { conversationId: id, type: 'system', body: { contains: '"kind":"cover.ended"' }, createdAt: { gte: row.startAnnouncedAt! } },
        });
        expect({ round, id, ended }).toEqual({ round, id, ended: 1 });
      }
      expect(await g.prisma.auditLog.count({ where: { entityId: c.id, action: 'cover.ended' } })).toBe(1);
    }
  });

  it('a future cover is announced by the sweep once it begins', async () => {
    const p = m.supervisors[0]!;
    const c = await covers.start(p.id, { supervisorId: p.id, from: inHours(1), until: inHours(3) });
    expect((await covers.sweep()).started).toBe(0);
    expect((await covers.sweep(new Date(Date.now() + 2 * HOUR))).started).toBe(1);
    for (const id of caseload(p.id).groups) expect(await lines(id, 'cover.started')).toBeGreaterThanOrEqual(1);
    expect(await g.prisma.notification.count({ where: { dedupeKey: `cover_started:${c.id}` } })).toBe(1);
  });
});

describe('8. Instalments: "mine" includes the covered supervisor\'s rows during the window only', () => {
  it('responsible=me shows the backup the away supervisor\'s instalments, and not after', async () => {
    const p = m.supervisors[0]!;
    const b = backupOf(p.id);
    const fam = m.families.find((f) => f.children.some((c) => c.supervisorId === p.id))!;
    const child = fam.children.find((c) => c.supervisorId === p.id)!;
    const inst = await g.prisma.familyInstalment.create({
      data: {
        organizationId: orgId,
        familyId: fam.id,
        learnerId: child.id,
        label: 'PD-33 probe',
        amountMinor: BigInt(10000),
        currency: 'USD',
        dueDate: new Date(Date.now() + 7 * DAY),
        createdBy: m.operationsManager.id,
      },
    });
    const mine = async (who: string) => (await billing.list(who, { responsible: 'me' })).items.map((i) => i.id);
    expect(await mine(p.id)).toContain(inst.id);
    const c = await covers.start(p.id, { supervisorId: p.id, until: inHours(5) });
    expect(await mine(b.id)).toContain(inst.id);
    expect(await mine(p.id)).toContain(inst.id); // still theirs
    await covers.end(p.id, c.id);
    const after = await billing.list(b.id, { responsible: 'me' }).then((r) => r.items.map((i) => i.id)).catch((e: CommError) => e.code);
    expect(Array.isArray(after) ? after.includes(inst.id) : false).toBe(false);
    await g.prisma.familyInstalment.delete({ where: { id: inst.id } });
  });
});

describe('9. the backup link and the cover stay one decision', () => {
  it('deactivating the link on the Organization page ends its cover, with the return line', async () => {
    const p = m.supervisors[0]!;
    const c = await covers.start(p.id, { supervisorId: p.id, until: inHours(5) });
    const link = await g.prisma.supervisorBackup.findFirstOrThrow({ where: { primaryId: p.id, backupId: c.backup.id, endedAt: null } });
    await org.deactivateBackup(m.operationsManager.id, link.id, { reason: 'probe' });
    const row = await g.prisma.supervisorCover.findUniqueOrThrow({ where: { id: c.id } });
    expect(row.endKind).toBe('link_ended');
    for (const id of caseload(p.id).groups) expect(await lines(id, 'cover.ended')).toBeGreaterThanOrEqual(1);
  });

  it('a manual activation cannot overwrite a running cover\'s window', async () => {
    const p = m.supervisors[0]!;
    const c = await covers.start(p.id, { supervisorId: p.id, until: inHours(5) });
    const link = await g.prisma.supervisorBackup.findFirstOrThrow({ where: { primaryId: p.id, backupId: c.backup.id, endedAt: null } });
    expect(await code(org.activateBackup(m.operationsManager.id, link.id, { reason: 'probe', until: inHours(80) })))
      .toBe(CommErrorCode.ORG_STRUCTURE_INVALID);
  });
});
