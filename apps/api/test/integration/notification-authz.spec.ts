/**
 * A NOTIFICATION IS NOT AN AUTHORIZATION TOKEN.
 *
 * Every push payload this system sends is a bag of ids: notificationId,
 * conversationId, messageId, callId, learnerId, announcementId, entityId. They
 * travel through Google's and Apple's infrastructure, sit in an OS notification
 * centre, and are readable by anything that can see the device. They are
 * routing hints, and nothing else.
 *
 * So the rule this suite exists to prove, one id at a time: HOLDING THE ID IS
 * NOT BEING ENTITLED TO WHAT IT NAMES. Every endpoint that accepts one of them
 * re-authorizes against the caller's own session, and a refusal is
 * indistinguishable from the thing not existing -- otherwise the refusal itself
 * becomes an oracle for which ids are real.
 *
 * The attacker here is not anonymous. They are a real, signed-in parent of
 * another family, holding real ids, which is the realistic threat: a shared
 * device, a forwarded screenshot, a payload read off a lock screen.
 *
 * Requires the migrated database (DATABASE_URL).
 */
import { randomUUID } from 'node:crypto';
import { buildGraph, seed, truncate, Scenario } from './harness';
import { NotificationType } from '@communication/contracts/notifications';

const g = buildGraph();
let s: Scenario;

const drain = () => g.outboxWorker.drain(200);

const admin = () => ({
  actorId: s.ownerId,
  kind: 'staff' as const,
  displayName: 'admin_a',
  locale: 'ar' as const,
  isActive: true,
  staffRole: 'admin' as const,
});

/** The other family: their own parent, their own child. Signed in, and real. */
interface Outsider {
  parentId: string;
  familyId: string;
  learnerId: string;
}

async function outsider(): Promise<Outsider> {
  const ids = { familyId: randomUUID(), parentId: randomUUID(), learnerId: randomUUID() };
  await g.prisma.$executeRawUnsafe(
    `insert into chat.family (id, display_name, owner_id, language)
     values ('${ids.familyId}'::uuid, 'family_o', '${s.ownerId}'::uuid, 'ar')`,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.contact (id, family_id, name, role_preset, can_message, is_active)
     values ('${ids.parentId}'::uuid, '${ids.familyId}'::uuid, 'parent_o',
             'primary_guardian', true, true)`,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.learner (id, family_id, name, teacher_id)
     values ('${ids.learnerId}'::uuid, '${ids.familyId}'::uuid, 'learner_o',
             '${s.teacherId}'::uuid)`,
  );
  return ids;
}

/**
 * Exactly what a real push payload carries, produced by the real pipeline.
 * Nothing in this suite invents an id.
 */
async function payloadOfARealNotification(): Promise<{
  notificationId: string;
  conversationId: string;
  messageId: string;
  learnerId: string;
}> {
  const conversationId = (await g.conversations.ensureStudentGroup(s.learnerId)).id;
  const sent = await g.messages.send({
    conversationId,
    senderId: s.ownerId,
    body: 'private to this family',
  });
  await drain();
  const n = (await g.prisma.notification.findFirst({
    where: { recipientId: s.parentId },
  }))!;

  return {
    notificationId: n.id,
    conversationId: n.conversationId!,
    messageId: n.entityId!,
    learnerId: n.learnerId!,
  };
}

beforeEach(async () => {
  await truncate(g.prisma);
  s = await seed(g.prisma);
  g.coverage.onDutyId = s.ownerId;
});

afterAll(async () => {
  await truncate(g.prisma);
  await g.prisma.$disconnect();
});

// =========================================================================
describe('notificationId', () => {
  it('does not open the notification', async () => {
    const p = await payloadOfARealNotification();
    const them = await outsider();

    await expect(g.centre.byId(them.parentId, p.notificationId)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('does not mark it read, and does not say whether it exists', async () => {
    const p = await payloadOfARealNotification();
    const them = await outsider();

    // `false`, the same answer an id that never existed gets.
    expect(await g.centre.markRead(them.parentId, p.notificationId)).toBe(false);
    expect(await g.centre.markRead(them.parentId, randomUUID())).toBe(false);
    expect(
      (await g.prisma.notification.findUnique({ where: { id: p.notificationId } }))!.readAt,
    ).toBeNull();
  });

  it('does not expose the delivery trace', async () => {
    const p = await payloadOfARealNotification();
    const them = await outsider();

    // The controller gates the trace behind byId for exactly this reason: a
    // delivery trace names devices and platforms.
    await expect(g.centre.byId(them.parentId, p.notificationId)).rejects.toBeDefined();
  });

  it('does not let them report it delivered or opened on somebody else’s behalf',
    async () => {
      const p = await payloadOfARealNotification();
      const them = await outsider();

      await g.notifications.markDelivered(p.notificationId, them.parentId);

      // Scoped by (notification, recipient), so naming a real notification with
      // the wrong recipient matches nothing.
      const rows = await g.prisma.notificationDelivery.findMany({
        where: { notificationId: p.notificationId },
      });
      expect(rows.every((r) => r.status !== 'delivered')).toBe(true);
    });
});

// =========================================================================
describe('conversationId', () => {
  it('does not read the thread', async () => {
    const p = await payloadOfARealNotification();
    const them = await outsider();

    await expect(
      g.messages.list({ conversationId: p.conversationId, actorId: them.parentId }),
    ).rejects.toBeDefined();
  });

  it('does not let them write into it', async () => {
    const p = await payloadOfARealNotification();
    const them = await outsider();

    await expect(
      g.messages.send({
        conversationId: p.conversationId,
        senderId: them.parentId,
        body: 'I should not be here',
      }),
    ).rejects.toBeDefined();
  });

  it('does not let them change its settings', async () => {
    const p = await payloadOfARealNotification();
    const them = await outsider();

    await expect(
      g.conversations.setPreferences(p.conversationId, them.parentId, { pinned: true }),
    ).rejects.toBeDefined();
  });

  it('does not expose its call history', async () => {
    const p = await payloadOfARealNotification();
    const them = await outsider();

    await expect(
      g.calls.history(p.conversationId, them.parentId),
    ).rejects.toBeDefined();
  });

  it('does not expose its approval history', async () => {
    const p = await payloadOfARealNotification();
    const them = await outsider();

    await expect(
      g.approvals.history(p.conversationId, them.parentId),
    ).rejects.toBeDefined();
  });

  it('does not let them start a call in it', async () => {
    const p = await payloadOfARealNotification();
    const them = await outsider();

    await expect(g.calls.start(p.conversationId, them.parentId)).rejects.toBeDefined();
  });

  it('marks nothing read, and reports zero rather than refusing', async () => {
    const p = await payloadOfARealNotification();
    const them = await outsider();

    // This one is scoped rather than refused, deliberately: it only ever
    // touches the caller's OWN notifications, so naming someone else's
    // conversation is a no-op. A 403 here would confirm the conversation
    // exists, which is the thing being protected.
    expect(await g.centre.markConversationRead(them.parentId, p.conversationId)).toBe(0);
    expect(
      (await g.prisma.notification.findUnique({ where: { id: p.notificationId } }))!.readAt,
    ).toBeNull();
  });
});

// =========================================================================
describe('messageId', () => {
  it('does not let them react to it', async () => {
    const p = await payloadOfARealNotification();
    const them = await outsider();

    await expect(g.messages.react(p.messageId, them.parentId, '👍')).rejects.toBeDefined();
  });

  it('does not let them hide it, or delete it for everyone', async () => {
    const p = await payloadOfARealNotification();
    const them = await outsider();

    await expect(g.messages.deleteForMe(p.messageId, them.parentId)).rejects.toBeDefined();
    await expect(
      g.messages.deleteForEveryone(p.messageId, them.parentId, 'not mine'),
    ).rejects.toBeDefined();

    const row = await g.prisma.message.findUnique({ where: { id: p.messageId } });
    expect(row!.deletedAt).toBeNull();
  });
});

// =========================================================================
describe('callId', () => {
  async function ringingCall(): Promise<string> {
    const conversationId = (await g.conversations.ensureStudentGroup(s.learnerId)).id;
    const { callId } = await g.calls.start(conversationId, s.ownerId);
    return callId;
  }

  it('does not let them answer somebody else’s call', async () => {
    const callId = await ringingCall();
    const them = await outsider();

    await expect(g.calls.accept(callId, them.parentId)).rejects.toBeDefined();
  });

  it('does not let them decline or end it', async () => {
    const callId = await ringingCall();
    const them = await outsider();

    await expect(g.calls.decline(callId, them.parentId)).rejects.toBeDefined();
    await expect(g.calls.end(callId, them.parentId, 'missed')).rejects.toBeDefined();

    // Still ringing: nothing they did touched it.
    expect(
      (await g.prisma.call.findUnique({ where: { id: callId } }))!.status,
    ).toBe('ringing');
  });
});

// =========================================================================
/**
 * learnerId. THE ONE THAT WAS ACTUALLY OPEN.
 *
 * Two routes took a learner id and answered with that learner's student-group
 * conversation -- id, family id, title, activity -- without asking who was
 * calling, and the sync route also wrote to it. A learner id is in the payload
 * of every class notification, which is precisely how an id like this gets into
 * the wrong hands.
 */
describe('learnerId', () => {
  it('does not hand over another family’s student group', async () => {
    const p = await payloadOfARealNotification();
    const them = await outsider();

    await expect(
      g.conversations.ensureStudentGroup(p.learnerId, them.parentId),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('does not let them reconcile its membership', async () => {
    const p = await payloadOfARealNotification();
    const them = await outsider();

    await expect(
      g.conversations.syncStudentGroup(p.learnerId, them.parentId),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('the refusal is NOT-FOUND, so a learner id cannot be probed', async () => {
    const them = await outsider();

    // A real learner they may not see, and an id that never existed, give the
    // same answer.
    const real = g.conversations.ensureStudentGroup(s.learnerId, them.parentId);
    await expect(real).rejects.toMatchObject({ status: 404 });
    await expect(
      g.conversations.ensureStudentGroup(randomUUID(), them.parentId),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('their OWN child still works, for them and for staff', async () => {
    const them = await outsider();
    // Created by staff, which is who creates student groups: `added_by` is a
    // foreign key to chat.staff, so a contact was never able to bring one into
    // existence. What a parent does is OPEN theirs, which is the path below.
    const created = await g.conversations.ensureStudentGroup(them.learnerId, s.ownerId);

    // The guard must not cost a parent their own child's group.
    const theirs = await g.conversations.ensureStudentGroup(them.learnerId, them.parentId);
    expect(theirs.id).toBe(created.id);
    expect(theirs.learnerId).toBe(them.learnerId);

    // Staff reconcile across the academy; that is the job.
    expect(
      await g.conversations.syncStudentGroup(them.learnerId, s.ownerId),
    ).not.toBeNull();

    // And the learner's own teacher.
    expect(
      await g.conversations.syncStudentGroup(them.learnerId, s.teacherId),
    ).not.toBeNull();
  });

  it('a teacher who is not this learner’s teacher is refused', async () => {
    const them = await outsider();

    await expect(
      g.conversations.ensureStudentGroup(them.learnerId, s.newTeacherId),
    ).rejects.toMatchObject({ status: 404 });
  });
});

// =========================================================================
describe('announcementId', () => {
  it('does not open an announcement they were not sent', async () => {
    const a = await g.announcements.create(admin(), {
      titleAr: 'خبر', bodyAr: 'نص',
      targetType: 'contacts',
      targetIds: [s.parentId],
    });
    await g.announcements.publish(admin(), a.id);
    await g.announcements.fanOut(a.id);
    const them = await outsider();

    // Authorized by a notification addressed to them, never by the
    // announcement's own targeting -- which would also leak who else was
    // written to.
    await expect(
      g.announcements.readForActor(them.parentId, a.id),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('being IN the audience is what grants it, not holding the id', async () => {
    const them = await outsider();
    const a = await g.announcements.create(admin(), {
      titleAr: 'خبر', bodyAr: 'نص',
      targetType: 'contacts',
      targetIds: [s.parentId, them.parentId],
    });
    await g.announcements.publish(admin(), a.id);
    await g.announcements.fanOut(a.id);

    // Same id, different entitlement. This is the control that proves the tests
    // above are refusing for the right reason.
    expect(await g.announcements.readForActor(them.parentId, a.id)).toBeDefined();
  });
});

// =========================================================================
describe('the whole payload at once', () => {
  it('every id together is still worth nothing', async () => {
    const p = await payloadOfARealNotification();
    const them = await outsider();

    // The complete push payload, in the hands of a signed-in parent of another
    // family. Nothing in it composes into access.
    const attempts = [
      g.centre.byId(them.parentId, p.notificationId),
      g.messages.list({ conversationId: p.conversationId, actorId: them.parentId }),
      g.messages.react(p.messageId, them.parentId, '👍'),
      g.conversations.ensureStudentGroup(p.learnerId, them.parentId),
      g.conversations.setPreferences(p.conversationId, them.parentId, { pinned: true }),
    ];

    const results = await Promise.allSettled(attempts);
    expect(results.every((r) => r.status === 'rejected')).toBe(true);

    // And the family's data is untouched by any of it.
    const n = (await g.prisma.notification.findUnique({ where: { id: p.notificationId } }))!;
    expect(n.readAt).toBeNull();
    expect((await g.centre.unreadCounts(s.parentId)).total).toBe(1);
  });

  it('the rightful recipient can do all of it', async () => {
    const p = await payloadOfARealNotification();

    // The control. Every refusal above is about entitlement, not about the
    // endpoints being broken.
    expect((await g.centre.byId(s.parentId, p.notificationId)).id).toBe(p.notificationId);
    expect(
      (await g.messages.list({ conversationId: p.conversationId, actorId: s.parentId }))
        .messages.map((m) => m.id),
    ).toContain(p.messageId);
    expect(
      (await g.conversations.ensureStudentGroup(p.learnerId, s.parentId)).id,
    ).toBe(p.conversationId);
    expect(await g.centre.markRead(s.parentId, p.notificationId)).toBe(true);
  });

  it('the push payload itself still carries no readable content', async () => {
    const p = await payloadOfARealNotification();
    await g.notifications.registerDevice({
      actorId: s.parentId, token: 'authz-device', platform: 'android',
    });

    const sent: Record<string, string>[] = [];
    const spy = jest.spyOn(g.push, 'send').mockImplementation(async (m) => {
      sent.push(m.data);
      return { ok: true };
    });
    await g.notifications.dispatchDue(new Date());
    spy.mockRestore();

    const data = sent[0];
    // The reason the ids above have to be worthless: this is what leaves the
    // building. Ids, an enum or two, and a route.
    expect(data.notificationId).toBe(p.notificationId);
    expect(Object.values(data).join(' ')).not.toContain('private to this family');
    expect(Object.keys(data).sort()).toEqual(
      ['category', 'conversationId', 'deeplink', 'entityId', 'entityType', 'learnerId',
        'notificationId', 'priority', 'type'].sort(),
    );
    expect(data.type).toBe(NotificationType.MESSAGE_RECEIVED);
  });
});
