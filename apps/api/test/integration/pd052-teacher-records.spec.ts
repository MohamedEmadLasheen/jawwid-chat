/**
 * PD-52 · the teacher-records pages (docs/product/pd052-teacher-records-pages-plan.md).
 *
 * PR-1, the keys:
 *   1. the database holds the five keys, and every account that works the
 *      Teacher Supervision page today holds them through its legacy bundle
 *   2. the migration's copy gives every role that holds an old key its new keys
 *   3. GET /teacher-records/access answers per basis: Operations and the
 *      Teachers department both pages; Sales and an unplaced supervisor none
 *
 * The seed's PD-8 structure: manager_c runs Operations; admin_a (s.ownerId) and
 * admin_b (s.otherAdminId) are Operations supervisors. Synthetic fixtures only
 * (QA gate G-16).
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaAuditService } from '@platform/audit.service';
import { PermissionService } from '@platform/permissions/permission.service';
import { TeacherFileService } from '../../src/teacher-file/teacher-file.service';
import { TeacherRecordsService } from '../../src/teacher-file/teacher-records.service';
import { buildGraph, seed, truncate, Scenario } from './harness';

const g = buildGraph();
const audit = new PrismaAuditService();
const files = new TeacherFileService(g.prisma, g.authz, g.conversations, audit);
const records = new TeacherRecordsService(g.conversations, files, new PermissionService(g.prisma));

jest.setTimeout(120_000);

const NEW_KEYS = ['teacher_attendance.decide', 'teacher_attendance.record', 'teacher_attendance.view', 'teacher_grants.record', 'teacher_grants.view'];
const MIGRATION = join(__dirname, '..', '..', '..', '..', 'supabase', 'migrations', '20261031170000_chat_pd052_teacher_records_keys.sql');

let s: Scenario;
let tsupId: string;
let superId: string;
let salesId: string;
let looseId: string;

const keysOf = async (staffId: string) =>
  (
    await g.prisma.$queryRaw<Array<{ permissions: string[] | null }>>`
      SELECT permissions FROM chat.staff_access_profile(${staffId}::uuid)`
  )[0]?.permissions ?? [];

/** A Teachers supervisor, a Sales supervisor, a supervisor in no department, and a super admin. */
async function staffFixtures() {
  await g.prisma.$executeRawUnsafe(
    `insert into chat.staff (id, name, role, is_active) values
       ($1::uuid, 'tsup_a', 'admin', true), ($2::uuid, 'sales_a', 'admin', true), ($3::uuid, 'loose_a', 'admin', true)`,
    tsupId,
    salesId,
    looseId,
  );
  await g.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`);
    await tx.$executeRawUnsafe(`insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'root_c', 'super_admin', true)`, superId);
  });
  for (const [kind, member] of [
    ['teachers', tsupId],
    ['sales', salesId],
  ] as const) {
    const [{ id }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `insert into chat.department (kind, display_name) values ($1, $1) returning id::text as id`,
      kind,
    );
    await g.prisma.$executeRawUnsafe(
      `insert into chat.department_member (staff_id, organization_id, department_id, position)
       values ($1::uuid, chat.default_organization_id(), $2::uuid, 'supervisor')`,
      member,
      id,
    );
  }
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
  tsupId = randomUUID();
  superId = randomUUID();
  salesId = randomUUID();
  looseId = randomUUID();
  await staffFixtures();
});

describe('PD-52 PR-1: the keys', () => {
  it('1. the catalogue holds the five keys, held by exactly the accounts that hold the PD-26 page keys', async () => {
    const rows = await g.prisma.$queryRaw<Array<{ key: string }>>`
      SELECT key FROM chat.permission WHERE key LIKE 'teacher\_attendance.%' OR key LIKE 'teacher\_grants.%' ORDER BY key`;
    expect(rows.map((r) => r.key)).toEqual(NEW_KEYS);

    for (const who of [s.ownerId, s.managerId, tsupId, superId]) {
      const keys = await keysOf(who);
      expect(keys).toEqual(expect.arrayContaining(['teacher_supervision.view', ...NEW_KEYS]));
    }
    for (const who of [salesId, looseId]) {
      const keys = await keysOf(who);
      expect(keys).not.toContain('teacher_supervision.view');
      expect(keys.filter((k) => NEW_KEYS.includes(k))).toEqual([]);
    }
  });

  it('2. the migration copies every old grant of a role into its new keys, once', async () => {
    const define = (key: string, permissions: string[]) =>
      g.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT chat.define_access_role(${key}, ${key + ' (en)'}, ${key + ' (ar)'}, null, 'specialist', ${permissions}::text[], 'spec', ${superId}::uuid)::text AS id`.then(
        (r) => r[0]!.id,
      );
    const viewer = await define('pd052_viewer', ['teacher_supervision.view']);
    const recorder = await define('pd052_recorder', ['teacher_supervision.view', 'teacher_supervision.record']);
    const other = await define('pd052_other', ['lessons.view']);

    // The copy as the migration runs it (its own section of the file), twice: idempotent.
    const sql = readFileSync(MIGRATION, 'utf8');
    const begin = sql.indexOf("select set_config('chat.pd040_access_change', 'on', true);");
    const end = sql.indexOf("select set_config('chat.pd040_access_change', 'off', true);");
    expect(begin).toBeGreaterThan(-1);
    const copy = sql.slice(begin, end).split(';').map((x) => x.trim()).filter(Boolean);
    for (let round = 0; round < 2; round++) {
      await g.prisma.$transaction(async (tx) => {
        for (const statement of copy) await tx.$executeRawUnsafe(statement);
      });
    }

    const keysOfRole = async (role: string) =>
      (
        await g.prisma.$queryRaw<Array<{ k: string }>>`
          SELECT permission_key AS k FROM chat.access_role_permission WHERE role_id = ${role}::uuid ORDER BY permission_key`
      ).map((r) => r.k);
    expect(await keysOfRole(viewer)).toEqual(['teacher_attendance.view', 'teacher_grants.view', 'teacher_supervision.view']);
    expect(await keysOfRole(recorder)).toEqual([...NEW_KEYS, 'teacher_supervision.record', 'teacher_supervision.view'].sort());
    expect(await keysOfRole(other)).toEqual(['lessons.view']);
  });

  it('3. GET /teacher-records/access: Operations and the Teachers department both pages; Sales and the unplaced none', async () => {
    const ops = await records.access(s.ownerId);
    expect(ops).toMatchObject({
      basis: 'operations',
      attendance: { view: true, record: true, decide: true },
      grants: { view: true, record: true },
      leaveBalance: false,
      amounts: false,
      opensFile: false,
    });
    const teachers = await records.access(tsupId);
    expect(teachers).toMatchObject({ basis: 'teachers', attendance: { view: true, decide: true }, grants: { view: true }, leaveBalance: true, opensFile: true });
    expect((await records.access(superId)).amounts).toBe(true);
    for (const who of [salesId, looseId]) {
      expect(await records.access(who)).toMatchObject({ basis: null, attendance: { view: false }, grants: { view: false } });
    }
  });
});
