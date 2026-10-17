/**
 * PD-8 -- organization structure and strict conversation visibility, end to end.
 *
 * The whole synthetic organization (src/cli/org-chat-seed.ts: super admin,
 * three department managers, four primary + two backup Operations supervisors,
 * two Teachers-department supervisors, 10 teachers, 30 parents with 1-4
 * children covering every assignment shape) is seeded into a FRESH tenant
 * through the product's own services, then:
 *
 *   1. the seeded relationships are checked against the database itself;
 *   2. EVERY actor is checked against EVERY conversation -- the list and the
 *      per-conversation read -- against an oracle computed independently from
 *      the seed plan, not from the code under test;
 *   3. negative security probes over the real HTTP routes, the realtime
 *      gateway and the attachment path: an unauthorized supervisor, teacher or
 *      parent retrieves nothing by manipulating ids, and a foreign or unknown
 *      id is answered identically;
 *   4. backup activation / deactivation / expiry, reassignment and group
 *      creation, over the real HTTP routes, including who may NOT do them;
 *   5. the database enforces the same scope for a request role (chat_app).
 *
 * Synthetic people only (G-20).
 */
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import type Redis from 'ioredis';
import { PlatformModule } from '@platform/platform.module';
import { AuthModule } from '@platform/auth/auth.module';
import { AuthService } from '@platform/auth/auth.service';
import { hashPassword } from '@platform/auth/password';
import { CommErrorCode } from '@platform/errors';
import { CommunicationModule } from '@communication/communication.module';
import { CommErrorFilter } from '@communication/api/http-exception.filter';
import { RealtimeGateway } from '@communication/realtime/realtime.gateway';
import { REDIS_CLIENT } from '@communication/realtime/redis.provider';
import { buildObjectKey, conversationPrefix } from '@communication/attachments/object-key';
import { applyInfrastructure } from '../../src/infra/http/bootstrap';
import { OrgStructureModule } from '../../src/org/org-structure.module';
import { FAMILY_PLAN, seedOrgChat, type SeedManifest } from '../../src/cli/org-chat-seed';
import { buildGraph, seed as seedDefaultOrg, truncate } from './harness';

process.env.JWT_ACCESS_SECRET ??= 'integration-access-secret-32-chars-min!';
process.env.JWT_REFRESH_SECRET ??= 'integration-refresh-secret-32-chars-min!';
process.env.STORAGE_SIGNING_SECRET ??= 'integration-storage-secret-32-chars-ok!';

jest.setTimeout(300_000);

const PASSWORD = 'pd8-scope-spec-password-1';
const DOMAIN = 'pd8scope.qa.jawwid.test';

const g = buildGraph();
let m: SeedManifest;
let orgId: string;
let foreignConversationId: string;
let app: INestApplication;
let base: string;

// ---------------------------------------------------------------------------
// The oracle: who SHOULD see what, from the seed plan alone.
// ---------------------------------------------------------------------------

type Conv = { id: string; kind: 'group' | 'direct' | 'teacher-direct'; supervisorId: string; familyId?: string };

const allConversations = (): Conv[] => [
  ...m.families.flatMap((f) => f.groups.map((gr) => ({ id: gr.conversationId, kind: 'group' as const, supervisorId: gr.supervisorId, familyId: f.id }))),
  ...m.families.flatMap((f) => f.directs.map((d) => ({ id: d.conversationId, kind: 'direct' as const, supervisorId: d.supervisorId, familyId: f.id }))),
  ...m.teacherDirects.map((d) => ({ id: d.conversationId, kind: 'teacher-direct' as const, supervisorId: d.supervisorId })),
];

/** Activeness is read back from the rows each lifecycle test leaves behind. */
let activeBackups: Array<{ primaryId: string; backupId: string }> = [];

function expectedForStaff(staffId: string): Set<string> {
  if (staffId === m.superAdmin.id) return new Set(allConversations().map((c) => c.id));
  const principals = new Set<string>([staffId]);
  for (const l of activeBackups) if (l.backupId === staffId) principals.add(l.primaryId);
  if (staffId === m.operationsManager.id) [...m.supervisors, ...m.backups].forEach((p) => principals.add(p.id));
  if (staffId === m.teachersManager.id) m.teacherSupervisors.forEach((p) => principals.add(p.id));
  return new Set(allConversations().filter((c) => principals.has(c.supervisorId)).map((c) => c.id));
}

function expectedForTeacher(teacherId: string): Set<string> {
  return new Set([
    ...m.families.flatMap((f) => f.groups.filter((gr) => gr.teacherIds.includes(teacherId)).map((gr) => gr.conversationId)),
    ...m.teacherDirects.filter((d) => d.teacherId === teacherId).map((d) => d.conversationId),
  ]);
}

function expectedForParent(parentId: string): Set<string> {
  const f = m.families.find((x) => x.parent.id === parentId)!;
  return new Set([...f.groups.map((gr) => gr.conversationId), ...f.directs.map((d) => d.conversationId)]);
}

const allStaff = () => [
  m.superAdmin,
  m.operationsManager,
  m.salesManager,
  m.teachersManager,
  ...m.supervisors,
  ...m.backups,
  ...m.teacherSupervisors,
];

const listed = async (actorId: string) => new Set((await g.conversations.listForActor(actorId)).map((c) => c.id));

const [NOURA, SALMA, MONA, REEM] = [0, 1, 2, 3];
const sup = (i: number) => m.supervisors[i];

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

/**
 * Real tokens for real accounts, minted by the app's own AuthService (the same
 * credential check, session and JWT the login route issues). Not through
 * POST /auth/login: that route's per-source throttle is shared by every suite
 * on 127.0.0.1, and ~20 logins here would exhaust it for the suites that run
 * after this one (CI saw 429s). Every probe below still goes over real HTTP
 * with the Bearer token.
 */
const tokens = new Map<string, string>();
async function tokenFor(subject: string): Promise<string> {
  if (!tokens.has(subject)) {
    const { accessToken } = await app.get(AuthService).login(subject, PASSWORD);
    expect(accessToken.split('.')).toHaveLength(3);
    tokens.set(subject, accessToken);
  }
  return tokens.get(subject)!;
}

async function http(subject: string, method: string, path: string, body?: unknown) {
  const r = await fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${await tokenFor(subject)}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await r.json().catch(() => ({}))) as { error?: { code?: string } } & Record<string, unknown>;
  return { status: r.status, code: json.error?.code, json };
}

/** A socket that records what the gateway does to it. */
class FakeSocket {
  readonly id = `sock-${randomUUID()}`;
  readonly rooms: string[] = [];
  disconnected = false;
  actor?: unknown;
  accountId?: string;
  sessionId?: string;
  constructor(readonly handshake: { auth?: Record<string, unknown>; headers?: Record<string, unknown> }) {
    this.handshake.headers ??= {};
  }
  async join(name: string): Promise<void> {
    if (!this.rooms.includes(name)) this.rooms.push(name);
  }
  async leave(name: string): Promise<void> {
    const i = this.rooms.indexOf(name);
    if (i >= 0) this.rooms.splice(i, 1);
  }
  emit(): boolean {
    return true;
  }
  disconnect(): void {
    this.disconnected = true;
  }
}

// ---------------------------------------------------------------------------

beforeAll(async () => {
  await g.prisma.$connect();
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd8-%'`);

  // Another tenant's conversation, for the "foreign id reads as unknown" probes.
  const other = await seedDefaultOrg(g.prisma);
  foreignConversationId = (await g.conversations.ensureStudentGroup(other.learnerId, other.ownerId)).id;

  orgId = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.organization (id, slug, display_name) values ('${orgId}'::uuid, 'pd8-${orgId.slice(0, 8)}', 'PD-8 QA academy')`,
  );
  // The tenant's super admin, through the same gate the bootstrap opens.
  await g.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`);
    const account = await tx.account.create({
      data: { organizationId: orgId, subject: `owner@${DOMAIN}`, kind: 'staff', status: 'active', isActive: true },
    });
    await tx.accountCredential.create({ data: { accountId: account.id, passwordHash: await hashPassword(PASSWORD) } });
    await tx.staff.create({
      data: { organizationId: orgId, name: 'QA Organization Owner', role: 'super_admin', isActive: true, accountId: account.id },
    });
  });
  m = await seedOrgChat(g.prisma, {
    organizationId: orgId,
    emailDomain: DOMAIN,
    password: PASSWORD,
    passwordHash: await hashPassword(PASSWORD),
  });
  activeBackups = m.backupLinks.filter((l) => l.active).map((l) => ({ primaryId: l.primaryId, backupId: l.backupId }));

  const moduleRef = await Test.createTestingModule({
    imports: [PlatformModule, AuthModule, CommunicationModule, OrgStructureModule],
  }).compile();
  app = moduleRef.createNestApplication({ logger: false, rawBody: true });
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/live', 'health/ready'] });
  app.useGlobalFilters(new CommErrorFilter());
  applyInfrastructure(app);
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}/api/v1`;
});

afterAll(async () => {
  const presence = app?.get<Redis>(REDIS_CLIENT);
  await app?.close();
  for (let i = 0; i < 40 && presence && presence.status !== 'end'; i++) await new Promise((r) => setTimeout(r, 50));
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd8-%'`);
  await g.prisma.$disconnect();
});

// ===========================================================================
describe('1. the seeded organization is the one the product owner described', () => {
  it('3 departments, each with its manager; 4 primary + 2 backup Operations supervisors; 2 Teachers supervisors; Sales has no team', async () => {
    const depts = await g.prisma.department.findMany({ where: { organizationId: orgId }, include: { members: true } });
    const byKind = new Map(depts.map((d) => [d.kind, d]));
    expect([...byKind.keys()].sort()).toEqual(['operations', 'sales', 'teachers']);
    expect(byKind.get('operations')!.managerId).toBe(m.operationsManager.id);
    expect(byKind.get('teachers')!.managerId).toBe(m.teachersManager.id);
    expect(byKind.get('sales')!.managerId).toBe(m.salesManager.id);
    const ops = byKind.get('operations')!.members;
    expect(ops.filter((x) => x.position === 'supervisor').map((x) => x.staffId).sort()).toEqual(m.supervisors.map((x) => x.id).sort());
    expect(ops.filter((x) => x.position === 'backup_supervisor').map((x) => x.staffId).sort()).toEqual(m.backups.map((x) => x.id).sort());
    expect(byKind.get('teachers')!.members.map((x) => x.staffId).sort()).toEqual(m.teacherSupervisors.map((x) => x.id).sort());
    expect(byKind.get('sales')!.members).toEqual([]);
    const supers = await g.prisma.staff.count({ where: { organizationId: orgId, role: 'super_admin' } });
    expect(supers).toBe(1);
  });

  it('backup A covers primaries 1 and 2, backup B covers 3 and 4; links are configurable rows, exactly one active', async () => {
    const links = await g.prisma.supervisorBackup.findMany({ where: { organizationId: orgId, endedAt: null } });
    const pairs = links.map((l) => `${l.backupId}>${l.primaryId}`).sort();
    expect(pairs).toEqual(
      [
        `${m.backups[0].id}>${sup(NOURA).id}`,
        `${m.backups[0].id}>${sup(SALMA).id}`,
        `${m.backups[1].id}>${sup(MONA).id}`,
        `${m.backups[1].id}>${sup(REEM).id}`,
      ].sort(),
    );
    expect(links.filter((l) => l.activatedAt && !l.deactivatedAt).map((l) => `${l.backupId}>${l.primaryId}`)).toEqual([
      `${m.backups[1].id}>${sup(MONA).id}`,
    ]);
  });

  it('10 teachers and 30 parents, each with a login; families of 1, 2, 3 and 4 children; 68 children', async () => {
    expect(await g.prisma.teacher.count({ where: { organizationId: orgId, accountId: { not: null } } })).toBe(10);
    const contacts = await g.prisma.contact.findMany({ where: { organizationId: orgId } });
    expect(contacts).toHaveLength(30);
    expect(contacts.every((c) => c.accountId && c.canMessage && c.isActive)).toBe(true);
    const sizes = (await g.prisma.learner.groupBy({ by: ['familyId'], where: { organizationId: orgId }, _count: { _all: true } })).map(
      (r) => r._count._all,
    );
    expect(new Set(sizes)).toEqual(new Set([1, 2, 3, 4]));
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(68);
    const names = new Set([...allStaff(), ...m.teachers, ...m.families.map((f) => f.parent)].map((p) => p.name));
    expect(names.size).toBe(allStaff().length + m.teachers.length + m.families.length);
  });

  it('every real-world shape occurs, classified from the DATABASE rows, and matches the plan', async () => {
    const rows = await g.prisma.$queryRawUnsafe<Array<{ family_id: string; kids: number; sups: number; teachers: number }>>(
      `select l.family_id::text, count(*)::int as kids, count(distinct ls.supervisor_id)::int as sups,
              count(distinct l.teacher_id)::int as teachers
         from chat.learner l join chat.learner_supervision ls on ls.learner_id = l.id
        where l.organization_id = $1::uuid group by l.family_id`,
      orgId,
    );
    const shape = (r: { kids: number; sups: number; teachers: number }) =>
      r.kids === 1 ? 'single' : r.sups === 1 ? (r.teachers === 1 ? 'A' : 'B') : r.teachers === 1 ? 'C' : 'D';
    const byFamily = new Map(rows.map((r) => [r.family_id, shape(r)]));
    for (const f of m.families) expect({ family: f.displayName, shape: byFamily.get(f.id) }).toEqual({ family: f.displayName, shape: f.scenario });
    const counts = m.families.reduce<Record<string, number>>((acc, f) => ({ ...acc, [f.scenario]: (acc[f.scenario] ?? 0) + 1 }), {});
    for (const shapeKey of ['A', 'B', 'C', 'D']) expect(counts[shapeKey]).toBeGreaterThanOrEqual(3);
    expect(FAMILY_PLAN).toHaveLength(30);
  });

  it('every family group is about ONE family and ONE supervisor, seats exactly that supervisor, and only that family\'s parent and its children\'s teachers', async () => {
    const groups = await g.prisma.conversation.findMany({ where: { organizationId: orgId, type: 'family_group' } });
    expect(groups.length).toBe(m.families.reduce((n, f) => n + f.groups.length, 0));
    for (const conv of groups) {
      const anchors = await g.prisma.$queryRawUnsafe<Array<{ family_id: string; supervisor_id: string; teacher_id: string }>>(
        `select l.family_id::text, ls.supervisor_id::text, l.teacher_id::text
           from chat.conversation_learner cl join chat.learner l on l.id = cl.learner_id
           join chat.learner_supervision ls on ls.learner_id = l.id where cl.conversation_id = $1::uuid`,
        conv.id,
      );
      expect(new Set(anchors.map((a) => a.family_id))).toEqual(new Set([conv.familyId]));
      const supervisors = new Set(anchors.map((a) => a.supervisor_id));
      expect(supervisors.size).toBe(1);
      const members = await g.prisma.conversationMember.findMany({ where: { conversationId: conv.id, leftAt: null } });
      expect(members.filter((x) => x.actorKind === 'staff').map((x) => x.actorId)).toEqual([...supervisors]);
      const parents = members.filter((x) => x.actorKind === 'contact').map((x) => x.actorId);
      const familyContacts = (await g.prisma.contact.findMany({ where: { familyId: conv.familyId! } })).map((c) => c.id);
      expect(parents.every((p) => familyContacts.includes(p))).toBe(true);
      expect(new Set(members.filter((x) => x.actorKind === 'teacher').map((x) => x.actorId))).toEqual(
        new Set(anchors.map((a) => a.teacher_id)),
      );
    }
  });

  it('every child is in exactly one family group -- the one of its own supervisor', async () => {
    for (const f of m.families) {
      for (const child of f.children) {
        const groups = f.groups.filter((gr) => gr.learnerIds.includes(child.id));
        expect(groups).toHaveLength(1);
        expect(groups[0].supervisorId).toBe(child.supervisorId);
      }
    }
  });
});

// ===========================================================================
describe('2. visibility -- every actor against every conversation', () => {
  it('each staff member LISTS exactly what the oracle says, nothing more, nothing less', async () => {
    for (const p of allStaff()) {
      expect({ who: p.name, ids: [...(await listed(p.id))].sort() }).toEqual({ who: p.name, ids: [...expectedForStaff(p.id)].sort() });
    }
  });

  it('each staff member may READ exactly those conversations, checked one by one against every conversation', async () => {
    const convs = await g.prisma.conversation.findMany({ where: { organizationId: orgId } });
    for (const p of allStaff()) {
      const actor = await g.conversations.requireActor(p.id);
      const expected = expectedForStaff(p.id);
      for (const conv of convs) {
        const membership = await g.conversations.membershipOf(conv.id, p.id);
        const allowed = (await g.conversations.canReadResolved(actor, conv, membership)).allowed;
        expect({ who: p.name, conv: conv.id, allowed }).toEqual({ who: p.name, conv: conv.id, allowed: expected.has(conv.id) });
      }
    }
  });

  it('each teacher and each parent lists exactly their own conversations', async () => {
    for (const t of m.teachers) expect([...(await listed(t.id))].sort()).toEqual([...expectedForTeacher(t.id)].sort());
    for (const f of m.families) expect([...(await listed(f.parent.id))].sort()).toEqual([...expectedForParent(f.parent.id)].sort());
  });

  it('a supervisor never sees another supervisor\'s conversations -- not even for a family they share', async () => {
    const shared = m.families.find((f) => f.scenario === 'C' || f.scenario === 'D')!;
    const [a, b] = shared.groups;
    expect(a.supervisorId).not.toBe(b.supervisorId);
    const seenByA = await listed(a.supervisorId);
    expect(seenByA.has(a.conversationId)).toBe(true);
    expect(seenByA.has(b.conversationId)).toBe(false);
    const bDirect = shared.directs.find((d) => d.supervisorId === b.supervisorId)!;
    expect(seenByA.has(bDirect.conversationId)).toBe(false);
    // ...while the shared parent is in both of them.
    const parentSees = await listed(shared.parent.id);
    expect(parentSees.has(a.conversationId) && parentSees.has(b.conversationId)).toBe(true);
  });

  it('a teacher shared by two supervisors (scenario C) sits in both groups -- and in nobody else\'s', async () => {
    const c = m.families.find((f) => f.scenario === 'C')!;
    const teacherId = c.children[0].teacherId;
    expect(new Set(c.children.map((x) => x.teacherId))).toEqual(new Set([teacherId]));
    const seen = await listed(teacherId);
    for (const gr of c.groups) expect(seen.has(gr.conversationId)).toBe(true);
    for (const d of c.directs) expect(seen.has(d.conversationId)).toBe(false);
  });

  it('the dormant backup sees nothing; the active backup sees exactly the covered primary\'s, not the other primary\'s', async () => {
    expect((await listed(m.backups[0].id)).size).toBe(0);
    const dalia = await listed(m.backups[1].id);
    expect(dalia).toEqual(expectedForStaff(sup(MONA).id));
    for (const id of expectedForStaff(sup(REEM).id)) expect(dalia.has(id)).toBe(false);
  });

  it('managers read their own department only: Sales nothing, Teachers only teacher channels, Operations no teacher-supervisor channel', async () => {
    expect((await listed(m.salesManager.id)).size).toBe(0);
    expect(await listed(m.teachersManager.id)).toEqual(new Set(m.teacherDirects.map((d) => d.conversationId)));
    const ops = await listed(m.operationsManager.id);
    for (const d of m.teacherDirects) expect(ops.has(d.conversationId)).toBe(false);
  });

  it('the super admin sees every conversation of its organization and none of another', async () => {
    const seen = await listed(m.superAdmin.id);
    expect(seen).toEqual(new Set(allConversations().map((c) => c.id)));
    expect(seen.has(foreignConversationId)).toBe(false);
  });
});

// ===========================================================================
describe('3. negative security -- ids manipulated over the real routes', () => {
  const salmaGroup = () => m.families.flatMap((f) => f.groups).find((gr) => gr.supervisorId === sup(SALMA).id)!;
  const salmaDirect = () => m.families.flatMap((f) => f.directs).find((d) => d.supervisorId === sup(SALMA).id)!;

  it('another supervisor gets 403 on detail, messages, send, read-receipt, members, upload, call history and preferences', async () => {
    const noura = sup(NOURA).subject;
    for (const id of [salmaGroup().conversationId, salmaDirect().conversationId]) {
      const probes = [
        await http(noura, 'GET', `/conversations/${id}`),
        await http(noura, 'GET', `/conversations/${id}/messages`),
        await http(noura, 'POST', `/conversations/${id}/messages`, { type: 'text', body: 'probe', clientMessageId: randomUUID() }),
        await http(noura, 'POST', `/conversations/${id}/messages/read`, { upToSeq: '100' }),
        await http(noura, 'POST', `/conversations/${id}/members`, {
          action: 'add', reason: 'probe', actorId: sup(NOURA).id, actorKind: 'staff', memberRole: 'observer',
        }),
        await http(noura, 'POST', `/conversations/${id}/messages/attachments/authorize`, {
          kind: 'image', mimeType: 'image/jpeg', byteSize: 100, originalName: 'x.jpg',
        }),
        await http(noura, 'GET', `/calls/history/${id}`),
        await http(noura, 'POST', `/conversations/${id}/preferences`, { pinned: true }),
      ];
      for (const p of probes) expect([p.status, p.code]).toEqual([403, expect.stringMatching(/STAFF_OUT_OF_SCOPE|CANNOT_MANAGE_MEMBERSHIP/)]);
    }
    expect(await g.prisma.message.count({ where: { body: 'probe' } })).toBe(0);
  });

  it('nothing leaks into the list, the approval queue or the call history list', async () => {
    const noura = sup(NOURA).subject;
    const list = await http(noura, 'GET', '/conversations');
    const ids = (list.json.conversations as Array<{ id: string }>).map((c) => c.id);
    expect(ids).not.toContain(salmaGroup().conversationId);
    expect(new Set(ids)).toEqual(expectedForStaff(sup(NOURA).id));
    const pending = await http(noura, 'GET', '/approvals/pending');
    expect(pending.status).toBe(200);
    expect(JSON.stringify(pending.json)).not.toContain(salmaGroup().conversationId);
  });

  it("another organization's conversation is answered exactly like an id that does not exist", async () => {
    const noura = sup(NOURA).subject;
    for (const path of ['', '/messages']) {
      const foreign = await http(noura, 'GET', `/conversations/${foreignConversationId}${path}`);
      const unknown = await http(noura, 'GET', `/conversations/${randomUUID()}${path}`);
      expect([foreign.status, foreign.code]).toEqual([unknown.status, unknown.code]);
      expect(foreign.status).toBe(404);
    }
    // The super admin of THIS organization too: full access stops at the tenant.
    const owner = await http(m.superAdmin.subject, 'GET', `/conversations/${foreignConversationId}`);
    expect(owner.status).toBe(404);
  });

  it('a malformed id is refused, never handed to the database', async () => {
    const r = await http(sup(NOURA).subject, 'GET', `/conversations/not-a-uuid/messages`);
    expect([400, 404]).toContain(r.status);
  });

  it('a teacher and a parent outside a conversation are refused it, by id', async () => {
    const group = salmaGroup();
    const outsiderTeacher = m.teachers.find((t) => !expectedForTeacher(t.id).has(group.conversationId))!;
    const outsiderParent = m.families.find((f) => !f.groups.some((gr) => gr.conversationId === group.conversationId))!.parent;
    for (const subject of [outsiderTeacher.subject, outsiderParent.subject]) {
      const r = await http(subject, 'GET', `/conversations/${group.conversationId}/messages`);
      expect([r.status, r.code]).toEqual([403, CommErrorCode.NOT_CONVERSATION_MEMBER]);
    }
  });

  it('the realtime gateway refuses the subscription; no room is joined', async () => {
    const gateway = app.get(RealtimeGateway);
    const socket = new FakeSocket({ auth: { token: await tokenFor(sup(NOURA).subject) } });
    await gateway.handleConnection(socket as never);
    const ack = await gateway.subscribe(socket as never, { conversationId: salmaGroup().conversationId });
    expect(ack).toEqual({ ok: false, code: CommErrorCode.STAFF_OUT_OF_SCOPE });
    expect(socket.rooms.some((r) => r.includes(salmaGroup().conversationId))).toBe(false);
  });

  it('an attachment in another supervisor\'s conversation is refused, even with its id', async () => {
    const conversationId = salmaGroup().conversationId;
    const message = await g.prisma.message.findFirstOrThrow({ where: { conversationId, authorType: 'staff' } });
    const attachment = await g.prisma.messageAttachment.create({
      data: {
        messageId: message.id,
        kind: 'image',
        objectKey: buildObjectKey(conversationPrefix(conversationId)),
        mimeType: 'image/jpeg',
        byteSize: 1234,
      },
    });
    // The scope refusal itself (the media route answers it 403, as RT-037 pins).
    await expect(g.messages.authorizeAttachmentRead(attachment.id, sup(NOURA).id, 'o')).rejects.toMatchObject({
      code: CommErrorCode.STAFF_OUT_OF_SCOPE,
    });
    await expect(g.messages.authorizeAttachmentRead(attachment.id, sup(SALMA).id, 'o')).resolves.toBeDefined();
    // The scope refusal itself (the media route answers it 403, as RT-037 pins).
    await expect(g.messages.authorizeAttachmentRead(attachment.id, m.salesManager.id, 'o')).rejects.toMatchObject({
      code: CommErrorCode.STAFF_OUT_OF_SCOPE,
    });
  });

  it('participant information is not reachable either: the member list is part of the refused detail', async () => {
    const r = await http(sup(NOURA).subject, 'GET', `/conversations/${salmaDirect().conversationId}`);
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.json)).not.toMatch(/displayName|members/);
  });
});

// ===========================================================================
describe('4a. backup supervisors over HTTP: dormant until activated, and only by the right people', () => {
  const amiraLinkToNoura = () => m.backupLinks.find((l) => l.backupId === m.backups[0].id && l.primaryId === sup(NOURA).id)!;
  const nourasGroup = () => m.families.flatMap((f) => f.groups).find((gr) => gr.supervisorId === sup(NOURA).id)!.conversationId;

  it('nobody but the Operations Manager and the super admin may activate a backup', async () => {
    const link = amiraLinkToNoura().id;
    for (const who of [m.salesManager, m.teachersManager, sup(NOURA), m.backups[0], m.teacherSupervisors[0]]) {
      const r = await http(who.subject, 'POST', `/org/backups/${link}/activate`, { reason: 'probe' });
      expect({ who: who.name, status: r.status, code: r.code }).toEqual({ who: who.name, status: 403, code: CommErrorCode.ORG_STRUCTURE_DENIED });
    }
    expect((await g.prisma.supervisorBackup.findUniqueOrThrow({ where: { id: link } })).activatedAt).toBeNull();
    const parent = await http(m.families[0].parent.subject, 'POST', `/org/backups/${link}/activate`, { reason: 'probe' });
    expect(parent.status).toBe(403);
  });

  it('activated: the backup reads and replies (as coverage); deactivated: refused again at once', async () => {
    const amira = m.backups[0];
    const group = nourasGroup();
    expect((await http(amira.subject, 'GET', `/conversations/${group}/messages`)).status).toBe(403);

    const on = await http(m.operationsManager.subject, 'POST', `/org/backups/${amiraLinkToNoura().id}/activate`, {
      reason: 'Noura on leave',
      until: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect([on.status, on.json.status]).toEqual([201, 'active']);
    activeBackups.push({ primaryId: sup(NOURA).id, backupId: amira.id });
    expect(await listed(amira.id)).toEqual(expectedForStaff(amira.id));
    expect((await http(amira.subject, 'GET', `/conversations/${group}/messages`)).status).toBe(200);
    const sent = await http(amira.subject, 'POST', `/conversations/${group}/messages`, {
      type: 'text', body: 'covering for Noura today', clientMessageId: randomUUID(),
    });
    expect(sent.status).toBe(201);
    expect((await g.prisma.message.findFirstOrThrow({ where: { body: 'covering for Noura today' } })).onBehalfMode).toBe('coverage');
    // ...still not Salma's, whom Amira also backs up but is not covering.
    for (const id of expectedForStaff(sup(SALMA).id)) expect((await listed(amira.id)).has(id)).toBe(false);

    const off = await http(m.operationsManager.subject, 'POST', `/org/backups/${amiraLinkToNoura().id}/deactivate`, { reason: 'Noura back' });
    expect([off.status, off.json.status]).toEqual([201, 'deactivated']);
    activeBackups = activeBackups.filter((l) => l.backupId !== amira.id);
    expect((await http(amira.subject, 'GET', `/conversations/${group}/messages`)).status).toBe(403);
    expect((await listed(amira.id)).size).toBe(0);
  });

  it('an expired activation grants nothing, without anyone deactivating it', async () => {
    const link = amiraLinkToNoura().id;
    await http(m.operationsManager.subject, 'POST', `/org/backups/${link}/activate`, { reason: 'short cover' });
    expect((await listed(m.backups[0].id)).has(nourasGroup())).toBe(true);
    await g.prisma.supervisorBackup.update({ where: { id: link }, data: { activatedAt: new Date(Date.now() - 2000), activeUntil: new Date(Date.now() - 1000) } });
    expect((await listed(m.backups[0].id)).size).toBe(0);
    expect((await http(m.operationsManager.subject, 'GET', '/org/structure')).json.departments).toBeDefined();
  });

  it('a backup link can be reconfigured: ended links stay as history, and a backup outside the department is refused', async () => {
    const created = await http(m.operationsManager.subject, 'POST', '/org/backups', {
      primaryId: sup(NOURA).id, backupId: m.teacherSupervisors[0].id, reason: 'wrong department',
    });
    expect([created.status, created.code]).toEqual([409, CommErrorCode.ORG_STRUCTURE_INVALID]);
    const ended = await http(m.operationsManager.subject, 'POST', `/org/backups/${amiraLinkToNoura().id}/end`, { reason: 'reorganised' });
    expect([ended.status, ended.json.status]).toEqual([201, 'ended']);
    const again = await http(m.operationsManager.subject, 'POST', `/org/backups/${amiraLinkToNoura().id}/activate`, { reason: 'x' });
    expect([again.status, again.code]).toEqual([409, CommErrorCode.ORG_STRUCTURE_INVALID]);
    const fresh = await http(m.operationsManager.subject, 'POST', '/org/backups', {
      primaryId: sup(NOURA).id, backupId: m.backups[1].id, reason: 'Dalia now covers Noura too',
    });
    expect([fresh.status, fresh.json.status]).toEqual([201, 'dormant']);
  });

  it('the structure view is the super admin\'s whole organization and a manager\'s own department only', async () => {
    const all = await http(m.superAdmin.subject, 'GET', '/org/structure');
    expect((all.json.departments as unknown[]).length).toBe(3);
    const ops = await http(m.operationsManager.subject, 'GET', '/org/structure');
    expect((ops.json.departments as Array<{ kind: string }>).map((d) => d.kind)).toEqual(['operations']);
    expect((await http(sup(NOURA).subject, 'GET', '/org/structure')).status).toBe(403);
    expect((await http(m.teachers[0].subject, 'GET', '/org/structure')).status).toBe(403);
  });
});

// ===========================================================================
describe('4b. reassignment over HTTP: access follows the child, at once', () => {
  it('nobody but the Operations Manager and the super admin may reassign a child', async () => {
    const child = m.families[0].children[0];
    for (const who of [m.salesManager, m.teachersManager, sup(NOURA), sup(SALMA), m.backups[1]]) {
      const r = await http(who.subject, 'POST', `/org/learners/${child.id}/supervisor`, { supervisorId: sup(REEM).id, reason: 'probe' });
      expect({ who: who.name, status: r.status }).toEqual({ who: who.name, status: 403 });
    }
    expect((await g.prisma.learnerSupervision.findUniqueOrThrow({ where: { learnerId: child.id } })).supervisorId).toBe(child.supervisorId);
  });

  it('a child cannot be given to someone who is not an Operations supervisor', async () => {
    const child = m.families[0].children[0];
    const byManager = await http(m.operationsManager.subject, 'POST', `/org/learners/${child.id}/supervisor`, {
      supervisorId: m.teacherSupervisors[0].id, reason: 'wrong department',
    });
    expect([byManager.status, byManager.code]).toEqual([403, CommErrorCode.ORG_STRUCTURE_DENIED]);
    const bySuper = await http(m.superAdmin.subject, 'POST', `/org/learners/${child.id}/supervisor`, {
      supervisorId: m.backups[0].id, reason: 'a backup is not a primary supervisor',
    });
    expect([bySuper.status, bySuper.code]).toEqual([409, CommErrorCode.ORG_STRUCTURE_INVALID]);
  });

  it('moving ONE child of a family group detaches it; moving the LAST child transfers the group; private 1:1s never transfer', async () => {
    const family = m.families.find((f) => f.scenario === 'A' && f.children.length >= 2)!;
    const from = family.children[0].supervisorId;
    const to = m.supervisors.find((x) => x.id !== from)!.id;
    const group = family.groups[0];
    const direct = family.directs[0];

    // One child moves: the group stays with `from` about the remaining children.
    const first = await http(m.operationsManager.subject, 'POST', `/org/learners/${family.children[0].id}/supervisor`, {
      supervisorId: to, reason: 'rebalancing',
    });
    expect(first.status).toBe(201);
    expect((await listed(from)).has(group.conversationId)).toBe(true);
    expect((await listed(to)).has(group.conversationId)).toBe(false);
    expect((await g.prisma.conversationLearner.findMany({ where: { conversationId: group.conversationId } })).map((r) => r.learnerId)).not.toContain(
      family.children[0].id,
    );
    // `to` now reaches the family through the child, and may open its own channel.
    const opened = await http(m.families.find((f) => f.id === family.id)!.parent.subject, 'POST', '/conversations/direct', { withActorId: to });
    expect(opened.status).toBe(201);

    // The remaining children move: the group follows them; `from` loses the family entirely.
    for (const child of family.children.slice(1)) {
      const r = await http(m.operationsManager.subject, 'POST', `/org/learners/${child.id}/supervisor`, { supervisorId: to, reason: 'rebalancing' });
      expect(r.status).toBe(201);
    }
    const fromSees = await listed(from);
    expect(fromSees.has(group.conversationId)).toBe(false);
    expect(fromSees.has(direct.conversationId)).toBe(false);
    const toSees = await listed(to);
    expect(toSees.has(group.conversationId)).toBe(true);
    // `from`'s private 1:1 with the parent did not transfer to `to`.
    expect(toSees.has(direct.conversationId)).toBe(false);
    const seated = await g.prisma.conversationMember.findMany({ where: { conversationId: group.conversationId, actorKind: 'staff', leftAt: null } });
    expect(seated.map((x) => x.actorId)).toEqual([to]);
    // The audit trail names who did it and why.
    const audit = await g.prisma.auditLog.findFirst({ where: { action: 'learner.supervisor_reassigned', entityId: family.children[0].id } });
    expect([audit?.actorId, audit?.reason]).toEqual([m.operationsManager.id, 'rebalancing']);
  });
});

// ===========================================================================
describe('4c. supervisor-created groups over HTTP: no incorrect association is possible', () => {
  const family = () => m.families.find((f) => f.scenario === 'B')!;

  it('a supervisor creates a group about their child with the parent and that child\'s teacher', async () => {
    const f = family();
    const child = f.children[0];
    const r = await http(m.supervisors.find((x) => x.id === child.supervisorId)!.subject, 'POST', '/conversations/family-group', {
      learnerIds: [child.id], contactIds: [f.parent.id], teacherIds: [child.teacherId], title: 'Homework follow-up',
    });
    expect(r.status).toBe(201);
    const members = await g.prisma.conversationMember.findMany({ where: { conversationId: r.json.id as string, leftAt: null } });
    expect(new Set(members.map((x) => x.actorId))).toEqual(new Set([child.supervisorId, f.parent.id, child.teacherId]));
  });

  it('refuses: another supervisor\'s child, two families, another family\'s parent, a teacher of none of the children', async () => {
    const f = family();
    const child = f.children[0];
    const supervisor = m.supervisors.find((x) => x.id === child.supervisorId)!;
    const stranger = m.supervisors.find((x) => x.id !== child.supervisorId)!;
    const otherFamily = m.families.find((x) => x.id !== f.id && x.children.some((c) => c.supervisorId === child.supervisorId))!;
    const otherChild = otherFamily.children.find((c) => c.supervisorId === child.supervisorId)!;
    const notTheirTeacher = m.teachers.find((t) => !f.children.some((c) => c.teacherId === t.id))!;
    const before = await g.prisma.conversation.count({ where: { organizationId: orgId } });

    const cases = [
      [stranger.subject, { learnerIds: [child.id] }, 403],
      [supervisor.subject, { learnerIds: [child.id, otherChild.id] }, 409],
      [supervisor.subject, { learnerIds: [child.id], contactIds: [otherFamily.parent.id] }, 403],
      [supervisor.subject, { learnerIds: [child.id], teacherIds: [notTheirTeacher.id] }, 403],
      [supervisor.subject, { learnerIds: [child.id], contactIds: [randomUUID()] }, 403],
      [f.parent.subject, { learnerIds: [child.id] }, 403],
      [child.teacherId ? m.teachers.find((t) => t.id === child.teacherId)!.subject : '', { learnerIds: [child.id] }, 403],
      [m.salesManager.subject, { learnerIds: [child.id] }, 403],
    ] as const;
    for (const [subject, body, status] of cases) {
      const r = await http(subject, 'POST', '/conversations/family-group', body);
      expect({ body, status: r.status }).toEqual({ body, status });
    }
    expect(await g.prisma.conversation.count({ where: { organizationId: orgId } })).toBe(before);
  });

  it('the database refuses an incorrect association even when the API is bypassed', async () => {
    const f = m.families.find((x) => x.groups.length > 0 && x.scenario === 'A')!;
    const group = f.groups[0];
    const otherFamily = m.families.find((x) => x.id !== f.id)!;
    const notTheirTeacher = m.teachers.find((t) => !group.teacherIds.includes(t.id))!;
    const attempts = [
      // another family's parent
      g.prisma.conversationMember.create({ data: { conversationId: group.conversationId, actorId: otherFamily.parent.id, actorKind: 'contact', memberRole: 'parent' } }),
      // a teacher of none of its children
      g.prisma.conversationMember.create({ data: { conversationId: group.conversationId, actorId: notTheirTeacher.id, actorKind: 'teacher', memberRole: 'teacher' } }),
      // another family's child
      g.prisma.conversationLearner.create({ data: { conversationId: group.conversationId, learnerId: otherFamily.children[0].id, organizationId: orgId } }),
    ];
    for (const attempt of attempts) await expect(attempt).rejects.toThrow(/family group|violat/i);
    // a child of ANOTHER supervisor in the same family: refused at commit (deferred coherence)
    const mixed = m.families.find((x) => x.scenario === 'C')!;
    const [a, b] = mixed.groups;
    const otherSupervisorsChild = b.learnerIds[0];
    await expect(
      g.prisma.conversationLearner.create({ data: { conversationId: a.conversationId, learnerId: otherSupervisorsChild, organizationId: orgId } }),
    ).rejects.toThrow(/exactly one supervisor/);
  });
});

// ===========================================================================
const appUrl = process.env.DATABASE_APP_URL;
(appUrl ? describe : describe.skip)('5. the database enforces the same scope for a request role (chat_app)', () => {
  let app2: PrismaClient;
  beforeAll(() => {
    app2 = new PrismaClient({ datasourceUrl: appUrl });
  });
  afterAll(async () => {
    await app2.$disconnect();
  });

  /** As the request role, bound to one staff login exactly as ActorScopedDatabase binds it. */
  const asStaff = <T>(subject: string, fn: (tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]) => Promise<T>) =>
    app2.$transaction(async (tx) => {
      await tx.$executeRaw`select set_config('chat.actor_subject', ${subject}, true),
                                  set_config('chat.actor_organization', ${orgId}, true)`;
      return fn(tx);
    });

  it('a supervisor reads only their own conversations\' messages from chat.message; another supervisor\'s read as empty', async () => {
    const mine = m.families.flatMap((f) => f.groups).find((gr) => gr.supervisorId === sup(REEM).id)!.conversationId;
    const theirs = m.families.flatMap((f) => f.groups).find((gr) => gr.supervisorId === sup(SALMA).id)!.conversationId;
    const counts = await asStaff(sup(REEM).subject, async (tx) => ({
      mine: (await tx.$queryRaw<Array<{ n: number }>>`select count(*)::int as n from chat.message where conversation_id = ${mine}::uuid`)[0].n,
      theirs: (await tx.$queryRaw<Array<{ n: number }>>`select count(*)::int as n from chat.message where conversation_id = ${theirs}::uuid`)[0].n,
      scope: (await tx.$queryRaw<Array<{ b: string | null }>>`select chat.current_staff_conversation_access(${theirs}::uuid) as b`)[0].b,
    }));
    expect(counts.mine).toBeGreaterThan(0);
    expect(counts.theirs).toBe(0);
    expect(counts.scope).toBeNull();
  });

  it('a request role cannot write into a conversation outside its scope', async () => {
    const theirs = m.families.flatMap((f) => f.groups).find((gr) => gr.supervisorId === sup(SALMA).id)!.conversationId;
    await expect(
      asStaff(sup(REEM).subject, (tx) =>
        tx.$executeRaw`insert into chat.message (organization_id, conversation_id, author_type, author_id, body, visibility, seq)
                       values (${orgId}::uuid, ${theirs}::uuid, 'staff', ${sup(REEM).id}::uuid, 'rls probe', 'customer', 99999)`,
      ),
    ).rejects.toThrow(/row-level security|permission denied|violates/i);
  });

  it('the conversation, membership, attachment and organization tables are not readable at all, and the scope function cannot be asked about someone else', async () => {
    for (const sql of [
      'select count(*) from chat.conversation',
      'select count(*) from chat.conversation_member',
      'select count(*) from chat.message_attachment',
      'select count(*) from chat.learner_supervision',
      'select count(*) from chat.supervisor_backup',
      `select chat.staff_conversation_access('${sup(SALMA).id}'::uuid, '${randomUUID()}'::uuid, now())`,
    ]) {
      await expect(asStaff(sup(REEM).subject, (tx) => tx.$queryRawUnsafe(sql))).rejects.toThrow(/permission denied/i);
    }
  });
});
