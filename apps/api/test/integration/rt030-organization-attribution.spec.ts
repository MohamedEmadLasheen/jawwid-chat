/**
 * RT-030 -- organization attribution of direct conversations and messages,
 * against the real migrated database, with real rows in TWO organizations.
 *
 * Before the fix both paths omitted `organization_id`, so every row took the
 * column default (the seeded organization). For a second tenant the database's
 * same-organization triggers refused the row; a Teacher<->Admin direct, which
 * has no family to be checked against, was silently filed under the default.
 *
 * The fix files each row under its trusted organization AND refuses a
 * cross-organization write explicitly -- correct attribution alone would have
 * turned the triggers' accidental refusals into accepted writes.
 */
import { randomUUID } from 'node:crypto';
import { CommError, CommErrorCode } from '@platform/errors';
import { buildGraph, seed, truncate, withAssignmentGate, Scenario, supervise } from './harness';

jest.setTimeout(60_000);

const g = buildGraph();
let s: Scenario;
const DEFAULT_ORG = '00000000-0000-0000-0000-000000000001';

/** A complete second tenant: its own staff, family, contact, teacher and learner. */
let b: {
  orgId: string;
  adminId: string;
  managerId: string;
  familyId: string;
  contactId: string;
  teacherId: string;
  learnerId: string;
};

beforeAll(async () => {
  await g.prisma.$connect();
});
afterAll(async () => {
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'rt30-%'`);
  await g.prisma.$disconnect();
});

beforeEach(async () => {
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'rt30-%'`);
  s = await seed(g.prisma);
  g.coverage.onDutyId = s.ownerId;

  b = {
    orgId: randomUUID(),
    adminId: randomUUID(),
    managerId: randomUUID(),
    familyId: randomUUID(),
    contactId: randomUUID(),
    teacherId: randomUUID(),
    learnerId: randomUUID(),
  };
  const o = `'${b.orgId}'::uuid`;
  await g.prisma.$executeRawUnsafe(
    `insert into chat.organization (id, slug, display_name) values (${o}, 'rt30-${b.orgId.slice(0, 8)}', 'org_b')`,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.staff (id, name, role, is_active, organization_id) values
       ('${b.adminId}'::uuid, 'admin_b1', 'admin', true, ${o}),
       ('${b.managerId}'::uuid, 'manager_b1', 'manager', true, ${o})`,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.teacher (id, name, is_active, organization_id) values ('${b.teacherId}'::uuid, 'teacher_b1', true, ${o})`,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.family (id, display_name, owner_id, language, organization_id)
     values ('${b.familyId}'::uuid, 'family_b', '${b.adminId}'::uuid, 'ar', ${o})`,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.contact (id, family_id, name, role_preset, can_message, is_active, organization_id)
     values ('${b.contactId}'::uuid, '${b.familyId}'::uuid, 'parent_b1', 'primary_guardian', true, true, ${o})`,
  );
  await withAssignmentGate(
    g.prisma,
    `insert into chat.learner (id, family_id, name, teacher_id, organization_id)
     values ('${b.learnerId}'::uuid, '${b.familyId}'::uuid, 'learner_b1', '${b.teacherId}'::uuid, ${o})`,
  );
  // PD-8: org B's admin supervises org B's child (manager_b1 runs its Operations).
  await supervise(g.prisma, b.adminId, [b.learnerId], { managerId: b.managerId });
});

async function footprint(): Promise<Record<string, number | string>> {
  const rows = await g.prisma.$queryRawUnsafe<{ t: string; n: string }[]>(`
    select 'conversation' t, count(*)::text n from chat.conversation
    union all select 'member', count(*)::text from chat.conversation_member
    union all select 'message', count(*)::text from chat.message
    union all select 'approval', count(*)::text from chat.message_approval
    union all select 'receipt', count(*)::text from chat.message_receipt
    union all select 'event', count(*)::text from chat.event_log
    union all select 'audit', count(*)::text from chat.audit_log
    union all select 'outbox', count(*)::text from chat.outbox_event
    union all select 'seqs', coalesce(string_agg(id::text || '=' || last_seq::text, ',' order by id), '') from chat.conversation`);
  return Object.fromEntries(rows.map((r) => [r.t, r.n]));
}

async function refusal(p: Promise<unknown>): Promise<CommError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof CommError) return e;
    throw e;
  }
  throw new Error('expected a refusal, but the call succeeded');
}

const orgOfConversation = async (id: string) =>
  (await g.prisma.conversation.findUniqueOrThrow({ where: { id } })).organizationId;

// ===========================================================================
describe('direct conversations', () => {
  it('default organization: a parent<->admin direct is filed under the default organization', async () => {
    const conv = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
    expect(await orgOfConversation(conv.id)).toBe(DEFAULT_ORG);
  });

  it("second organization: a parent<->admin direct is filed under the family's organization", async () => {
    const conv = await g.conversations.getOrCreateDirect(b.contactId, b.adminId);
    expect(conv.organizationId).toBe(b.orgId);
    expect(await orgOfConversation(conv.id)).toBe(b.orgId);
  });

  it('second organization: a Teacher<->Admin direct (no family) is filed under its tenant, not the default', async () => {
    // Before RT-030 this case was not refused but silently MIS-FILED: with no
    // family there is nothing for the trigger to compare against.
    const conv = await g.conversations.getOrCreateDirect(b.teacherId, b.adminId);
    expect(conv.familyId).toBeNull();
    expect(await orgOfConversation(conv.id)).toBe(b.orgId);
  });

  // RE-VERSIONED 2026-10-14 BY PD-7. This asserted that an authorized
  // Teacher<->Parent (PD-6) direct was filed under its tenant. PD-7 restores
  // BR-1, so there is no such row to file: the same-tenant, related pair is
  // refused by BR-1 -- named as BR-1, not answered as an unknown actor, since
  // both sides ARE in one organization -- and nothing is written.
  it('second organization: a related Teacher<->Parent direct is refused by BR-1, with no writes', async () => {
    const before = await footprint();
    const e = await refusal(g.conversations.getOrCreateDirect(b.teacherId, b.contactId));
    expect([e.code, e.status]).toEqual([CommErrorCode.BR1_TEACHER_PARENT_DIRECT, 403]);
    expect(await footprint()).toEqual(before);
  });

  it('retrieving an existing direct, from either side, creates nothing new', async () => {
    const first = await g.conversations.getOrCreateDirect(b.contactId, b.adminId);
    const before = await footprint();
    const again = await g.conversations.getOrCreateDirect(b.adminId, b.contactId);
    expect(again.id).toBe(first.id);
    expect(await footprint()).toEqual(before);
  });

  it('concurrent requests for one pair produce exactly one conversation, two members and one event', async () => {
    const before = await footprint();
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        i % 2 === 0
          ? g.conversations.getOrCreateDirect(b.contactId, b.adminId)
          : g.conversations.getOrCreateDirect(b.adminId, b.contactId),
      ),
    );
    expect(new Set(results.map((c) => c.id)).size).toBe(1);
    const after = await footprint();
    expect(Number(after.conversation) - Number(before.conversation)).toBe(1);
    expect(Number(after.member) - Number(before.member)).toBe(2);
    expect(Number(after.event) - Number(before.event)).toBe(1);
    expect(await orgOfConversation(results[0].id)).toBe(b.orgId);
  });

  it('a cross-organization pair is refused exactly as an unknown actor, with no writes', async () => {
    const before = await footprint();
    const attempts: [string, string][] = [
      [s.ownerId, b.contactId], // admin A -> parent B
      [s.managerId, b.teacherId], // manager A -> teacher B (no family: formerly MIS-FILED, now refused)
      [b.contactId, s.ownerId], // parent B -> admin A
      [b.adminId, s.parentId], // admin B -> parent A
    ];
    const unknown = await refusal(g.conversations.getOrCreateDirect(s.ownerId, randomUUID()));
    expect([unknown.code, unknown.status]).toEqual([CommErrorCode.UNKNOWN_ACTOR, 401]);
    for (const [from, to] of attempts) {
      const e = await refusal(g.conversations.getOrCreateDirect(from, to));
      expect([e.code, e.status, e.message]).toEqual([unknown.code, unknown.status, unknown.message]);
    }
    expect(await footprint()).toEqual(before);
  });

  it('naming the SYSTEM actor as the other side is refused cleanly (formerly a database 500)', async () => {
    const before = await footprint();
    const e = await refusal(g.conversations.getOrCreateDirect(s.ownerId, '00000000-0000-0000-0000-000000000000'));
    expect([e.code, e.status]).toEqual([CommErrorCode.UNKNOWN_ACTOR, 401]);
    expect(await footprint()).toEqual(before);
  });

  it('the existing pair rules still hold inside the second organization', async () => {
    const e = await refusal(g.conversations.getOrCreateDirect(b.adminId, b.managerId));
    expect(e.code).toBe(CommErrorCode.STAFF_STAFF_DISABLED);
  });
});

// ===========================================================================
describe('ordinary message sending', () => {
  it('default organization: a message is filed under the conversation organization', async () => {
    const conv = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
    const m = await g.messages.send({ conversationId: conv.id, senderId: s.parentId, body: 'hello A' });
    const row = await g.prisma.message.findUniqueOrThrow({ where: { id: m.id } });
    expect(row.organizationId).toBe(DEFAULT_ORG);
  });

  it('second organization: parent and admin messages are filed under that organization, with receipts and events', async () => {
    const conv = await g.conversations.getOrCreateDirect(b.contactId, b.adminId);
    // Existing routing, unchanged by RT-030: staff reply in a family direct as
    // the on-duty handler. The harness pins on-duty; point it at this tenant.
    g.coverage.onDutyId = b.adminId;
    const before = await footprint();
    const p = await g.messages.send({ conversationId: conv.id, senderId: b.contactId, body: 'hello B' });
    const a = await g.messages.send({ conversationId: conv.id, senderId: b.adminId, body: 'welcome B' });
    for (const id of [p.id, a.id]) {
      const row = await g.prisma.message.findUniqueOrThrow({ where: { id } });
      expect(row.organizationId).toBe(b.orgId);
      expect(row.moderation).toBe('published');
    }
    const after = await footprint();
    expect(Number(after.message) - Number(before.message)).toBe(2);
    expect(Number(after.receipt) - Number(before.receipt)).toBe(2);
    const events = await g.prisma.outboxEvent.findMany({ where: { type: 'message.created' } });
    expect(events.map((e) => (e.payload as { messageId: string }).messageId).sort()).toEqual([p.id, a.id].sort());
  });

  it('second organization: a Teacher<->Admin direct carries messages in its tenant', async () => {
    const conv = await g.conversations.getOrCreateDirect(b.teacherId, b.adminId);
    const m = await g.messages.send({ conversationId: conv.id, senderId: b.teacherId, body: 'question' });
    expect((await g.prisma.message.findUniqueOrThrow({ where: { id: m.id } })).organizationId).toBe(b.orgId);
  });

  it('second organization: group posts by teacher and parent are still HELD, and the approval is filed in that tenant', async () => {
    const group = await g.conversations.ensureStudentGroup(b.learnerId, b.adminId);
    const t = await g.messages.send({ conversationId: group.id, senderId: b.teacherId, body: 'homework' });
    const p = await g.messages.send({ conversationId: group.id, senderId: b.contactId, body: 'thanks' });
    expect([t.moderation, p.moderation]).toEqual(['pending', 'pending']);
    const approvals = await g.prisma.messageApproval.findMany({ where: { conversationId: group.id } });
    expect(approvals).toHaveLength(2);
    expect(new Set(approvals.map((x) => x.organizationId))).toEqual(new Set([b.orgId]));
    const msgs = await g.prisma.message.findMany({ where: { id: { in: [t.id, p.id] } } });
    expect(new Set(msgs.map((x) => x.organizationId))).toEqual(new Set([b.orgId]));
    const requested = await g.prisma.outboxEvent.count({ where: { type: 'approval.requested' } });
    expect(requested).toBe(2);

    // And a manager of that organization can still decide it.
    await g.approvals.approve(approvals.find((x) => x.messageId === t.id)!.id, b.managerId);
    expect((await g.prisma.message.findUniqueOrThrow({ where: { id: t.id } })).moderation).toBe('published');
  });

  it("idempotent retries in the second organization return the same message, filed once", async () => {
    const conv = await g.conversations.getOrCreateDirect(b.contactId, b.adminId);
    const clientMessageId = randomUUID();
    const [m1, m2] = await Promise.all([
      g.messages.send({ conversationId: conv.id, senderId: b.contactId, body: 'once', clientMessageId }),
      g.messages.send({ conversationId: conv.id, senderId: b.contactId, body: 'once', clientMessageId }),
    ]);
    expect(m1.id).toBe(m2.id);
    expect(await g.prisma.message.count({ where: { conversationId: conv.id, clientMessageId } })).toBe(1);
  });

  it("a sender from ANOTHER organization is refused exactly as for an unknown conversation, with no writes", async () => {
    const convB = await g.conversations.getOrCreateDirect(b.contactId, b.adminId);
    const groupB = await g.conversations.ensureStudentGroup(b.learnerId, b.adminId);
    const before = await footprint();
    const unknown = await refusal(g.messages.send({ conversationId: randomUUID(), senderId: s.managerId, body: 'x' }));
    expect([unknown.code, unknown.status]).toEqual([CommErrorCode.CONVERSATION_NOT_FOUND, 404]);
    // A manager may send ANYWHERE in their own organization -- not into another.
    for (const [conversationId, senderId] of [
      [convB.id, s.managerId],
      [convB.id, s.ownerId],
      [groupB.id, s.managerId],
      [groupB.id, s.parentId],
      [groupB.id, s.teacherId],
    ]) {
      const e = await refusal(g.messages.send({ conversationId, senderId, body: 'cross-tenant' }));
      expect([e.code, e.status, e.message]).toEqual([unknown.code, unknown.status, unknown.message]);
    }
    expect(await footprint()).toEqual(before);
  });

  it('the tenant refusal comes FIRST: an attachment payload cannot make a foreign conversation distinguishable', async () => {
    // Attachment checks (MIME allow-list, object-key namespace) used to run
    // before the tenant check, so a foreign conversation answered with an
    // attachment error while an unknown one answered 404 -- an existence oracle.
    const convB = await g.conversations.getOrCreateDirect(b.contactId, b.adminId);
    const payloads = [
      // A well-formed attachment whose key names a different conversation.
      [{ kind: 'image', objectKey: `conversations/${randomUUID()}/${randomUUID()}`, mimeType: 'image/jpeg', byteSize: 10 }],
      // A MIME type the allow-list refuses.
      [{ kind: 'image', objectKey: `conversations/${convB.id}/${randomUUID()}`, mimeType: 'application/x-msdownload', byteSize: 10 }],
    ];
    const before = await footprint();
    for (const attachments of payloads) {
      const unknown = await refusal(
        g.messages.send({ conversationId: randomUUID(), senderId: s.managerId, body: 'x', attachments }),
      );
      const foreign = await refusal(
        g.messages.send({ conversationId: convB.id, senderId: s.managerId, body: 'x', attachments }),
      );
      expect([unknown.code, unknown.status]).toEqual([CommErrorCode.CONVERSATION_NOT_FOUND, 404]);
      expect([foreign.code, foreign.status, foreign.message]).toEqual([unknown.code, unknown.status, unknown.message]);
    }
    expect(await footprint()).toEqual(before);
  });

  it('an unauthorized sender INSIDE the organization is still refused by the existing rules, with no writes', async () => {
    const convB = await g.conversations.getOrCreateDirect(b.contactId, b.adminId);
    const before = await footprint();
    // The teacher is not a member of the parent<->admin direct.
    const e = await refusal(g.messages.send({ conversationId: convB.id, senderId: b.teacherId, body: 'not mine' }));
    expect(e.code).toBe(CommErrorCode.NOT_CONVERSATION_MEMBER);
    expect(await footprint()).toEqual(before);
  });

  it('a forged organizationId in the input cannot re-file a message', async () => {
    const convB = await g.conversations.getOrCreateDirect(b.contactId, b.adminId);
    const forged = { conversationId: convB.id, senderId: b.contactId, body: 'forged', organizationId: DEFAULT_ORG };
    const m = await g.messages.send(forged as Parameters<typeof g.messages.send>[0]);
    expect((await g.prisma.message.findUniqueOrThrow({ where: { id: m.id } })).organizationId).toBe(b.orgId);
  });
});

// ===========================================================================
describe('Student Group RT-030 regression', () => {
  it('a second-organization group and its system message remain in that tenant', async () => {
    const group = await g.conversations.ensureStudentGroup(b.learnerId, b.adminId);
    expect(await orgOfConversation(group.id)).toBe(b.orgId);
    const sys = await g.prisma.message.findMany({ where: { conversationId: group.id } });
    expect(new Set(sys.map((m) => m.organizationId))).toEqual(new Set([b.orgId]));
  });
});
