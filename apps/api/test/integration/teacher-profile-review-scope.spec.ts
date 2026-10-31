/**
 * TEACHER-001 (QA 2026-10-31): the credential review honours the PD-35
 * teacher scope, as every other teacher route does under strict scope.
 *
 * The Teachers department: tmgr manages it; heba supervises teacher_c and
 * ola teacher_d; teacher_e is nobody's -- the manager's alone. Each teacher
 * has a credential waiting for review. With strict scope ON:
 *
 *   queue     GET /teacher-profiles/review lists only the reviewer's teachers
 *   decide    POST /teacher-profiles/certificates/:id/decide outside them is 404
 *   download  the file link outside them is 404 (the owning teacher keeps theirs)
 *   tile      the Dashboard's teacher_profiles.pending counts the same queue
 *   manager   the Teachers Manager and the super admin keep every teacher
 *   off       strict scope OFF: every reviewer sees every teacher, as before
 *
 * Synthetic fixtures only (G-16).
 */
import { randomUUID } from 'node:crypto';
import { PrismaAuditService } from '@platform/audit.service';
import { CommError, CommErrorCode } from '@platform/errors';
import { TeacherScopeService } from '@platform/teacher-scope';
import { LocalFsBlobStore } from '@communication/attachments/blob-store';
import { SeatPolicyRegistry } from '@communication/seats/seat-policy';
import { SupervisionConversationService } from '../../src/supervision/supervision-conversation.service';
import { CardPoster } from '../../src/supervision/card-poster';
import { TrialGroupService } from '../../src/lessons/trial-group.service';
import { TeacherSupervisorService } from '../../src/teacher-supervisors/teacher-supervisor.service';
import { buildGraph, seed, truncate, Scenario } from './harness';

const g = buildGraph();
const audit = new PrismaAuditService();
const scope = new TeacherScopeService(g.prisma);
const supervisionChats = new SupervisionConversationService(g.prisma, g.authz, g.conversations, g.outbox, audit, scope);
const cards = new CardPoster(g.conversations, g.outbox, audit);
const trialGroups = new TrialGroupService(g.prisma, g.authz, g.conversations, g.outbox, cards, g.config, audit);
const supervisors = new TeacherSupervisorService(g.prisma, g.conversations, new SeatPolicyRegistry(), scope, supervisionChats, trialGroups, audit);
const profiles = g.teacherProfiles;
const blobs = new LocalFsBlobStore();

jest.setTimeout(120_000);

let s: Scenario;
let tmgr: string;
let heba: string;
let ola: string;
let superId: string;
/** Each teacher's waiting credential. */
let cred: { c: string; d: string; e: string };

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

/** A credential the teacher uploads the way the client does (authorize, then claim), waiting for review. */
async function credential(teacherId: string, title: string): Promise<string> {
  const authorization = await profiles.authorizeCertificateUpload(teacherId, { mimeType: 'application/pdf', byteSize: 1024 });
  const bytes = Buffer.alloc(1024, 0x20);
  Buffer.from('%PDF-1.4\n').copy(bytes);
  await blobs.put(authorization.uploadToken, 'application/pdf', bytes);
  const profile = await profiles.addCertificate(teacherId, { title, mimeType: 'application/pdf', byteSize: 1024, uploadToken: authorization.uploadToken });
  return profile.certificates.find((c) => c.title === title)!.id;
}

const queue = async (actorId: string) => (await profiles.certificateReviewQueue(actorId)).map((p) => p.teacherName).sort();
const tile = async (actorId: string) => (await profiles.dashboardCounts(actorId)).find((t) => t.key === 'teacher_profiles.pending')?.count;

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
  [tmgr, heba, ola, superId] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  await g.prisma.$executeRawUnsafe(
    `insert into chat.staff (id, name, role, is_active)
     values ($1::uuid, 'tmgr_x', 'manager', true), ($2::uuid, 'heba_a', 'admin', true), ($3::uuid, 'ola_b', 'admin', true)`,
    tmgr, heba, ola,
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
     values ($1::uuid, chat.default_organization_id(), $3::uuid, 'supervisor'),
            ($2::uuid, chat.default_organization_id(), $3::uuid, 'supervisor')`,
    heba, ola, dept,
  );
  await supervisors.assign(tmgr, s.teacherId, { supervisorId: heba });
  await supervisors.assign(tmgr, s.newTeacherId, { supervisorId: ola });
  cred = {
    c: await credential(s.teacherId, 'Ijazah C'),
    d: await credential(s.newTeacherId, 'Ijazah D'),
    e: await credential(s.unrelatedTeacherId, 'Ijazah E'),
  };
});

describe('TEACHER-001: credential review under strict scope', () => {
  beforeEach(async () => {
    await strict(true);
  });

  it("lists only the reviewer's teachers; the manager and the super admin every teacher", async () => {
    expect(await queue(heba)).toEqual(['teacher_c']);
    expect(await queue(ola)).toEqual(['teacher_d']);
    expect(await queue(tmgr)).toEqual(['teacher_c', 'teacher_d', 'teacher_e']);
    expect(await queue(superId)).toEqual(['teacher_c', 'teacher_d', 'teacher_e']);
  });

  it("refuses a decision on another supervisor's teacher, and on the manager's own, as not found", async () => {
    expect(await code(profiles.decideCertificate(heba, cred.d, { approved: true }))).toBe(CommErrorCode.TEACHER_CERTIFICATE_NOT_FOUND);
    expect(await code(profiles.decideCertificate(heba, cred.e, { approved: true }))).toBe(CommErrorCode.TEACHER_CERTIFICATE_NOT_FOUND);
    // Nothing changed.
    const d = await g.prisma.teacherProfileCertificate.findUniqueOrThrow({ where: { id: cred.d } });
    expect(d.state).toBe('pending');
    // Her own teacher, yes; the manager decides any.
    expect((await profiles.decideCertificate(heba, cred.c, { approved: true })).teacherName).toBe('teacher_c');
    expect((await profiles.decideCertificate(tmgr, cred.e, { approved: true })).teacherName).toBe('teacher_e');
  });

  it('refuses the file link outside the scope; the owning teacher keeps theirs', async () => {
    expect(await code(profiles.certificateDownloadUrl(heba, cred.d))).toBe(CommErrorCode.TEACHER_CERTIFICATE_NOT_FOUND);
    expect(await code(profiles.authorizeCertificateRead(cred.d, heba))).toBe(CommErrorCode.TEACHER_CERTIFICATE_NOT_FOUND);
    expect(typeof (await profiles.certificateDownloadUrl(heba, cred.c))).toBe('string');
    expect((await profiles.authorizeCertificateRead(cred.d, s.newTeacherId)).objectKey).toBeTruthy();
    expect((await profiles.authorizeCertificateRead(cred.d, superId)).objectKey).toBeTruthy();
  });

  it("counts the Dashboard tile over the same queue", async () => {
    expect(await tile(heba)).toBe(1);
    expect(await tile(ola)).toBe(1);
    expect(await tile(tmgr)).toBe(3);
    expect(await tile(superId)).toBe(3);
  });
});

describe('TEACHER-001: strict scope off', () => {
  it('every reviewer sees and decides every teacher, as before', async () => {
    expect(await queue(heba)).toEqual(['teacher_c', 'teacher_d', 'teacher_e']);
    expect(await tile(heba)).toBe(3);
    expect((await profiles.decideCertificate(heba, cred.d, { approved: true })).teacherName).toBe('teacher_d');
  });
});
