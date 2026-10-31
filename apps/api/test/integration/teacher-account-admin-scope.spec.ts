/**
 * TEACHER-011 (P1, QA 2026-10-31): account administration over a TEACHER
 * account follows the caller's PD-35 teacher scope, exactly as the other
 * teacher routes do under the strict switch.
 *
 * The Teachers department: tmgr manages it; heba supervises teacher_c and
 * ola teacher_d; teacher_e is nobody's. bak backs ola up -- the link
 * dormant, then active. With strict scope ON:
 *
 *   list      GET /admin/accounts lists only the caller's teachers
 *   get       another's teacher reads as not found
 *   acts      reset, suspend, reactivate, sign-out and impersonation outside
 *             the scope are refused as not found; inside, allowed and audited
 *   backup    an active backup reaches the primary's teacher; a dormant one not
 *   manager   the Teachers Manager and the super admin stay organization-wide
 *   off       strict scope OFF: every Teachers-department member, as before
 *
 * Parent accounts are untouched here (ADMIN-002, waiting on the owner).
 * Synthetic fixtures only (G-16).
 */
import { randomUUID } from 'node:crypto';
import { PrismaAuditService } from '@platform/audit.service';
import { CommError, CommErrorCode } from '@platform/errors';
import { PrismaIdentityService } from '@platform/identity.service';
import { AuthService } from '@platform/auth/auth.service';
import { PasswordResetService } from '@platform/auth/password-reset.service';
import { TeacherScopeService } from '@platform/teacher-scope';
import type { Actor } from '@platform/types';
import { SeatPolicyRegistry } from '@communication/seats/seat-policy';
import { AccountAdminService } from '../../src/account-admin/account-admin.service';
import { ImpersonationService } from '../../src/account-admin/impersonation.service';
import { SupervisionConversationService } from '../../src/supervision/supervision-conversation.service';
import { CardPoster } from '../../src/supervision/card-poster';
import { TrialGroupService } from '../../src/lessons/trial-group.service';
import { TeacherSupervisorService } from '../../src/teacher-supervisors/teacher-supervisor.service';
import { buildGraph, seed, truncate, Scenario } from './harness';

const g = buildGraph();
const audit = new PrismaAuditService();
const identity = new PrismaIdentityService(g.prisma);
const auth = new AuthService(g.prisma, identity, audit);
const accounts = new AccountAdminService(g.prisma, g.authz, auth, new PasswordResetService(g.prisma, auth, audit), audit);
const impersonation = new ImpersonationService(g.prisma, g.authz, auth, identity, audit);
const scope = new TeacherScopeService(g.prisma);
const supervisionChats = new SupervisionConversationService(g.prisma, g.authz, g.conversations, g.outbox, audit, scope);
const cards = new CardPoster(g.conversations, g.outbox, audit);
const trialGroups = new TrialGroupService(g.prisma, g.authz, g.conversations, g.outbox, cards, g.config, audit);
const supervisors = new TeacherSupervisorService(g.prisma, g.conversations, new SeatPolicyRegistry(), scope, supervisionChats, trialGroups, audit);

jest.setTimeout(120_000);

let s: Scenario;
let tmgr: string;
let heba: string;
let ola: string;
let bak: string;
let superId: string;
/** Each teacher's account, and each administrator's own (an act records who did it). */
let acct: { c: string; d: string; e: string };
let own: Record<string, string>;

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof CommError) return e.code;
    throw e;
  }
  throw new Error('expected a refusal, got success');
}

const strict = (on: boolean) =>
  g.prisma.$executeRaw`UPDATE chat.config SET value = ${JSON.stringify(on)}::jsonb WHERE key = 'teacher_supervisor.strict_scope'`;
const actor = (id: string): Promise<Actor> => g.conversations.requireActor(id);

/** A live sign-in account for a teacher row. */
async function teacherAccount(teacherId: string): Promise<string> {
  const a = await g.prisma.account.create({ data: { subject: `t-${randomUUID()}@acct.test`, kind: 'teacher', status: 'active', isActive: true } });
  await g.prisma.teacher.update({ where: { id: teacherId }, data: { accountId: a.id } });
  return a.id;
}

/** A sign-in account for a staff row. */
async function staffAccount(staffId: string): Promise<string> {
  const a = await g.prisma.account.create({ data: { subject: `s-${randomUUID()}@acct.test`, kind: 'staff', status: 'active', isActive: true } });
  await g.prisma.staff.update({ where: { id: staffId }, data: { accountId: a.id } });
  return a.id;
}

const listed = async (who: string) =>
  (await accounts.list(await actor(who), { kind: 'teacher' })).accounts.map((a) => a.name).sort();

beforeAll(async () => {
  await g.prisma.$connect();
});
afterAll(async () => {
  await strict(false);
  await truncate(g.prisma);
  await g.prisma.$disconnect();
});
beforeEach(async () => {
  await truncate(g.prisma);
  await strict(false);
  s = await seed(g.prisma);
  [tmgr, heba, ola, bak, superId] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  await g.prisma.$executeRawUnsafe(
    `insert into chat.staff (id, name, role, is_active)
     values ($1::uuid, 'tmgr_x', 'manager', true), ($2::uuid, 'heba_a', 'admin', true),
            ($3::uuid, 'ola_b', 'admin', true), ($4::uuid, 'bak_c', 'coverage', true)`,
    tmgr, heba, ola, bak,
  );
  await g.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`);
    await tx.$executeRawUnsafe(`insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'root_d', 'super_admin', true)`, superId);
  });
  const [{ id: dept }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `insert into chat.department (kind, display_name, manager_id) values ('teachers', 'teachers', $1::uuid) returning id::text as id`,
    tmgr,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.department_member (staff_id, organization_id, department_id, position)
     values ($1::uuid, chat.default_organization_id(), $4::uuid, 'supervisor'),
            ($2::uuid, chat.default_organization_id(), $4::uuid, 'supervisor'),
            ($3::uuid, chat.default_organization_id(), $4::uuid, 'backup_supervisor')`,
    heba, ola, bak, dept,
  );
  await supervisors.assign(tmgr, s.teacherId, { supervisorId: heba });
  await supervisors.assign(tmgr, s.newTeacherId, { supervisorId: ola });
  acct = { c: await teacherAccount(s.teacherId), d: await teacherAccount(s.newTeacherId), e: await teacherAccount(s.unrelatedTeacherId) };
  own = { heba: await staffAccount(heba), ola: await staffAccount(ola), tmgr: await staffAccount(tmgr), superId: await staffAccount(superId) };
});

describe('TEACHER-011: teacher accounts under strict scope', () => {
  beforeEach(async () => {
    await strict(true);
  });

  it("lists only the caller's teachers; the manager and the super admin every teacher", async () => {
    expect(await listed(ola)).toEqual(['teacher_d']);
    expect(await listed(heba)).toEqual(['teacher_c']);
    expect(await listed(tmgr)).toEqual(['teacher_c', 'teacher_d', 'teacher_e']);
    expect(await listed(superId)).toEqual(['teacher_c', 'teacher_d', 'teacher_e']);
  });

  it("refuses every act on another supervisor's teacher and on an unassigned one, as not found -- and changes nothing", async () => {
    const o = await actor(ola);
    for (const target of [acct.c, acct.e]) {
      expect(await code(accounts.get(o, target))).toBe(CommErrorCode.ACCOUNT_ADMIN_NOT_FOUND);
      expect(await code(accounts.issuePasswordReset(o, own.ola!, target, { reason: 'qa' }))).toBe(CommErrorCode.ACCOUNT_ADMIN_NOT_FOUND);
      expect(await code(accounts.suspend(o, own.ola!, target, { reason: 'qa' }))).toBe(CommErrorCode.ACCOUNT_ADMIN_NOT_FOUND);
      expect(await code(accounts.reactivate(o, target, { reason: 'qa' }))).toBe(CommErrorCode.ACCOUNT_ADMIN_NOT_FOUND);
      expect(await code(accounts.revokeAllSessions(o, own.ola!, target, { reason: 'qa' }))).toBe(CommErrorCode.ACCOUNT_ADMIN_NOT_FOUND);
      expect(await code(accounts.listSessions(o, target))).toBe(CommErrorCode.ACCOUNT_ADMIN_NOT_FOUND);
      expect(
        await code(impersonation.start({ actor: o, accountId: own.ola!, sessionId: randomUUID() }, { accountId: target, reason: 'qa' })),
      ).toBe(CommErrorCode.ACCOUNT_ADMIN_NOT_FOUND);
    }
    const untouched = await g.prisma.account.findMany({ where: { id: { in: [acct.c, acct.e] } }, select: { status: true } });
    expect(untouched.map((a) => a.status)).toEqual(['active', 'active']);
    expect(await g.prisma.passwordResetCode.count({ where: { accountId: { in: [acct.c, acct.e] } } })).toBe(0);
  });

  it('allows every act on her own teacher, and the audit row is written', async () => {
    const o = await actor(ola);
    const summary = await accounts.get(o, acct.d);
    expect(summary.allowed).toMatchObject({ resetPassword: true, suspend: true, impersonate: true, signOut: true });
    const reset = await accounts.issuePasswordReset(o, own.ola!, acct.d, { reason: 'locked out' });
    expect(reset.expiresInMinutes).toBeGreaterThan(0);
    await accounts.suspend(o, own.ola!, acct.d, { reason: 'qa suspend' });
    await accounts.reactivate(o, acct.d, { reason: 'qa back' });
    const rows = await g.prisma.auditLog.findMany({ where: { entityId: acct.d, actorId: ola }, select: { action: true } });
    expect(rows.length).toBeGreaterThanOrEqual(3);
  });

  it("an active backup reaches the primary's teacher; a dormant one does not", async () => {
    const org = (await g.prisma.staff.findUniqueOrThrow({ where: { id: ola } })).organizationId;
    const [{ id: link }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `insert into chat.supervisor_backup (organization_id, primary_id, backup_id) values ($1::uuid, $2::uuid, $3::uuid) returning id::text as id`,
      org, ola, bak,
    );
    expect(await listed(bak)).toEqual([]);
    expect(await code(accounts.get(await actor(bak), acct.d))).toBe(CommErrorCode.ACCOUNT_ADMIN_NOT_FOUND);
    await g.prisma.$executeRawUnsafe(
      `update chat.supervisor_backup set activated_at = now() - interval '1 hour', active_until = now() + interval '7 days' where id = $1::uuid`,
      link,
    );
    expect(await listed(bak)).toEqual(['teacher_d']);
    expect((await accounts.get(await actor(bak), acct.d)).allowed.resetPassword).toBe(true);
  });

  it('the Teachers Manager and the super admin act on any teacher', async () => {
    expect((await accounts.get(await actor(tmgr), acct.e)).allowed.suspend).toBe(true);
    expect((await accounts.get(await actor(superId), acct.c)).allowed.suspend).toBe(true);
  });
});

describe('TEACHER-011: strict scope off', () => {
  it('every Teachers-department member administers every teacher, as the other teacher routes allow', async () => {
    expect(await listed(ola)).toEqual(['teacher_c', 'teacher_d', 'teacher_e']);
    expect((await accounts.get(await actor(ola), acct.c)).allowed.resetPassword).toBe(true);
  });
});
