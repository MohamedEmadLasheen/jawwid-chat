/**
 * THE STAFF CONVERSATION SET IS ONE ORGANIZATION'S, decided in the query.
 *
 * `ConversationService.listForActor` is the canonical "conversations this actor
 * may read" surface. For family-facing staff it was the 200 most recent
 * conversations of EVERY organization, filtered by nothing; `GET
 * /conversations` and `GET /calls/history` (via `CallService.historyForActor`)
 * both stand on it. The boundary is now the staff member's own organization --
 * resolved by IdentityService from the staff row, never from a request -- and it
 * is applied in the WHERE clause, so the 200-row cap is spent on that
 * organization's conversations only and another tenant's activity can never
 * displace them.
 *
 * What this file does NOT decide: how far an admin or coverage admin may read
 * INSIDE their organization. The approved predicate is AUTHORIZATION-MODEL.md
 * section 6 (owned families, assignments, live membership, and a documented
 * interim on-duty exception); until the dedicated scope changeset enforces it,
 * their in-organization reach is the known defect A-1 / RT-011, and this file
 * asserts it neither way. A manager's organization-wide reach IS the approved
 * policy and is asserted. A contact or a teacher still sees live membership and
 * nothing else; non-family-facing roles are still refused.
 *
 * The second half pins the notification boundary of Decision 3: a CALL
 * notification is filed under its call's organization, while every flow that
 * does not name an organization -- message notifications, reminders, a rule
 * scheduled without one -- writes exactly the row it wrote before.
 */
import { randomUUID } from 'node:crypto';
import { CommError, CommErrorCode } from '@platform/errors';
import { ConversationController } from '@communication/api/conversation.controller';
import { OutboxWorker } from '@communication/outbox/outbox.worker';
import { NotificationService } from '@communication/notifications/notification.service';
import { buildGraph, seed, truncate, Scenario } from './harness';

jest.setTimeout(120_000);

const g = buildGraph();
const controller = new ConversationController(g.conversations, g.messages, g.calls);
const worker = new OutboxWorker(
  g.prisma,
  new NotificationService(g.prisma, g.templates, g.quietHours, g.config, {
    send: async () => ({ ok: true }),
  }) as unknown as NotificationService,
  { toThread: async () => undefined, toUsers: async () => undefined } as never,
  g.identity,
);
let s: Scenario;

const DEFAULT_ORG = '00000000-0000-0000-0000-000000000001';
const ORG_SLUG_PREFIX = 'advs-';
const LIST_CAP = 200;

let b: { orgId: string; adminId: string; managerId: string; familyId: string; contactId: string; directId: string };
let financeId: string;

async function refusal(p: Promise<unknown>): Promise<CommError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof CommError) return e;
    throw e;
  }
  throw new Error('expected a refusal, but the operation succeeded');
}

const ids = (rows: Array<{ id: string }>) => rows.map((r) => r.id);

/** `count` organization-A conversations, all MORE RECENT than anything else. */
async function floodOrganizationA(count: number): Promise<void> {
  await g.prisma.$executeRawUnsafe(
    `insert into chat.conversation (type, state, family_id, last_activity_at)
     select 'class_group', 'open', null, now() + interval '1 hour' + (n || ' seconds')::interval
       from generate_series(1, ${count}) n`,
  );
}

beforeAll(async () => {
  await g.prisma.$connect();
});

afterAll(async () => {
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like '${ORG_SLUG_PREFIX}%'`);
  await g.prisma.$disconnect();
});

beforeEach(async () => {
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like '${ORG_SLUG_PREFIX}%'`);
  s = await seed(g.prisma);
  g.coverage.onDutyId = s.ownerId;

  financeId = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.staff (id, name, role, is_active) values ('${financeId}'::uuid, 'finance_f', 'finance', true)`,
  );

  b = {
    orgId: randomUUID(),
    adminId: randomUUID(),
    managerId: randomUUID(),
    familyId: randomUUID(),
    contactId: randomUUID(),
    directId: randomUUID(),
  };
  const o = `'${b.orgId}'::uuid`;
  await g.prisma.$executeRawUnsafe(
    `insert into chat.organization (id, slug, display_name) values (${o}, '${ORG_SLUG_PREFIX}${b.orgId.slice(0, 8)}', 'org_b')`,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.staff (id, name, role, is_active, organization_id) values
       ('${b.adminId}'::uuid, 'admin_b1', 'admin', true, ${o}),
       ('${b.managerId}'::uuid, 'manager_b1', 'manager', true, ${o})`,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.family (id, display_name, owner_id, language, organization_id)
     values ('${b.familyId}'::uuid, 'family_b', '${b.adminId}'::uuid, 'ar', ${o})`,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.contact (id, family_id, name, role_preset, can_message, is_active, organization_id)
     values ('${b.contactId}'::uuid, '${b.familyId}'::uuid, 'parent_b1', 'primary_guardian', true, true, ${o})`,
  );
  const directKey = [b.contactId, b.adminId].sort().join(':');
  // Older than anything organization A will create, so a recency-ordered,
  // unscoped query reaches it LAST.
  await g.prisma.$executeRawUnsafe(
    `insert into chat.conversation (id, type, family_id, direct_key, organization_id, last_activity_at)
     values ('${b.directId}'::uuid, 'direct', '${b.familyId}'::uuid, '${directKey}', ${o}, now() - interval '1 day')`,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.conversation_member (conversation_id, actor_kind, actor_id, member_role) values
       ('${b.directId}'::uuid, 'contact', '${b.contactId}'::uuid, 'parent'),
       ('${b.directId}'::uuid, 'staff', '${b.adminId}'::uuid, 'admin')`,
  );
});

// ===========================================================================
describe('listForActor: staff see their own organization, decided in the query', () => {
  it("a manager of organization B sees B's conversations and none of A's", async () => {
    const aDirect = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
    const aGroup = await g.conversations.ensureStudentGroup(s.learnerId);

    const list = ids(await g.conversations.listForActor(b.managerId));
    expect(list).toEqual([b.directId]);
    expect(list).not.toContain(aDirect.id);
    expect(list).not.toContain(aGroup.id);
  });

  it("a manager sees every conversation of their own organization (AUTHORIZATION-MODEL section 6), and none of another's", async () => {
    const aDirect = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
    const aGroup = await g.conversations.ensureStudentGroup(s.learnerId);

    // The manager is a member of neither conversation: this is the manager's
    // organization-wide scope, not membership. An admin's or coverage admin's
    // narrower scope is enforced and tested by the dedicated scope changeset.
    const list = ids(await g.conversations.listForActor(s.managerId));
    expect(list.sort()).toEqual([aDirect.id, aGroup.id].sort());
    expect(list).not.toContain(b.directId);
  });

  it("another organization's newer activity cannot displace an organization's own conversations from the cap", async () => {
    await floodOrganizationA(LIST_CAP + 5);

    expect(ids(await g.conversations.listForActor(b.managerId))).toEqual([b.directId]);

    const forA = ids(await g.conversations.listForActor(s.managerId));
    expect(forA).toHaveLength(LIST_CAP); // the existing cap, unchanged
    expect(forA).not.toContain(b.directId);
  });

  it('GET /conversations (the controller) returns only the caller organization', async () => {
    const aDirect = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
    const forB = ids((await controller.list(b.managerId)).conversations);
    expect(forB).toEqual([b.directId]);
    const forA = ids((await controller.list(s.managerId)).conversations);
    expect(forA).toContain(aDirect.id);
    expect(forA).not.toContain(b.directId);
  });

  it('unchanged: a contact and a teacher see live membership and nothing else', async () => {
    const aDirect = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
    const aGroup = await g.conversations.ensureStudentGroup(s.learnerId);
    await g.conversations.getOrCreateDirect(s.teacherId, s.ownerId);

    expect(ids(await g.conversations.listForActor(s.parentId)).sort()).toEqual([aDirect.id, aGroup.id].sort());
    expect(ids(await g.conversations.listForActor(b.contactId))).toEqual([b.directId]);
    expect(ids(await g.conversations.listForActor(s.unrelatedTeacherId))).toEqual([]);
  });

  it('unchanged: a role that never takes part in family communication is still refused', async () => {
    expect((await refusal(g.conversations.listForActor(financeId))).code).toBe(
      CommErrorCode.ROLE_CANNOT_MESSAGE_FAMILY,
    );
  });

  it('account call history obeys the same boundary, and is not starved by the cap', async () => {
    g.coverage.onDutyId = b.adminId;
    const { callId } = await g.calls.start(b.directId, b.adminId);
    await floodOrganizationA(LIST_CAP + 5);

    expect((await g.calls.historyForActor(b.managerId)).items.map((r) => r.id)).toEqual([callId]);
    expect((await g.calls.historyForActor(s.managerId)).items.map((r) => r.id)).not.toContain(callId);
  });
});

// ===========================================================================
describe('notifications: call rows carry their organization; nothing else changes', () => {
  it('a call notification in the default organization is filed there', async () => {
    const conv = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
    const { callId } = await g.calls.start(conv.id, s.ownerId);
    await worker.drain(100);

    const rows = await g.prisma.notification.findMany({ where: { dedupeKey: { contains: callId } } });
    expect(rows.map((r) => r.eventType)).toEqual(['call_started']);
    expect(rows[0].organizationId).toBe(DEFAULT_ORG);
  });

  it('missed-call notifications in organization B are filed in B', async () => {
    g.coverage.onDutyId = b.adminId;
    const { callId } = await g.calls.start(b.directId, b.adminId);
    await g.calls.end(callId, b.adminId);
    await worker.drain(100);

    const rows = await g.prisma.notification.findMany({ where: { dedupeKey: { contains: callId } } });
    expect(rows.map((r) => r.eventType).sort()).toEqual(['call_missed', 'call_started']);
    for (const r of rows) expect(r.organizationId).toBe(b.orgId);
  });

  it('unchanged: a message notification is written exactly as before', async () => {
    const conv = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
    const msg = await g.messages.send({ conversationId: conv.id, senderId: s.parentId, body: 'hello' });
    await worker.drain(100);

    const rows = await g.prisma.notification.findMany({ where: { eventType: 'message_published' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      dedupeKey: `new_message:${msg.id}:${s.ownerId}`,
      ruleKey: 'new_message',
      recipientId: s.ownerId,
      conversationId: conv.id,
      familyId: null,
      organizationId: DEFAULT_ORG,
    });
  });

  it('unchanged: a reminder is written exactly as before', async () => {
    await g.reminders.scheduleForEvent('class_scheduled', {
      subjectId: 'session_advs',
      anchorAt: new Date('2026-09-10T09:00:00Z'),
      recipients: [{ actorId: s.parentId, locale: 'ar', role: 'parent' }],
      familyId: s.familyId,
      variables: { student_name: 'learner_l' },
    });
    const rows = await g.prisma.notification.findMany({ where: { eventType: 'class_scheduled' } });
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.organizationId).toBe(DEFAULT_ORG);
      expect(r.familyId).toBe(s.familyId);
      expect(r.recipientId).toBe(s.parentId);
    }
  });

  it('unchanged: a rule scheduled WITHOUT an organization takes the column default, as before', async () => {
    const id = await g.notifications.scheduleByRule('incoming_call', {
      recipientId: s.parentId,
      dedupeKey: `advs-no-org:${randomUUID()}`,
    });
    const row = await g.prisma.notification.findUniqueOrThrow({ where: { id: id! } });
    expect(row.organizationId).toBe(DEFAULT_ORG);
  });
});
