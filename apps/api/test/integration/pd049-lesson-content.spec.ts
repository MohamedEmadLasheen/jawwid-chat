/**
 * PD-49 against the real database (migration 20261029235000):
 *
 *   - a step is signed only by an active holder of that step's key, in order
 *     (check, then teacher, then scholar; no check for a game mechanic);
 *   - one person signs one step of a text; a step is signed once;
 *   - a rejection or a withdrawal is final for that text; only a signed text is
 *     withdrawn; a changed text (a new hash) starts again;
 *   - the Teachers manager checks and signs as a teacher, a Teachers supervisor
 *     only sees, and the scholar's key comes only with the scholar_reviewer
 *     role, which the super admin grants and a department manager cannot;
 *   - reviews are never changed or removed; request roles reach nothing; every
 *     review is audited;
 *   - (review of #258) only active staff of THE content organization sign
 *     (chat.config lesson_content.organization_id; unset = nobody); the scholar
 *     step needs the explicitly granted role -- the super admin's implicit
 *     every-key never signs as the scholar; two people racing for one step:
 *     one wins.
 *
 * Synthetic people and test hashes only (G-20). Each run uses its own scope.
 */
import { createHash, randomInt, randomUUID } from 'node:crypto';
import { hashPassword } from '@platform/auth/password';
import { seedOrgChat, type SeedManifest } from '../../src/cli/org-chat-seed';
import { buildGraph, truncate } from './harness';

jest.setTimeout(300_000);

const PASSWORD = 'pd49-lesson-content-spec-1';
const DOMAIN = 'pd49content.qa.jawwid.test';
const g = buildGraph();
let m: SeedManifest;
let orgId: string;
let scholar: string;
let scholarRole: string;
const SCOPE = `quran-${String(randomInt(100, 999))}`;
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

async function sqlError(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return String((e as Error).message ?? e);
  }
}

const sign = (item: string, text: string, step: string, actor: string, action = 'approve', scope = SCOPE) =>
  g.prisma
    .$queryRaw<Array<{ r: { state: string; steps: string[] } }>>`
      SELECT chat.review_lesson_content(${scope}, ${item}, ${sha(text)}, ${step}, ${action},
             ${action === 'approve' ? null : 'wrong_meaning'}, ${action === 'approve' ? null : 'spec'}, ${actor}::uuid) AS r`
    .then((rows) => rows[0]!.r);

const holds = async (staff: string, key: string) =>
  (await g.prisma.$queryRaw<Array<{ ok: boolean }>>`SELECT chat.staff_has_permission(${staff}::uuid, ${key}) AS ok`)[0]!.ok;

beforeAll(async () => {
  await g.prisma.$connect();
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  orgId = randomUUID();
  await g.prisma.$executeRawUnsafe(`insert into chat.organization (id, slug, display_name) values ('${orgId}'::uuid, 'pd49-${orgId.slice(0, 8)}', 'PD-49 QA academy')`);
  await g.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`);
    const account = await tx.account.create({ data: { organizationId: orgId, subject: `owner@${DOMAIN}`, kind: 'staff', status: 'active', isActive: true } });
    await tx.staff.create({ data: { organizationId: orgId, name: 'QA Owner', role: 'super_admin', isActive: true, accountId: account.id } });
  });
  m = await seedOrgChat(g.prisma, { organizationId: orgId, emailDomain: DOMAIN, password: PASSWORD, passwordHash: await hashPassword(PASSWORD), messages: false });
  await g.prisma.$queryRaw`SELECT chat.seed_access_role_templates(${orgId}::uuid)`;
  // A specialist the super admin grants the Scholar reviewer template.
  const account = await g.prisma.account.create({ data: { organizationId: orgId, subject: `scholar@${DOMAIN}`, kind: 'staff', status: 'active', isActive: true } });
  scholar = (await g.prisma.staff.create({ data: { organizationId: orgId, name: 'QA Scholar', role: 'specialist', isActive: true, accountId: account.id } })).id;
  const role = await g.prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id::text FROM chat.access_role WHERE organization_id = ${orgId}::uuid AND key = 'scholar_reviewer'`;
  scholarRole = role[0]!.id;
  await g.prisma.$queryRaw`SELECT chat.grant_access_role(${scholar}::uuid, ${scholarRole}::uuid, 'spec', ${m.superAdmin.id}::uuid)`;
  // This academy is the content organization.
  await setContentOrg(orgId);
});

async function setContentOrg(id: string | null) {
  await g.prisma.$executeRaw`DELETE FROM chat.config WHERE key = 'lesson_content.organization_id'`;
  if (id) {
    await g.prisma.$executeRaw`
      INSERT INTO chat.config (key, value, scope, description)
      VALUES ('lesson_content.organization_id', to_jsonb(${id}::text), 'global', 'PD-49 spec: the content organization')`;
  }
}

afterAll(async () => {
  await setContentOrg(null);
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$disconnect();
});

describe('PD-49: who signs which step', () => {
  it('the Teachers manager checks and signs as a teacher, never as the scholar; a Teachers supervisor only sees; Operations nothing', async () => {
    expect(await holds(m.teachersManager.id, 'lesson_content.check')).toBe(true);
    expect(await holds(m.teachersManager.id, 'lesson_content.review_teacher')).toBe(true);
    expect(await holds(m.teachersManager.id, 'lesson_content.review_scholar')).toBe(false);
    expect(await holds(m.operationsManager.id, 'lesson_content.view')).toBe(false);
    for (const s of m.teacherSupervisors) {
      expect(await holds(s.id, 'lesson_content.view')).toBe(true);
      expect(await holds(s.id, 'lesson_content.check')).toBe(false);
    }
  });

  it('the scholar_reviewer template gives the scholar step and the view, nothing else', async () => {
    expect(await holds(scholar, 'lesson_content.review_scholar')).toBe(true);
    expect(await holds(scholar, 'lesson_content.view')).toBe(true);
    expect(await holds(scholar, 'lesson_content.review_teacher')).toBe(false);
    const template = await g.prisma.$queryRaw<Array<{ max_tier: string; keys: string[] }>>`
      SELECT r.max_tier, array_agg(p.permission_key ORDER BY p.permission_key) AS keys
        FROM chat.access_role r JOIN chat.access_role_permission p ON p.role_id = r.id
       WHERE r.organization_id = ${orgId}::uuid AND r.key = 'scholar_reviewer' GROUP BY r.max_tier`;
    expect(template).toEqual([{ max_tier: 'specialist', keys: ['lesson_content.review_scholar', 'lesson_content.view'] }]);
    const delegable = await g.prisma.$queryRaw<Array<{ delegable: boolean }>>`SELECT delegable FROM chat.permission WHERE key = 'lesson_content.review_scholar'`;
    expect(delegable).toEqual([{ delegable: false }]);
  });

  it('a department manager cannot grant the scholar role: the super admin alone does (H5)', async () => {
    const account = await g.prisma.account.create({ data: { organizationId: orgId, subject: `would-be@${DOMAIN}`, kind: 'staff', status: 'active', isActive: true } });
    const other = (await g.prisma.staff.create({ data: { organizationId: orgId, name: 'QA Specialist', role: 'specialist', isActive: true, accountId: account.id } })).id;
    const e = await sqlError(g.prisma.$queryRaw`SELECT chat.grant_access_role(${other}::uuid, ${scholarRole}::uuid, 'spec', ${m.teachersManager.id}::uuid)`);
    // The H5 refusal itself: the role holds a key the manager may not grant.
    expect(e).toMatch(/permissions you may not grant: lesson_content\.review_scholar \(PD-40 H5\)/);
    expect(await holds(other, 'lesson_content.review_scholar')).toBe(false);
  });

  it('no request role reaches the table', async () => {
    for (const role of ['chat_app', 'authenticated']) {
      const r = await g.prisma.$queryRawUnsafe<Array<{ ok: boolean }>>(`select has_table_privilege('${role}', 'chat.lesson_content_review', 'SELECT') as ok`);
      expect({ role, ok: r[0]!.ok }).toEqual({ role, ok: false });
    }
  });
});

describe('PD-49: who may sign at all (review of #258)', () => {
  it("the super admin never signs as the scholar: the implicit every-key is not the Scholar reviewer role", async () => {
    expect(await holds(m.superAdmin.id, 'lesson_content.review_scholar')).toBe(true); // implicitly, as every key
    const t = 'sa text two';
    await sign('lesson-051', t, 'check', m.superAdmin.id);
    await sign('lesson-051', t, 'teacher', m.teachersManager.id);
    expect(await sqlError(sign('lesson-051', t, 'scholar', m.superAdmin.id))).toMatch(/granted the Scholar reviewer role/);
  });

  it('a suspended or departed signer is refused', async () => {
    const account = await g.prisma.account.create({ data: { organizationId: orgId, subject: `scholar2@${DOMAIN}`, kind: 'staff', status: 'active', isActive: true } });
    const second = (await g.prisma.staff.create({ data: { organizationId: orgId, name: 'QA Scholar Two', role: 'specialist', isActive: true, accountId: account.id } })).id;
    await g.prisma.$queryRaw`SELECT chat.grant_access_role(${second}::uuid, ${scholarRole}::uuid, 'spec', ${m.superAdmin.id}::uuid)`;
    const t = 'suspended text';
    await sign('lesson-052', t, 'check', m.superAdmin.id);
    await sign('lesson-052', t, 'teacher', m.teachersManager.id);
    await g.prisma.staff.update({ where: { id: second }, data: { isActive: false } });
    expect(await sqlError(sign('lesson-052', t, 'scholar', second))).toMatch(/active staff of the content organization/);
  });

  it('staff of another organization are refused, and nobody signs while the content organization is unset', async () => {
    const other = randomUUID();
    await g.prisma.$executeRawUnsafe(`insert into chat.organization (id, slug, display_name) values ('${other}'::uuid, 'pd49-x-${other.slice(0, 8)}', 'Another academy')`);
    const otherOwner = await g.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`);
      const account = await tx.account.create({ data: { organizationId: other, subject: `owner-x@${DOMAIN}`, kind: 'staff', status: 'active', isActive: true } });
      return (await tx.staff.create({ data: { organizationId: other, name: 'QA Other Owner', role: 'super_admin', isActive: true, accountId: account.id } })).id;
    });
    expect(await sqlError(sign('lesson-053', 'other org', 'check', otherOwner))).toMatch(/active staff of the content organization/);
    await setContentOrg(null);
    try {
      expect(await sqlError(sign('lesson-053', 'other org', 'check', m.superAdmin.id))).toMatch(/not set up/);
    } finally {
      await setContentOrg(orgId);
    }
  });

  it('two people racing for the same step: exactly one signs', async () => {
    const t = 'race text';
    await sign('lesson-054', t, 'check', m.superAdmin.id);
    // The teacher step, by two distinct holders of its key at once: the Teachers manager and a delegate.
    const account = await g.prisma.account.create({ data: { organizationId: orgId, subject: `teacher-signer@${DOMAIN}`, kind: 'staff', status: 'active', isActive: true } });
    const delegate = (await g.prisma.staff.create({ data: { organizationId: orgId, name: 'QA Teacher Signer', role: 'specialist', isActive: true, accountId: account.id } })).id;
    const role = await g.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT chat.define_access_role('teacher_signer', 'Teacher signer', 'Teacher signer', null, 'specialist',
             array['lesson_content.review_teacher', 'lesson_content.view']::text[], 'spec', ${m.superAdmin.id}::uuid)::text AS id`;
    await g.prisma.$queryRaw`SELECT chat.grant_access_role(${delegate}::uuid, ${role[0]!.id}::uuid, 'spec', ${m.superAdmin.id}::uuid)`;
    const results = await Promise.allSettled([sign('lesson-054', t, 'teacher', m.teachersManager.id), sign('lesson-054', t, 'teacher', delegate)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(String((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason)).toMatch(/already signed/);
  });
});

describe('PD-49: signing a text, step by step', () => {
  const T = 'tafsir-001 text v1';

  it('steps come in order, each from a different person holding its key', async () => {
    // The teacher step before the check: refused.
    expect(await sqlError(sign('tafsir-001', T, 'teacher', m.teachersManager.id))).toMatch(/comes after the check step/);
    // A Teachers supervisor holds no check key.
    expect(await sqlError(sign('tafsir-001', T, 'check', m.teacherSupervisors[0]!.id))).toMatch(/holding lesson_content.check/);
    expect(await sign('tafsir-001', T, 'check', m.superAdmin.id)).toEqual({ state: 'open', steps: ['check'] });
    // The scholar before the teacher: refused.
    expect(await sqlError(sign('tafsir-001', T, 'scholar', scholar))).toMatch(/comes after the teacher step/);
    // The person who checked does not also sign as the teacher.
    expect(await sqlError(sign('tafsir-001', T, 'teacher', m.superAdmin.id))).toMatch(/someone else/);
    expect(await sign('tafsir-001', T, 'teacher', m.teachersManager.id)).toEqual({ state: 'open', steps: ['check', 'teacher'] });
    // The Teachers manager holds no scholar key.
    expect(await sqlError(sign('tafsir-001', T, 'scholar', m.teachersManager.id))).toMatch(/holding lesson_content.review_scholar/);
    expect(await sign('tafsir-001', T, 'scholar', scholar)).toEqual({ state: 'open', steps: ['check', 'teacher', 'scholar'] });
    // A step is signed once.
    expect(await sqlError(sign('tafsir-001', T, 'check', m.teachersManager.id))).toMatch(/already signed|someone else/);
  });

  it('a changed text is a new hash and starts from the check', async () => {
    expect(await sqlError(sign('tafsir-001', 'tafsir-001 text v2', 'teacher', m.teachersManager.id))).toMatch(/comes after the check step/);
  });

  it('a withdrawal is final; a rejection is final; only a signed text is withdrawn', async () => {
    expect(await sign('tafsir-001', T, 'scholar', scholar, 'withdraw')).toEqual({ state: 'withdrawn', steps: ['check', 'teacher', 'scholar'] });
    expect(await sqlError(sign('tafsir-001', T, 'scholar', scholar, 'withdraw'))).toMatch(/is withdrawn/);
    expect(await sqlError(sign('word-001', 'word v1', 'check', m.superAdmin.id, 'withdraw'))).toMatch(/only a signed text is withdrawn/);
    expect(await sign('word-001', 'word v1', 'check', m.superAdmin.id, 'reject')).toEqual({ state: 'rejected', steps: [] });
    expect(await sqlError(sign('word-001', 'word v1', 'check', m.teachersManager.id))).toMatch(/is rejected/);
  });

  it('a game mechanic has no check step: the teacher, then the scholar', async () => {
    expect(await sqlError(sign('listen_glow', 'mechanic v1', 'check', m.superAdmin.id, 'approve', 'play'))).toMatch(/lesson_content_review_play_steps|check constraint/);
    expect(await sign('listen_glow', 'mechanic v1', 'teacher', m.teachersManager.id, 'approve', 'play')).toEqual({ state: 'open', steps: ['teacher'] });
    expect(await sign('listen_glow', 'mechanic v1', 'scholar', scholar, 'approve', 'play')).toEqual({ state: 'open', steps: ['teacher', 'scholar'] });
  });

  it('an approval carries no reason; a rejection carries one (the table says so too)', async () => {
    const e = await sqlError(g.prisma.$executeRaw`
      SELECT chat.review_lesson_content(${SCOPE}, 'lesson-001', ${sha('x')}, 'check', 'reject', null, null, ${m.superAdmin.id}::uuid)`);
    expect(e).toMatch(/lesson_content_review_reason|check constraint/);
  });

  it('reviews are never changed or removed, and every one is audited', async () => {
    expect(await sqlError(g.prisma.$executeRawUnsafe(`update chat.lesson_content_review set step = 'check' where scope = '${SCOPE}'`))).toMatch(/never changed or removed/);
    expect(await sqlError(g.prisma.$executeRawUnsafe(`delete from chat.lesson_content_review where scope = '${SCOPE}'`))).toMatch(/never changed or removed/);
    expect(await sqlError(g.prisma.$executeRawUnsafe(`truncate chat.lesson_content_review`))).toMatch(/never truncated/);
    const audited = await g.prisma.$queryRaw<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM chat.audit_log WHERE action LIKE 'lesson_content.%' AND after->>'scope' = ${SCOPE}`;
    const reviews = await g.prisma.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM chat.lesson_content_review WHERE scope = ${SCOPE}`;
    expect(audited[0]!.n).toBe(reviews[0]!.n);
    expect(reviews[0]!.n).toBeGreaterThan(0);
  });
});
