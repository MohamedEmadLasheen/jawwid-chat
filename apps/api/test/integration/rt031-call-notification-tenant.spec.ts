/**
 * RT-031 — calls and notifications stay inside one organization.
 *
 * Before the fix: `CallService.start` and `NotificationService.schedule` set no
 * organization_id, so every call and notification was filed under the default
 * organization whatever its tenant; no guard covered chat.call,
 * chat.call_participant or chat.notification; and call events were routed to
 * whatever chat.call_participant said.
 *
 * Every case below was run against that code first: the attribution, forged-row,
 * stale-row and notification cases fail there, and pass now. The legitimate
 * cases pass both before and after -- they are the positive controls.
 */
import { randomUUID } from 'node:crypto';
import { OutboxWorker } from '@communication/outbox/outbox.worker';
import type { RealtimePublisher } from '@communication/realtime/realtime.publisher';
import { CommEvent } from '@communication/contracts/events';
import { buildGraph, seed, truncate, withAssignmentGate, Scenario } from './harness';

jest.setTimeout(60_000);

const g = buildGraph();
let s: Scenario;
const DEFAULT_ORG = '00000000-0000-0000-0000-000000000001';

let b: { orgId: string; adminId: string; familyId: string; contactId: string; teacherId: string; learnerId: string };

/** Records who the worker decided to tell, per event. */
class Recorder implements RealtimePublisher {
  readonly toActors: Array<{ actorId: string; event: string; callId?: unknown }> = [];
  async toThread(): Promise<void> {}
  async toUsers(actorIds: string[], event: string, payload: unknown): Promise<void> {
    for (const actorId of actorIds) {
      this.toActors.push({ actorId, event, callId: (payload as { callId?: unknown })?.callId });
    }
  }
}

let recorder: Recorder;
let worker: OutboxWorker;

beforeAll(async () => {
  await g.prisma.$connect();
});
afterAll(async () => {
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'rt31-%'`);
  await g.prisma.$disconnect();
});

beforeEach(async () => {
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'rt31-%'`);
  s = await seed(g.prisma);
  recorder = new Recorder();
  worker = new OutboxWorker(g.prisma, g.notifications, recorder as never, g.identity);

  b = {
    orgId: randomUUID(),
    adminId: randomUUID(),
    familyId: randomUUID(),
    contactId: randomUUID(),
    teacherId: randomUUID(),
    learnerId: randomUUID(),
  };
  const o = `'${b.orgId}'::uuid`;
  await g.prisma.$executeRawUnsafe(
    `insert into chat.organization (id, slug, display_name) values (${o}, 'rt31-${b.orgId.slice(0, 8)}', 'org_b')`,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.staff (id, name, role, is_active, organization_id) values ('${b.adminId}'::uuid, 'admin_b1', 'admin', true, ${o})`,
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
});

/** The org-B parent calls the org-B admin; returns the call id. */
async function orgBCall(): Promise<{ callId: string; conversationId: string }> {
  const conv = await g.conversations.getOrCreateDirect(b.contactId, b.adminId);
  const started = await g.calls.start(conv.id, b.contactId);
  return { callId: started.callId, conversationId: conv.id };
}

async function drain(): Promise<void> {
  // Twice: a row inserted in the same millisecond as a claim can miss one pass
  // (see OutboxWorker.drain); a second pass is what the worker loop does.
  await worker.drain(100);
  await worker.drain(100);
}

async function violation(sql: string): Promise<string> {
  try {
    await g.prisma.$executeRawUnsafe(sql);
  } catch (e) {
    return String((e as Error).message);
  }
  return 'ACCEPTED';
}

describe('RT-031 · attribution', () => {
  it('a call is filed under its conversation\'s organization, not the default', async () => {
    const { callId } = await orgBCall();
    const call = await g.prisma.call.findUniqueOrThrow({ where: { id: callId } });
    expect(call.organizationId).toBe(b.orgId);
    expect(call.organizationId).not.toBe(DEFAULT_ORG);
  });

  it('control: a default-organization call is still filed under the default organization', async () => {
    const conv = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
    const { callId } = await g.calls.start(conv.id, s.parentId);
    expect((await g.prisma.call.findUniqueOrThrow({ where: { id: callId } })).organizationId).toBe(DEFAULT_ORG);
  });

  it('the incoming-call push for an org-B callee is filed under org B, and the event reaches them', async () => {
    const { callId } = await orgBCall();
    await drain();

    expect(recorder.toActors.filter((d) => d.event === CommEvent.CALL_INCOMING).map((d) => d.actorId).sort()).toEqual(
      [b.adminId, b.contactId].sort(),
    );
    const pushes = await g.prisma.notification.findMany({ where: { dedupeKey: { contains: callId } } });
    expect(pushes.length).toBeGreaterThan(0);
    for (const n of pushes) {
      expect(n.recipientId).toBe(b.adminId);
      expect(n.organizationId).toBe(b.orgId);
    }
  });
});

describe('RT-031 · forged and stale rows', () => {
  it('the database refuses a call participant from another organization', async () => {
    const { callId } = await orgBCall();
    const msg = await violation(
      `insert into chat.call_participant (call_id, actor_id, actor_kind) values ('${callId}'::uuid, '${s.parentId}'::uuid, 'contact')`,
    );
    expect(msg).toMatch(/cross-organization reference/);
  });

  it('the database refuses a participant naming no actor at all', async () => {
    const { callId } = await orgBCall();
    expect(
      await violation(
        `insert into chat.call_participant (call_id, actor_id, actor_kind) values ('${callId}'::uuid, '${randomUUID()}'::uuid, 'contact')`,
      ),
    ).toMatch(/cross-organization reference/);
  });

  it('the database refuses re-pointing a call at another organization\'s conversation', async () => {
    const { callId } = await orgBCall();
    const convA = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
    expect(
      await violation(`update chat.call set conversation_id = '${convA.id}'::uuid where id = '${callId}'::uuid`),
    ).toMatch(/cross-organization reference/);
  });

  it('a STALE foreign participant row (written past the guard) gets no event and no push', async () => {
    const { callId } = await orgBCall();
    // As a row from before the guard, or a manual write, would look.
    await g.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`set local session_replication_role = replica`);
      await tx.$executeRawUnsafe(
        `insert into chat.call_participant (call_id, actor_id, actor_kind) values ('${callId}'::uuid, '${s.parentId}'::uuid, 'contact')`,
      );
    });
    await drain();

    const told = recorder.toActors.filter((d) => d.callId === callId).map((d) => d.actorId);
    expect(told).not.toContain(s.parentId);
    expect(told).toEqual(expect.arrayContaining([b.adminId, b.contactId]));
    expect(await g.prisma.notification.count({ where: { recipientId: s.parentId } })).toBe(0);
  });

  it('a historical mis-filed call can still END (lifecycle updates are not tenant writes)', async () => {
    const { callId } = await orgBCall();
    await g.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`set local session_replication_role = replica`);
      await tx.$executeRawUnsafe(`update chat.call set organization_id = '${DEFAULT_ORG}'::uuid where id = '${callId}'::uuid`);
    });
    await expect(
      g.prisma.$executeRawUnsafe(
        `update chat.call set status = 'ended', ended_at = now(), outcome = 'missed' where id = '${callId}'::uuid`,
      ),
    ).resolves.toBe(1);
  });
});

describe('RT-031 · notifications', () => {
  it('a notification about an org-B conversation for an org-A recipient is refused, and nothing is written', async () => {
    const conv = await g.conversations.getOrCreateDirect(b.contactId, b.adminId);
    const id = await g.notifications.schedule({
      dedupeKey: `rt31:${randomUUID()}`,
      templateKey: 'new_message',
      eventType: 'message_published',
      recipientId: s.parentId,
      conversationId: conv.id,
      scheduledAt: new Date(),
    });
    expect(id).toBeNull();
    expect(await g.prisma.notification.count({ where: { recipientId: s.parentId } })).toBe(0);
  });

  it('a notification for a recipient who resolves nowhere is refused', async () => {
    expect(
      await g.notifications.schedule({
        dedupeKey: `rt31:${randomUUID()}`,
        templateKey: 'new_message',
        eventType: 'message_published',
        recipientId: randomUUID(),
        scheduledAt: new Date(),
      }),
    ).toBeNull();
  });

  it('a legitimate org-B notification is filed under org B', async () => {
    const conv = await g.conversations.getOrCreateDirect(b.contactId, b.adminId);
    const id = await g.notifications.schedule({
      dedupeKey: `rt31:${randomUUID()}`,
      templateKey: 'new_message',
      eventType: 'message_published',
      recipientId: b.contactId,
      conversationId: conv.id,
      scheduledAt: new Date(),
    });
    expect(id).not.toBeNull();
    expect((await g.prisma.notification.findUniqueOrThrow({ where: { id: id! } })).organizationId).toBe(b.orgId);
  });

  it('the database refuses a notification row whose recipient is in another organization', async () => {
    expect(
      await violation(
        `insert into chat.notification (dedupe_key, template_key, event_type, recipient_id, organization_id, scheduled_at)
         values ('rt31-raw-${randomUUID()}', 'new_message', 'message_published', '${s.parentId}'::uuid, '${b.orgId}'::uuid, now())`,
      ),
    ).toMatch(/cross-organization reference/);
  });

  it('a new message in an org-B conversation pushes org-B recipients only, filed under org B', async () => {
    const conv = await g.conversations.getOrCreateDirect(b.contactId, b.adminId);
    await g.messages.send({ conversationId: conv.id, senderId: b.contactId, body: 'hello', clientMessageId: randomUUID() });
    await drain();
    const pushes = await g.prisma.notification.findMany({ where: { conversationId: conv.id } });
    expect(pushes.length).toBeGreaterThan(0);
    for (const n of pushes) expect(n.organizationId).toBe(b.orgId);
  });
});
