/**
 * Access management M2: the department-kind audit's corrections, proven against the real database.
 *
 * Two parts:
 *  1. NO BEHAVIOUR CHANGE for the three core departments (the existing suites for conversations, cases, tasks, teacher
 *     records and moderation are the broad proof; the controls here pin the specific rules that were edited).
 *  2. A SIMULATED future: inside a transaction that is always rolled back, the closed-set constraints are lifted and two
 *     distinct departments of the not-yet-existing kind 'general' are created. They must reach NOTHING: no manager standing,
 *     no principals, no case ownership, no task standing, no tier default permissions, and two of them are never "the same
 *     department" for voiding a testimonial. (The real schema change is stage M5; nothing here writes a general department.)
 *
 * Synthetic people only (G-20).
 */
import { randomUUID } from 'node:crypto';
import { hashPassword } from '@platform/auth/password';
import { seedOrgChat, type SeedManifest } from '../../src/cli/org-chat-seed';
import { buildGraph, truncate } from './harness';

jest.setTimeout(300_000);
const DOMAIN = 'deptkind.qa.jawwid.test';
const PASSWORD = 'deptkind-spec-password-1';
const g = buildGraph();
let orgId: string;
let m: SeedManifest;

beforeAll(async () => {
  await g.prisma.$connect();
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'deptkind-%'`);
  orgId = randomUUID();
  await g.prisma.$executeRawUnsafe(`insert into chat.organization (id, slug, display_name) values ('${orgId}'::uuid, 'deptkind-${orgId.slice(0, 8)}', 'Dept kind QA academy')`);
  await g.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`);
    const account = await tx.account.create({ data: { organizationId: orgId, subject: `owner@${DOMAIN}`, kind: 'staff', status: 'active', isActive: true } });
    await tx.accountCredential.create({ data: { accountId: account.id, passwordHash: await hashPassword(PASSWORD) } });
    await tx.staff.create({ data: { organizationId: orgId, name: 'QA Owner', role: 'super_admin', isActive: true, accountId: account.id } });
  });
  m = await seedOrgChat(g.prisma, { organizationId: orgId, emailDomain: DOMAIN, password: PASSWORD, passwordHash: await hashPassword(PASSWORD), messages: false });
});

afterAll(async () => {
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'deptkind-%'`);
  await g.prisma.$disconnect();
});

const q = async <T>(tx: { $queryRawUnsafe: (s: string, ...a: unknown[]) => Promise<unknown> }, sql: string, ...args: unknown[]) => (await tx.$queryRawUnsafe(sql, ...args)) as T[];

describe('1. the three core departments behave exactly as before', () => {
  it('the helper names the core kinds and nothing else', async () => {
    const r = await g.prisma.$queryRaw<Array<{ a: boolean; b: boolean; c: boolean; d: boolean; e: boolean }>>`
      SELECT chat.is_core_department_kind('operations') a, chat.is_core_department_kind('teachers') b, chat.is_core_department_kind('sales') c,
             chat.is_core_department_kind('general') d, chat.is_core_department_kind(null) e`;
    expect(r[0]).toEqual({ a: true, b: true, c: true, d: false, e: null });
  });

  it('a core department manager still acts for and sees the supervisors of their department; a supervisor of that department is still "the same department"', async () => {
    const tm = m.teachersManager.id;
    const sup = m.teacherSupervisors[0]!.id;
    const sup2 = m.teacherSupervisors[1]!.id;
    const acts = await g.prisma.$queryRaw<Array<{ r: string | null }>>`SELECT chat.staff_acts_for(${tm}::uuid, ${sup}::uuid, now()) AS r`;
    expect(acts[0]!.r).toBe('manager');
    const principals = await g.prisma.$queryRaw<Array<{ id: string }>>`SELECT chat.staff_principals(${tm}::uuid, now())::text AS id`;
    expect(principals.map((p) => p.id)).toEqual(expect.arrayContaining([tm, sup]));
    const void_ = await g.prisma.$queryRaw<Array<{ ok: boolean }>>`SELECT chat.may_void_testimonial(${sup}::uuid, ${sup2}::uuid, ${orgId}::uuid) AS ok`;
    expect(void_[0]!.ok).toBe(true);
    // ...and a supervisor of ANOTHER core department is not.
    const opsSup = m.supervisors[0]!.id;
    expect((await g.prisma.$queryRaw<Array<{ ok: boolean }>>`SELECT chat.may_void_testimonial(${opsSup}::uuid, ${sup}::uuid, ${orgId}::uuid) AS ok`)[0]!.ok).toBe(false);
    // The Operations manager and the super admin may void any, as before.
    expect((await g.prisma.$queryRaw<Array<{ ok: boolean }>>`SELECT chat.may_void_testimonial(${m.operationsManager.id}::uuid, ${sup}::uuid, ${orgId}::uuid) AS ok`)[0]!.ok).toBe(true);
    expect((await g.prisma.$queryRaw<Array<{ ok: boolean }>>`SELECT chat.may_void_testimonial(${m.superAdmin.id}::uuid, ${sup}::uuid, ${orgId}::uuid) AS ok`)[0]!.ok).toBe(true);
  });

  it('a core department manager still fits a case of their own department; task standing over their staff is unchanged', async () => {
    const dept = m.departments.teachers;
    const fits = await g.prisma.$queryRaw<Array<{ ok: boolean }>>`SELECT chat.case_owner_fits(${m.teachersManager.id}::uuid, ${dept}::uuid, null::uuid, null::uuid) AS ok`;
    expect(fits[0]!.ok).toBe(true);
    const standing = await g.prisma.$queryRaw<Array<{ s: string | null }>>`
      SELECT chat.work_task_standing(${m.teachersManager.id}::uuid, ${orgId}::uuid, ${m.teacherSupervisors[0]!.id}::uuid, null::uuid, null::uuid) AS s`;
    expect(standing[0]!.s).toBe('manager');
    const managed = await g.prisma.$queryRaw<Array<{ u: boolean }>>`SELECT chat.work_task_unmanaged(${orgId}::uuid, ${m.teacherSupervisors[0]!.id}::uuid, null::uuid, null::uuid) AS u`;
    expect(managed[0]!.u).toBe(false);
  });
});

describe('2. a simulated configurable department reaches nothing (rolled back; nothing is written)', () => {
  it('two distinct "general" departments: no manager reach, no principals, no case ownership, no task standing, no tier default keys, never the same department', async () => {
    const ROLLBACK = new Error('rollback');
    let seen: Record<string, unknown> = {};
    await g.prisma
      .$transaction(async (tx) => {
        // Lift the closed set for this transaction only (M5 does it for real, with a partial unique index).
        await tx.$executeRawUnsafe(`alter table chat.department drop constraint department_kind_check`);
        await tx.$executeRawUnsafe(`alter table chat.department drop constraint department_one_kind_per_organization`);
        const mk = async (name: string, role: string) =>
          (await q<{ id: string }>(tx, `insert into chat.staff (organization_id, name, role, is_active) values ($1::uuid, $2, $3, true) returning id::text`, orgId, name, role))[0]!.id;
        const [m1, m2, s1, s2, s1b] = [await mk('G Manager 1', 'manager'), await mk('G Manager 2', 'manager'), await mk('G Member 1', 'admin'), await mk('G Member 2', 'admin'), await mk('G Member 1b', 'admin')];
        const dept = async (name: string, mgr: string) =>
          (await q<{ id: string }>(tx, `insert into chat.department (organization_id, kind, display_name, manager_id) values ($1::uuid, 'general', $2, $3::uuid) returning id::text`, orgId, name, mgr))[0]!.id;
        const [d1, d2] = [await dept('General One', m1), await dept('General Two', m2)];
        for (const [s, d] of [[s1, d1], [s1b, d1], [s2, d2]] as const) {
          await tx.$executeRawUnsafe(`insert into chat.department_member (staff_id, organization_id, department_id, position) values ($1::uuid, $2::uuid, $3::uuid, 'supervisor')`, s, orgId, d);
        }
        const one = async <T>(sql: string, ...a: unknown[]) => (await q<T>(tx, sql, ...a))[0]!;
        seen = {
          actsFor: (await one<{ r: string | null }>(`select chat.staff_acts_for($1::uuid, $2::uuid, now()) r`, m1, s1)).r,
          principals: (await q<{ id: string }>(tx, `select chat.staff_principals($1::uuid, now())::text id`, m1)).map((r) => r.id),
          caseFits: (await one<{ ok: boolean }>(`select chat.case_owner_fits($1::uuid, $2::uuid, null::uuid, null::uuid) ok`, m1, d1)).ok,
          caseFitsMember: (await one<{ ok: boolean }>(`select chat.case_owner_fits($1::uuid, $2::uuid, null::uuid, null::uuid) ok`, s1, d1)).ok,
          standing: (await one<{ s: string | null }>(`select chat.work_task_standing($1::uuid, $2::uuid, $3::uuid, null::uuid, null::uuid) s`, m1, orgId, s1)).s,
          unmanaged: (await one<{ u: boolean }>(`select chat.work_task_unmanaged($1::uuid, $2::uuid, null::uuid, null::uuid) u`, orgId, s1)).u,
          sameDeptVoid: (await one<{ ok: boolean }>(`select chat.may_void_testimonial($1::uuid, $2::uuid, $3::uuid) ok`, s1, s1b, orgId)).ok,
          otherDeptVoid: (await one<{ ok: boolean }>(`select chat.may_void_testimonial($1::uuid, $2::uuid, $3::uuid) ok`, s1, s2, orgId)).ok,
          ids: (await one<{ a: string; b: string }>(`select chat.staff_department_id($1::uuid) a, chat.staff_department_id($2::uuid) b`, s1, s2)),
          profileManager: await one<{ tier: string; department_kind: string; permissions: string[] }>(`select tier, department_kind, permissions from chat.staff_access_profile($1::uuid)`, m1),
          profileMember: await one<{ tier: string; permissions: string[] }>(`select tier, permissions from chat.staff_access_profile($1::uuid)`, s1),
          sources: (await q<{ k: string }>(tx, `select permission_key k from chat.staff_access_sources($1::uuid)`, m1)).length,
          wasKinds: (await q<{ kind: string }>(tx, `select distinct kind from chat.department order by 1`)).map((r) => r.kind),
        };
        throw ROLLBACK;
      })
      .catch((e) => {
        if (e !== ROLLBACK) throw e;
      });
    expect(seen).toMatchObject({
      actsFor: null,
      principals: [expect.any(String)],
      caseFits: false,
      caseFitsMember: false,
      standing: null,
      unmanaged: true,
      sameDeptVoid: false, // colleagues in one general department: still no (the voiding rule is a core-department rule)
      otherDeptVoid: false,
      profileManager: { tier: 'manager', department_kind: 'general', permissions: [] },
      profileMember: { permissions: [] },
      sources: 0,
      wasKinds: expect.arrayContaining(['general', 'operations', 'teachers', 'sales']),
    });
    expect((seen.ids as { a: string; b: string }).a).not.toBe((seen.ids as { a: string; b: string }).b);
    // And nothing survived the rollback: the constraints and the closed set are back.
    const after = await g.prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*)::bigint AS n FROM chat.department WHERE kind = 'general'`;
    expect(after[0]!.n).toBe(0n);
    await expect(g.prisma.$executeRawUnsafe(`insert into chat.department (organization_id, kind, display_name) values ('${orgId}'::uuid, 'general', 'x')`)).rejects.toThrow();
  });
});
