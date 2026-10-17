import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { hashPassword } from '../platform/auth/password';
import { AuthorizationService } from '../platform/authorization.service';
import { SqlCoverageService } from '../platform/coverage.service';
import { SqlStaffScope } from '../platform/staff-scope';
import { PrismaIdentityService } from '../platform/identity.service';
import { PrismaAuditService } from '../platform/audit.service';
import { PrismaRelationshipService } from '../platform/relationship.service';
import { AppConfigService } from '../platform/app-config.service';
import type { PrismaService } from '../platform/prisma.service';
import { ConversationService } from '../communication/conversations/conversation.service';
import { MessageService } from '../communication/messages/message.service';
import { AttachmentService } from '../communication/attachments/attachment.service';
import type { ObjectStorage } from '../communication/attachments/object-storage';
import { OutboxService } from '../communication/outbox/outbox.service';
import { OrgStructureService } from '../org/org-structure.service';
import { MIN_PASSWORD_LENGTH } from './super-admin-bootstrap';
import { insertLearnerWithTeacherForQa } from './qa-teacher-assignment';

/**
 * PD-8 QA data: the organization structure the product owner described, with
 * SYNTHETIC people (owner decision 2026-10-15 -- six of the requested names
 * are real employees, and G-20 / system-inventory §4 keep real names out of
 * seed data). The SHAPE is the real one:
 *
 *   Super Admin
 *   ├─ Operations Manager ── 4 primary supervisors + 2 backup supervisors
 *   │                         (backup A covers primaries 1 and 2, backup B 3 and 4)
 *   ├─ Teachers Manager  ── 2 teacher supervisors
 *   └─ Sales Manager     ── (no team yet)
 *
 *   10 teachers; 30 parents with 1, 2, 3 or 4 children (68 children), spread
 *   over supervisors and teachers so that all four real-world shapes occur:
 *
 *   A  every child: same supervisor, same teacher
 *   B  every child: same supervisor, different teachers
 *   C  two supervisors, the same teacher
 *   D  two or more supervisors, several teachers
 *
 * Everything is written through the product's own services, acting as the
 * person who would do it in real life -- the super admin builds the
 * departments, the Operations Manager assigns every child and configures the
 * backups, each supervisor creates their own family groups -- so the seed
 * passes the same authorization and database checks a real user would.
 */

export const SEED_STAFF = {
  operationsManager: { key: 'ops.manager', name: 'Laila Mansour', role: 'manager' },
  salesManager: { key: 'sales.manager', name: 'Yasmin Farouk', role: 'manager' },
  teachersManager: { key: 'teachers.manager', name: 'Hana Saleh', role: 'manager' },
  supervisors: [
    { key: 'sup.noura', name: 'Noura Adel', role: 'admin' },
    { key: 'sup.salma', name: 'Salma Khalil', role: 'admin' },
    { key: 'sup.mona', name: 'Mona Fathy', role: 'admin' },
    { key: 'sup.reem', name: 'Reem Nabil', role: 'admin' },
  ],
  backups: [
    { key: 'backup.amira', name: 'Amira Samir', role: 'coverage', covers: [0, 1] },
    { key: 'backup.dalia', name: 'Dalia Hamdy', role: 'coverage', covers: [2, 3] },
  ],
  teacherSupervisors: [
    { key: 'tsup.ola', name: 'Ola Mahmoud', role: 'admin' },
    { key: 'tsup.heba', name: 'Heba Ramzy', role: 'admin' },
  ],
} as const;

export const SEED_TEACHERS = [
  'Omar Khaled', 'Youssef Ibrahim', 'Ahmed Tarek', 'Mahmoud Saber', 'Khaled Fawzy',
  'Mostafa Galal', 'Ibrahim Zaki', 'Karim Nasser', 'Rania Fouad', 'Ghada Ezzat',
] as const;

const SURNAMES = [
  'El-Sayed', 'Hassan', 'Abdelrahman', 'Fathi', 'Mostafa', 'Ali', 'Youssef', 'Hamdy', 'Kamal', 'Farag',
  'Shawky', 'Ragab', 'Hegazy', 'Nasr', 'Badawi', 'Soliman', 'Gaber', 'Lotfy', 'Ashour', 'Sherif',
  'Eid', 'Taha', 'Amer', 'Wahba', 'Darwish', 'Ghoneim', 'Halawa', 'Morsy', 'Selim', 'Bakr',
] as const;
const PARENT_FIRST = [
  'Tarek', 'Nermeen', 'Hany', 'Rasha', 'Sameh', 'Dalal', 'Wael', 'Shereen', 'Hesham', 'Nahla',
  'Ayman', 'Marwa', 'Sherif', 'Abeer', 'Essam', 'Hoda', 'Amr', 'Nevine', 'Ashraf', 'Lamiaa',
  'Medhat', 'Samar', 'Magdy', 'Eman', 'Adel', 'Inas', 'Fady', 'Sally', 'Ramy', 'Yara',
] as const;
const CHILD_FIRST = [
  'Adam', 'Jana', 'Yassin', 'Malak', 'Ziad', 'Farida', 'Hamza', 'Lojain', 'Seif', 'Tala',
  'Eyad', 'Habiba', 'Marwan', 'Leen', 'Anas', 'Nour', 'Belal', 'Razan', 'Taim', 'Jori',
  'Mazen', 'Salwa', 'Khaled', 'Hala', 'Moaz', 'Mira', 'Yahia', 'Ruba', 'Ali', 'Haya',
  'Saleh', 'Rahaf', 'Omar', 'Lina', 'Nader', 'Aya', 'Fares', 'Dana', 'Hazem', 'Logy',
] as const;

export type FamilyScenario = 'single' | 'A' | 'B' | 'C' | 'D';

/** Children per family, and the shape each multi-child family takes. Index = family. */
export const FAMILY_PLAN: ReadonlyArray<{ kids: 1 | 2 | 3 | 4; scenario: FamilyScenario }> = [
  ...Array.from({ length: 9 }, () => ({ kids: 1 as const, scenario: 'single' as const })),
  ...(['A', 'B', 'C', 'D', 'A', 'B', 'C', 'D', 'A'] as const).map((scenario) => ({ kids: 2 as const, scenario })),
  ...(['A', 'B', 'C', 'D', 'A', 'B', 'D'] as const).map((scenario) => ({ kids: 3 as const, scenario })),
  ...(['A', 'B', 'C', 'D', 'D'] as const).map((scenario) => ({ kids: 4 as const, scenario })),
];

/** Supervisor index (0..3) and teacher index (0..9) of child `j` of family `f`. */
export function assignmentFor(f: number, j: number): { supervisor: number; teacher: number } {
  const { kids, scenario } = FAMILY_PLAN[f];
  const s = f % 4;
  const alt = (f + 1) % 4;
  const alt2 = (f + 2) % 4;
  const t = f % 10;
  const differentTeacher = (t + j * 3) % 10;
  switch (scenario) {
    case 'single':
    case 'A':
      return { supervisor: s, teacher: t };
    case 'B':
      return { supervisor: s, teacher: differentTeacher };
    case 'C':
      return { supervisor: j % 2 === 0 ? s : alt, teacher: t };
    case 'D':
      return { supervisor: [s, alt, alt2][j % (kids >= 4 ? 3 : 2)], teacher: differentTeacher };
  }
}

export interface SeedOptions {
  organizationId: string;
  /** Account subjects are `<key>@<emailDomain>`. */
  emailDomain: string;
  /** Plaintext, >= 12 chars; hashed per account, never stored or printed. */
  password: string;
  /** Tests pass a precomputed hash so 50+ Argon2 runs do not dominate the suite. */
  passwordHash?: string;
  /** Activate backup B for primary 3 (Mona) for 7 days, so QA sees one live backup. */
  activateOneBackup?: boolean;
  /** Seed sample messages (welcome, parent question, reply). Default true. */
  messages?: boolean;
}

export interface SeedPerson {
  id: string;
  subject: string;
  name: string;
}

export interface SeedManifest {
  organizationId: string;
  superAdmin: SeedPerson & { created: boolean };
  operationsManager: SeedPerson;
  salesManager: SeedPerson;
  teachersManager: SeedPerson;
  supervisors: SeedPerson[];
  backups: Array<SeedPerson & { covers: string[] }>;
  teacherSupervisors: SeedPerson[];
  teachers: SeedPerson[];
  departments: { operations: string; teachers: string; sales: string };
  backupLinks: Array<{ id: string; primaryId: string; backupId: string; active: boolean }>;
  families: Array<{
    id: string;
    displayName: string;
    scenario: FamilyScenario;
    parent: SeedPerson;
    children: Array<{ id: string; name: string; supervisorId: string; teacherId: string }>;
    groups: Array<{ conversationId: string; supervisorId: string; learnerIds: string[]; teacherIds: string[] }>;
    directs: Array<{ conversationId: string; supervisorId: string }>;
  }>;
  teacherDirects: Array<{ conversationId: string; teacherId: string; supervisorId: string }>;
}

export class SeedRefusal extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'SeedRefusal';
  }
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '');

export async function seedOrgChat(prisma: PrismaClient, opts: SeedOptions): Promise<SeedManifest> {
  if (opts.password.length < MIN_PASSWORD_LENGTH) {
    throw new SeedRefusal('PASSWORD', `the QA password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(opts.emailDomain)) {
    throw new SeedRefusal('USAGE', 'emailDomain must be a plain domain name');
  }
  const org = opts.organizationId;
  const orgRow = await prisma.organization.findUnique({ where: { id: org } });
  if (!orgRow) throw new SeedRefusal('ORGANIZATION', 'the target organization does not exist');
  if (await prisma.department.findFirst({ where: { organizationId: org } })) {
    throw new SeedRefusal('ALREADY_SEEDED', 'this organization already has departments; refusing to seed twice');
  }

  const db = prisma as unknown as PrismaService;
  const coverage = new SqlCoverageService(db);
  const authz = new AuthorizationService(coverage, new SqlStaffScope(db));
  const identity = new PrismaIdentityService(db);
  const audit = new PrismaAuditService();
  const outbox = new OutboxService();
  const conversations = new ConversationService(
    db, authz, outbox, identity, coverage, audit, new PrismaRelationshipService(db),
  );
  const orgStructure = new OrgStructureService(db, authz, conversations, audit);
  // The seed sends text only. Object storage (and its signing secret) is not
  // needed, and any attempt to use it is a bug in the seed, so it refuses.
  const noStorage = new Proxy({} as ObjectStorage, {
    get: (_t, prop) => () => {
      throw new SeedRefusal('STORAGE', `the QA seed does not use object storage (${String(prop)})`);
    },
  });
  const attachments = new AttachmentService(db, authz, conversations, noStorage);
  const messages = new MessageService(
    db, authz, conversations, outbox, new AppConfigService(db), attachments, audit, identity,
  );

  const hash = async () => opts.passwordHash ?? (await hashPassword(opts.password));
  const subjectFor = (key: string) => `${key}@${opts.emailDomain}`;

  const account = async (key: string, kind: 'staff' | 'family' | 'teacher') => {
    const subject = subjectFor(key);
    const passwordHash = await hash();
    const created = await prisma.account.create({
      data: { organizationId: org, subject, kind, status: 'active', isActive: true },
    });
    await prisma.accountCredential.create({ data: { accountId: created.id, passwordHash } });
    return { accountId: created.id, subject };
  };

  const staffMember = async (key: string, name: string, role: string): Promise<SeedPerson> => {
    const { accountId, subject } = await account(key, 'staff');
    const s = await prisma.staff.create({ data: { organizationId: org, name, role, isActive: true, accountId } });
    return { id: s.id, subject, name };
  };

  // --- the super admin. It is never created here: the bootstrap procedure is
  // the one owner of that grant (cli/super-admin-bootstrap.ts), and the CLI
  // runs it first when the organization has none.
  const existingSuper = await prisma.staff.findFirst({
    where: { organizationId: org, role: 'super_admin', isActive: true, leftAt: null },
    include: { account: true },
  });
  if (!existingSuper) {
    throw new SeedRefusal('NO_SUPER_ADMIN', 'the organization has no super admin; run the bootstrap first');
  }
  const superAdmin: SeedManifest['superAdmin'] = {
    id: existingSuper.id,
    subject: existingSuper.account?.subject ?? '',
    name: existingSuper.name,
    created: false,
  };

  // --- staff
  const opsManager = await staffMember(SEED_STAFF.operationsManager.key, SEED_STAFF.operationsManager.name, 'manager');
  const salesManager = await staffMember(SEED_STAFF.salesManager.key, SEED_STAFF.salesManager.name, 'manager');
  const teachersManager = await staffMember(SEED_STAFF.teachersManager.key, SEED_STAFF.teachersManager.name, 'manager');
  const supervisors: SeedPerson[] = [];
  for (const s of SEED_STAFF.supervisors) supervisors.push(await staffMember(s.key, s.name, s.role));
  const backups: SeedManifest['backups'] = [];
  for (const b of SEED_STAFF.backups) {
    backups.push({ ...(await staffMember(b.key, b.name, b.role)), covers: b.covers.map((i) => supervisors[i].id) });
  }
  const teacherSupervisors: SeedPerson[] = [];
  for (const s of SEED_STAFF.teacherSupervisors) teacherSupervisors.push(await staffMember(s.key, s.name, s.role));

  // Reporting lines (profiles/teams); never an authorization input.
  const lines: Array<[string, string]> = [
    [opsManager.id, superAdmin.id],
    [salesManager.id, superAdmin.id],
    [teachersManager.id, superAdmin.id],
    ...supervisors.map((s) => [s.id, opsManager.id] as [string, string]),
    ...backups.map((b) => [b.id, opsManager.id] as [string, string]),
    ...teacherSupervisors.map((s) => [s.id, teachersManager.id] as [string, string]),
  ];
  for (const [staffId, managerId] of lines) {
    await prisma.staffReportingLine.create({ data: { staffId, managerId, organizationId: org, assignedBy: superAdmin.id } });
  }

  // --- departments, as the super admin
  const why = 'PD-8 QA seed';
  const ops = await orgStructure.upsertDepartment(superAdmin.id, { kind: 'operations', displayName: 'Operations', managerId: opsManager.id, reason: why });
  const teachersDept = await orgStructure.upsertDepartment(superAdmin.id, { kind: 'teachers', displayName: 'Teachers', managerId: teachersManager.id, reason: why });
  const sales = await orgStructure.upsertDepartment(superAdmin.id, { kind: 'sales', displayName: 'Sales', managerId: salesManager.id, reason: why });
  for (const s of supervisors) {
    await orgStructure.setDepartmentMember(superAdmin.id, ops.id, { staffId: s.id, position: 'supervisor', reason: why });
  }
  for (const b of backups) {
    await orgStructure.setDepartmentMember(superAdmin.id, ops.id, { staffId: b.id, position: 'backup_supervisor', reason: why });
  }
  for (const s of teacherSupervisors) {
    await orgStructure.setDepartmentMember(superAdmin.id, teachersDept.id, { staffId: s.id, position: 'supervisor', reason: why });
  }

  // --- backup links, as the Operations Manager: dormant, one optionally activated
  const backupLinks: SeedManifest['backupLinks'] = [];
  for (const b of backups) {
    for (const primaryId of b.covers) {
      const link = await orgStructure.createBackup(opsManager.id, { primaryId, backupId: b.id, reason: why });
      backupLinks.push({ id: link.id, primaryId, backupId: b.id, active: false });
    }
  }
  if (opts.activateOneBackup !== false) {
    const link = backupLinks.find((l) => l.primaryId === supervisors[2].id && l.backupId === backups[1].id)!;
    await orgStructure.activateBackup(opsManager.id, link.id, {
      until: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      reason: 'QA: one live backup arrangement',
    });
    link.active = true;
  }

  // --- teachers
  const teachers: SeedPerson[] = [];
  for (const name of SEED_TEACHERS) {
    const key = `teacher.${slug(name)}`;
    const { accountId, subject } = await account(key, 'teacher');
    const t = await prisma.teacher.create({ data: { organizationId: org, name, isActive: true, accountId } });
    teachers.push({ id: t.id, subject, name });
  }

  // --- families, children, supervision, groups, 1:1s
  const families: SeedManifest['families'] = [];
  let childCursor = 0;
  for (let f = 0; f < FAMILY_PLAN.length; f++) {
    const { kids, scenario } = FAMILY_PLAN[f];
    const surname = SURNAMES[f];
    const assignments = Array.from({ length: kids }, (_, j) => assignmentFor(f, j));
    const familyId = randomUUID();
    await prisma.family.create({
      data: {
        id: familyId,
        organizationId: org,
        displayName: `${surname} family`,
        // BR-4's legacy owner column is NOT NULL; since PD-8 it grants no scope.
        ownerId: supervisors[assignments[0].supervisor].id,
        language: 'ar',
      },
    });
    const parentName = `${PARENT_FIRST[f]} ${surname}`;
    const { accountId, subject } = await account(`parent.${slug(surname)}`, 'family');
    const contact = await prisma.contact.create({
      data: {
        organizationId: org,
        familyId,
        name: parentName,
        relationship: 'parent',
        rolePreset: 'primary_guardian',
        canMessage: true,
        canViewProgress: true,
        canManageSchedule: true,
        canManageBilling: true,
        canManageContacts: true,
        canCancel: true,
        accountId,
        isActive: true,
      },
    });
    await prisma.family.update({ where: { id: familyId }, data: { primaryContactId: contact.id } });

    const children: SeedManifest['families'][number]['children'] = [];
    for (let j = 0; j < kids; j++) {
      const { supervisor, teacher } = assignments[j];
      const learnerId = randomUUID();
      const name = `${CHILD_FIRST[childCursor++ % CHILD_FIRST.length]} ${surname}`;
      // learner.teacher_id is the academy's fact (Core-owned, trigger-guarded):
      // written by the QA stand-in for assignment ingestion.
      await insertLearnerWithTeacherForQa(prisma, {
        learnerId,
        organizationId: org,
        familyId,
        name,
        teacherId: teachers[teacher].id,
      });
      // ...and the supervisor is Chat's fact, assigned by the Operations Manager.
      await orgStructure.assignSupervisor(opsManager.id, learnerId, {
        supervisorId: supervisors[supervisor].id,
        reason: 'initial assignment (QA seed)',
      });
      children.push({ id: learnerId, name, supervisorId: supervisors[supervisor].id, teacherId: teachers[teacher].id });
    }

    // One family group per supervisor, created BY that supervisor, about their
    // own children only, with the parent and those children's teachers.
    const groups: SeedManifest['families'][number]['groups'] = [];
    const directs: SeedManifest['families'][number]['directs'] = [];
    for (const supervisorId of [...new Set(children.map((c) => c.supervisorId))]) {
      const mine = children.filter((c) => c.supervisorId === supervisorId);
      const teacherIds = [...new Set(mine.map((c) => c.teacherId))];
      const conv = await conversations.createFamilyGroup(supervisorId, {
        learnerIds: mine.map((c) => c.id),
        contactIds: [contact.id],
        teacherIds,
      });
      groups.push({ conversationId: conv.id, supervisorId, learnerIds: mine.map((c) => c.id), teacherIds });
      const direct = await conversations.getOrCreateDirect(contact.id, supervisorId);
      directs.push({ conversationId: direct.id, supervisorId });
      if (opts.messages !== false) {
        await messages.send({
          conversationId: conv.id,
          senderId: supervisorId,
          body: `Welcome to ${mine.map((c) => c.name.split(' ')[0]).join(' & ')}'s group. I am their supervisor.`,
          clientMessageId: `seed-welcome-${conv.id}`,
        });
        await messages.send({
          conversationId: direct.id,
          senderId: contact.id,
          body: 'Hello, could you share this week\'s class schedule?',
          clientMessageId: `seed-q-${direct.id}`,
        });
        await messages.send({
          conversationId: direct.id,
          senderId: supervisorId,
          body: 'Of course -- I will send it shortly.',
          clientMessageId: `seed-a-${direct.id}`,
        });
      }
    }
    families.push({
      id: familyId,
      displayName: `${surname} family`,
      scenario,
      parent: { id: contact.id, subject, name: parentName },
      children,
      groups,
      directs,
    });
  }

  // --- teachers <-> their Teachers-department supervisor (teachers 0-4 Ola, 5-9 Heba)
  const teacherDirects: SeedManifest['teacherDirects'] = [];
  for (let i = 0; i < teachers.length; i++) {
    const supervisorId = teacherSupervisors[i < 5 ? 0 : 1].id;
    const conv = await conversations.getOrCreateDirect(teachers[i].id, supervisorId);
    teacherDirects.push({ conversationId: conv.id, teacherId: teachers[i].id, supervisorId });
    if (opts.messages !== false) {
      await messages.send({
        conversationId: conv.id,
        senderId: teachers[i].id,
        body: 'My availability for next week is updated.',
        clientMessageId: `seed-t-${conv.id}`,
      });
    }
  }

  return {
    organizationId: org,
    superAdmin,
    operationsManager: opsManager,
    salesManager,
    teachersManager,
    supervisors,
    backups,
    teacherSupervisors,
    teachers,
    departments: { operations: ops.id, teachers: teachersDept.id, sales: sales.id },
    backupLinks,
    families,
    teacherDirects,
  };
}
