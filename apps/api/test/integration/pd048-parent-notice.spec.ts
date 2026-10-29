/**
 * PD-48 against the real database (migration 20261029235700): the parent's
 * acknowledgement of the lesson-audio notice (owner 2026-10-29).
 *
 *   - written only through chat.acknowledge_parent_notice, idempotently: a second
 *     acknowledgement adds nothing; only an active parent contact may have one;
 *   - a record: never updated, never deleted on its own, removed only with its contact;
 *   - a parent reads only their OWN rows (RLS); no request role writes or executes;
 *   - the service: a parent sees the notice until they acknowledge THIS version;
 *     a teacher or staff member has none; an older version acknowledges nothing.
 *
 * Synthetic people only (G-20).
 */
import { randomUUID } from 'node:crypto';
import { hashPassword } from '@platform/auth/password';
import { supportSessionMayCall } from '@platform/auth/support-session.interceptor';
import { runWithRequestContext } from '@platform/request-context';
import type { Actor } from '@platform/types';
import { seedOrgChat, type SeedManifest } from '../../src/cli/org-chat-seed';
import { ParentNoticeService } from '../../src/lesson-audio/parent-notice.service';
import { PARENT_NOTICES } from '../../src/lesson-audio/parent-notices';
import { buildGraph, truncate } from './harness';

jest.setTimeout(300_000);

const PASSWORD = 'pd48-parent-notice-spec-1';
const DOMAIN = 'pd48notice.qa.jawwid.test';
const g = buildGraph();
let m: SeedManifest;
let orgId: string;
const notices = new ParentNoticeService(g.prisma);

async function sqlError(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return String((e as Error).message ?? e);
  }
}

const ack = (contact: string, key = 'lesson_audio', version = 1) =>
  g.prisma.$queryRaw<Array<{ added: boolean }>>`SELECT chat.acknowledge_parent_notice(${contact}::uuid, ${key}, ${version}::int) AS added`.then((r) => r[0]!.added);

const parentActor = (id: string): Actor => ({ actorId: id, kind: 'contact', displayName: 'P', locale: 'ar', isActive: true, organizationId: orgId });

/** Rows visible to the request role `authenticated` acting as `actor` (RLS). */
async function visibleAs(actor: string): Promise<string[]> {
  return g.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`set local role authenticated`);
    await tx.$executeRawUnsafe(`select set_config('chat.actor_id', '${actor}', true)`);
    const rows = await tx.$queryRawUnsafe<Array<{ contact_id: string }>>(`select contact_id::text from chat.parent_notice_ack`);
    return rows.map((r) => r.contact_id);
  });
}

beforeAll(async () => {
  await g.prisma.$connect();
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  orgId = randomUUID();
  await g.prisma.$executeRawUnsafe(`insert into chat.organization (id, slug, display_name) values ('${orgId}'::uuid, 'pd48n-${orgId.slice(0, 8)}', 'PD-48 QA academy')`);
  await g.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`);
    const account = await tx.account.create({ data: { organizationId: orgId, subject: `owner@${DOMAIN}`, kind: 'staff', status: 'active', isActive: true } });
    await tx.staff.create({ data: { organizationId: orgId, name: 'QA Owner', role: 'super_admin', isActive: true, accountId: account.id } });
  });
  m = await seedOrgChat(g.prisma, { organizationId: orgId, emailDomain: DOMAIN, password: PASSWORD, passwordHash: await hashPassword(PASSWORD), messages: false });
});

afterAll(async () => {
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$disconnect();
});

describe('PD-48: the parent-notice acknowledgement in the database', () => {
  it('is recorded once: a second acknowledgement adds nothing; only an active parent contact has one', async () => {
    const parent = m.families[0]!.parent.id;
    expect(await ack(parent)).toBe(true);
    expect(await ack(parent)).toBe(false);
    const n = await g.prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM chat.parent_notice_ack WHERE contact_id = ${parent}::uuid`;
    expect(n).toEqual([{ n: 1n }]);
    expect(await sqlError(ack(randomUUID()))).toMatch(/no such active parent/);
    expect(await sqlError(ack(parent, 'Lesson Audio!'))).toMatch(/check constraint|notice_key/);
  });

  it('is a record: never updated, never deleted on its own, never truncated', async () => {
    const parent = m.families[0]!.parent.id;
    expect(await sqlError(g.prisma.$executeRaw`UPDATE chat.parent_notice_ack SET notice_version = 2 WHERE contact_id = ${parent}::uuid`)).toMatch(/never changed/);
    expect(await sqlError(g.prisma.$executeRaw`DELETE FROM chat.parent_notice_ack WHERE contact_id = ${parent}::uuid`)).toMatch(/removed only with its contact/);
    expect(await sqlError(g.prisma.$executeRawUnsafe(`truncate chat.parent_notice_ack`))).toMatch(/never truncated/);
  });

  it('a parent reads only their own rows; no request role writes it or executes the function', async () => {
    const [a, b] = [m.families[1]!.parent.id, m.families[2]!.parent.id];
    await ack(a);
    await ack(b);
    expect(await visibleAs(a)).toEqual([a]);
    expect(await visibleAs(b)).toEqual([b]);
    expect(await visibleAs(m.teachers[0]!.id)).toEqual([]);
    for (const role of ['authenticated', 'chat_app']) {
      for (const priv of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) {
        const r = await g.prisma.$queryRawUnsafe<Array<{ ok: boolean }>>(`select has_table_privilege('${role}', 'chat.parent_notice_ack', '${priv}') as ok`);
        expect({ role, priv, ok: r[0]!.ok }).toEqual({ role, priv, ok: false });
      }
      const f = await g.prisma.$queryRawUnsafe<Array<{ ok: boolean }>>(`select has_function_privilege('${role}', 'chat.acknowledge_parent_notice(uuid, text, integer)', 'EXECUTE') as ok`);
      expect({ role, ok: f[0]!.ok }).toEqual({ role, ok: false });
    }
  });
});

describe('PD-48: what a signed-in parent is asked', () => {
  it('the notice until they acknowledge THIS version; then never again', async () => {
    const parent = parentActor(m.families[3]!.parent.id);
    expect(await notices.list(parent)).toEqual({ notices: [{ key: 'lesson_audio', version: PARENT_NOTICES.lesson_audio, acknowledged: false }] });
    await expect(notices.acknowledge(parent, 'lesson_audio', { version: PARENT_NOTICES.lesson_audio - 1 })).rejects.toMatchObject({ status: 409 });
    await expect(notices.acknowledge(parent, 'other_notice', { version: 1 })).rejects.toMatchObject({ status: 404 });
    expect(await notices.acknowledge(parent, 'lesson_audio', { version: PARENT_NOTICES.lesson_audio })).toEqual({ key: 'lesson_audio', version: 1, acknowledged: true });
    expect(await notices.acknowledge(parent, 'lesson_audio', { version: PARENT_NOTICES.lesson_audio })).toEqual({ key: 'lesson_audio', version: 1, acknowledged: true });
    expect((await notices.list(parent)).notices[0]!.acknowledged).toBe(true);
  });

  it('a support session (PD-21) is shown no notice, and its acknowledgement is refused at the route and in the service', async () => {
    const parent = parentActor(m.families[4]!.parent.id);
    expect(supportSessionMayCall('GET', '/parent-notices')).toBe(true);
    expect(supportSessionMayCall('POST', '/parent-notices/:key/acknowledge')).toBe(false);
    expect(supportSessionMayCall('POST', '/api/v1/parent-notices/:key/acknowledge')).toBe(false);
    await runWithRequestContext({ impersonationId: randomUUID() }, async () => {
      expect(await notices.list(parent)).toEqual({ notices: [] });
      await expect(notices.acknowledge(parent, 'lesson_audio', { version: PARENT_NOTICES.lesson_audio })).rejects.toMatchObject({ code: 'COMM.SUPPORT_SESSION_FORBIDDEN', status: 403 });
    });
    // Nothing was recorded: outside the support session the parent is still asked.
    expect((await notices.list(parent)).notices[0]!.acknowledged).toBe(false);
  });

  it('a teacher or a staff member has no parent notice and acknowledges none', async () => {
    const teacher: Actor = { actorId: m.teachers[0]!.id, kind: 'teacher', displayName: 'T', locale: 'ar', isActive: true, organizationId: orgId };
    expect(await notices.list(teacher)).toEqual({ notices: [] });
    await expect(notices.acknowledge(teacher, 'lesson_audio', { version: 1 })).rejects.toMatchObject({ status: 403 });
  });
});
