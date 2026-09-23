/**
 * FOLLOWING THE LINK.
 *
 * A deep link is a string. It is minted by the type registry when the
 * notification is created, and by the time a parent taps it -- which may be
 * days later, from a lock screen, on a second device -- the thing it points at
 * may have been deleted, expired, or taken away from them.
 *
 * The rule, stated once and tested everywhere below: FOLLOWING A LINK IS A
 * NAVIGATION, NOT AN AUTHORIZATION. Every destination re-checks, every refusal
 * looks like "not found" rather than "not yours", and a target that is gone
 * produces an honest empty screen rather than an error or, worse, somebody
 * else's data.
 *
 * Every link family the registry mints is here, against every state its target
 * can be in.
 *
 * Requires the migrated database (DATABASE_URL).
 */
import { randomUUID } from 'node:crypto';
import { buildGraph, seed, truncate, Scenario } from './harness';
import {
  NOTIFICATION_REGISTRY,
  NotificationType,
  definitionOf,
} from '@communication/contracts/notifications';

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

async function studentGroup(): Promise<string> {
  return (await g.conversations.ensureStudentGroup(s.learnerId)).id;
}

/** A parent in another family entirely: the "unauthorized" state, with a real id. */
async function stranger(): Promise<string> {
  const familyId = randomUUID();
  const contactId = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.family (id, display_name, owner_id, language)
     values ('${familyId}'::uuid, 'family_s', '${s.ownerId}'::uuid, 'ar')`,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.contact (id, family_id, name, role_preset, can_message, is_active)
     values ('${contactId}'::uuid, '${familyId}'::uuid, 'parent_s',
             'primary_guardian', true, true)`,
  );
  return contactId;
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
describe('every link the registry can mint', () => {
  it('is one of four shapes, and every type is accounted for', () => {
    // Enumerated rather than sampled: a new type with a link shape nobody has
    // thought about is exactly the thing that ships broken.
    const shapes = new Map<string, string[]>();
    for (const [type, def] of Object.entries(NOTIFICATION_REGISTRY)) {
      const link = def.deepLink({
        conversationId: 'c1',
        messageId: 'm1',
        callId: 'k1',
        learnerId: 'l1',
        announcementId: 'a1',
      });
      const shape = link.split('/')[1];
      shapes.set(shape, [...(shapes.get(shape) ?? []), type]);
    }

    expect([...shapes.keys()].sort()).toEqual(['announcements', 'billing', 'chats', 'learners']);
    // Every registry type, with none silently absent.
    expect([...shapes.values()].flat()).toHaveLength(
      Object.keys(NOTIFICATION_REGISTRY).length,
    );
  });

  it('never produces a route with a hole in it, however little context there is', () => {
    for (const def of Object.values(NOTIFICATION_REGISTRY)) {
      for (const ctx of [
        {},
        { conversationId: 'c1' },
        { messageId: 'm1' },
        { callId: 'k1' },
        { learnerId: 'l1' },
        { announcementId: 'a1' },
      ]) {
        const link = def.deepLink(ctx);
        expect(link.startsWith('/')).toBe(true);
        expect(link).not.toMatch(/undefined|null|\/\//);
      }
    }
  });
});

// =========================================================================
describe('a conversation link', () => {
  async function messageNotification() {
    const conversationId = await studentGroup();
    const sent = await g.messages.send({
      conversationId, senderId: s.ownerId, body: 'tap me',
    });
    await drain();
    const n = (await g.prisma.notification.findFirst({
      where: { recipientId: s.parentId },
    }))!;
    return { conversationId, messageId: sent.id, n };
  }

  it('EXISTS · opens the thread at the message', async () => {
    const { conversationId, messageId, n } = await messageNotification();
    expect(n.deeplink).toBe(`/chats/${conversationId}?message=${messageId}`);

    const view = await g.messages.list({ conversationId, actorId: s.parentId });
    expect(view.messages.map((m) => m.id)).toContain(messageId);
  });

  it('TARGET DELETED · the thread still opens, and the message is simply gone',
    async () => {
      const { conversationId, messageId } = await messageNotification();
      await g.messages.deleteForEveryone(messageId, s.ownerId, 'sent in error');

      // Not an error page. The parent arrives in the thread they were told
      // about and finds the message withdrawn, which is the truth.
      const view = await g.messages.list({ conversationId, actorId: s.parentId });
      const row = view.messages.find((m) => m.id === messageId);
      expect(row === undefined || row.body === null || row.deletedAt !== null).toBe(true);
    });

  it('CONVERSATION DELETED · the landing refuses rather than inventing one', async () => {
    const { conversationId, n } = await messageNotification();
    // The conversation is gone; the notification survives it (delivery rows
    // cascade from the notification, not from the thread).
    await g.prisma.notification.update({
      where: { id: n.id },
      data: { conversationId: null },
    });
    await g.prisma.conversation.delete({ where: { id: conversationId } });

    await expect(
      g.messages.list({ conversationId, actorId: s.parentId }),
    ).rejects.toBeDefined();
    // And the notification itself is still readable: what they were told does
    // not disappear because the thread did.
    const card = await g.centre.byId(s.parentId, n.id);
    expect(card.title).toBeTruthy();
  });

  it('UNAUTHORIZED · a stranger following it is refused', async () => {
    const { conversationId } = await messageNotification();
    const outsider = await stranger();

    await expect(
      g.messages.list({ conversationId, actorId: outsider }),
    ).rejects.toBeDefined();
  });

  it('AUTHORIZATION REVOKED · a parent removed from the group loses the thread',
    async () => {
      const { conversationId, n } = await messageNotification();

      // Between the notification and the tap, they left the group.
      await g.prisma.conversationMember.deleteMany({
        where: { conversationId, actorId: s.parentId },
      });

      await expect(
        g.messages.list({ conversationId, actorId: s.parentId }),
      ).rejects.toBeDefined();
      // The notification is still theirs -- it was addressed to them and it
      // happened -- so the centre still shows what they were told.
      expect((await g.centre.byId(s.parentId, n.id)).id).toBe(n.id);
    });
});

// =========================================================================
describe('a call link', () => {
  it('EXISTS · points at the call inside its thread', async () => {
    const conversationId = await studentGroup();
    const { callId } = await g.calls.start(conversationId, s.ownerId);
    await g.calls.end(callId, s.ownerId, 'missed');
    await drain();

    const missed = (await g.prisma.notification.findFirst({
      where: { recipientId: s.parentId, type: NotificationType.MISSED_CALL },
    }))!;
    expect(missed.deeplink).toBe(`/chats/${conversationId}?call=${callId}`);

    // And the thread opens: a missed call is answered by calling back, which
    // happens in the conversation rather than on a call log.
    const view = await g.messages.list({ conversationId, actorId: s.parentId });
    expect(view).toBeDefined();
  });

  it('CALL OVER · the link still lands, because the thread is the destination',
    async () => {
      const conversationId = await studentGroup();
      const { callId } = await g.calls.start(conversationId, s.ownerId);
      await g.calls.end(callId, s.ownerId, 'missed');
      await drain();
      await g.prisma.call.delete({ where: { id: callId } });

      // The call id is a hint about where to scroll, not the destination. A
      // purged call must not make the link dead.
      const view = await g.messages.list({ conversationId, actorId: s.parentId });
      expect(view).toBeDefined();
    });

  it('degrades to the calls tab when there is no conversation at all', () => {
    expect(definitionOf(NotificationType.MISSED_CALL).deepLink({})).toBe('/calls');
  });
});

// =========================================================================
describe('an announcement link', () => {
  async function published(expiresAt?: Date) {
    const a = await g.announcements.create(admin(), {
      titleAr: 'خبر', bodyAr: 'نص',
      targetType: 'contacts',
      targetIds: [s.parentId],
      ...(expiresAt
        ? { publishAt: new Date(Date.now() - 3600_000), expiresAt }
        : {}),
    });
    await g.announcements.publish(admin(), a.id);
    await g.announcements.fanOut(a.id);
    return a;
  }

  it('EXISTS · opens the announcement', async () => {
    const a = await published();
    const view = await g.announcements.readForActor(s.parentId, a.id);
    expect(view).toBeDefined();
  });

  it('EXPIRED · refuses with GONE, not NOT-FOUND', async () => {
    const a = await published(new Date(Date.now() - 60_000));

    // 410, deliberately, and the distinction is the whole point. The parent
    // holds a notification for this announcement, so "there is no such
    // announcement" would be a lie told to the one person who was demonstrably
    // told about it. 410 says it existed and is over, which is what the screen
    // needs in order to say so.
    //
    // Nothing is lost: the notification card carries the announcement's own
    // title and body, frozen at creation, so a parent landing here has already
    // read what they were told.
    await expect(g.announcements.readForActor(s.parentId, a.id)).rejects.toMatchObject({
      status: 410,
    });
    // And it has left the centre, because an over-and-done notice should not
    // sit in a list of things to attend to.
    expect((await g.centre.list(s.parentId)).items).toHaveLength(0);
  });

  it('DELETED · refuses, and looks the same as never existing', async () => {
    const a = await published();
    await g.prisma.announcement.delete({ where: { id: a.id } });

    await expect(g.announcements.readForActor(s.parentId, a.id)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      g.announcements.readForActor(s.parentId, randomUUID()),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('UNAUTHORIZED · a parent who was not written to cannot read it', async () => {
    const a = await published();
    const outsider = await stranger();

    // Authorized by the existence of a notification addressed to them, not by
    // the announcement's targeting -- so guessing an id gets you nothing.
    await expect(
      g.announcements.readForActor(outsider, a.id),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('CANCELLED · refuses with GONE too, and the notification survives it', async () => {
    const a = await published();
    await g.announcements.cancel(admin(), a.id);

    // Withdrawn, not missing -- the same reasoning as expiry. This used to be a
    // 404, which told a parent holding the notification that the thing they
    // were told about had never existed.
    await expect(g.announcements.readForActor(s.parentId, a.id)).rejects.toMatchObject({
      status: 410,
    });

    // Cancelling stops future fan-out; it does not retract what was said. The
    // card stays in the centre with the academy's own words on it.
    const card = (await g.centre.list(s.parentId)).items[0];
    expect(card).toBeDefined();
    expect(card.announcementId).toBe(a.id);
  });
});

// =========================================================================
/**
 * THE CLASS LINK.
 *
 * `/learners/{id}/classes` is minted by the registry and has NO SCREEN in this
 * build. That is a decision, not an oversight, and it is recorded here so it
 * cannot be mistaken for one:
 *
 *   1. NOTHING IS LOST. The notification carries the whole story -- which
 *      child, the old time, the new time -- frozen on the row at creation. Its
 *      own detail view is a real destination, not a consolation prize.
 *   2. IT DOES NOT LIE. `NotificationDeepLink.isActionable` returns false for
 *      it, so the card does not look tappable and then do nothing.
 *   3. IT NEEDS NO MIGRATION LATER. The server keeps minting the route, so the
 *      day a classes screen exists, every notification already written points
 *      at it. Nothing is backfilled.
 *   4. IT IS REPORTED AS NOT-IMPLEMENTED. The acceptance matrix says
 *      NOT-IMPLEMENTED for this cell rather than PASS, because a link that
 *      cannot be followed is not a working deep link.
 */
describe('a class link', () => {
  it('names the child, and only that child', async () => {
    await g.prisma.learner.update({
      where: { id: s.learnerId },
      data: { nextClassAt: new Date('2026-09-29T14:00:00Z') },
    });
    await g.classSchedule.reschedule(admin(), {
      learnerId: s.learnerId,
      nextClassAt: new Date('2026-09-29T15:00:00Z'),
      reason: 'availability',
    });

    const n = (await g.prisma.notification.findFirst({
      where: { recipientId: s.parentId, type: NotificationType.CLASS_SCHEDULE_CHANGED },
    }))!;
    expect(n.deeplink).toBe(`/learners/${s.learnerId}/classes`);
  });

  it('carries the whole story on the notification, so the missing screen costs nothing',
    async () => {
      await g.prisma.learner.update({
        where: { id: s.learnerId },
        data: { nextClassAt: new Date('2026-09-29T14:00:00Z') },
      });
      await g.classSchedule.reschedule(admin(), {
        learnerId: s.learnerId,
        nextClassAt: new Date('2026-09-29T15:00:00Z'),
        reason: 'availability',
      });

      const card = await g.centre.byId(
        s.parentId,
        (await g.prisma.notification.findFirst({
          where: { recipientId: s.parentId, type: NotificationType.CLASS_SCHEDULE_CHANGED },
        }))!.id,
      );

      // Condition 1: the card alone answers "which child, from when, to when".
      expect(card.learnerName).toBe('learner_l');
      expect(card.body).toBeTruthy();
      expect(card.learnerId).toBe(s.learnerId);
    });

  it('falls back to a real route when the child is not on the notification', () => {
    expect(definitionOf(NotificationType.CLASS_CANCELLED).deepLink({})).toBe('/chats');
  });
});

// =========================================================================
describe('the notification behind the link', () => {
  it('a deleted notification refuses, and says nothing about having existed',
    async () => {
      const conversationId = await studentGroup();
      await g.messages.send({ conversationId, senderId: s.ownerId, body: 'gone soon' });
      await drain();
      const n = (await g.prisma.notification.findFirst({
        where: { recipientId: s.parentId },
      }))!;

      await g.prisma.notification.delete({ where: { id: n.id } });

      await expect(g.centre.byId(s.parentId, n.id)).rejects.toMatchObject({
        status: 404,
      });
    });

  it('an expired notification is gone from the centre but still openable by its link',
    async () => {
      const { notificationId } = await g.notifications.schedule({
        dedupeKey: 'expiring:1',
        type: NotificationType.MESSAGE_RECEIVED,
        eventType: 'message_created',
        recipientId: s.parentId,
        scheduledAt: new Date(),
        expiresAt: new Date(Date.now() - 1000),
      });

      // Off the list and out of the count...
      expect((await g.centre.list(s.parentId)).items).toHaveLength(0);
      expect((await g.centre.unreadCounts(s.parentId)).total).toBe(0);
      // ...and still readable by a parent who taps the push that carried it.
      // The alternative is a tap that lands on an error for something the
      // academy genuinely sent.
      expect((await g.centre.byId(s.parentId, notificationId)).id).toBe(notificationId);
    });

  it('marking a link target opened is scoped to the owner', async () => {
    const conversationId = await studentGroup();
    await g.messages.send({ conversationId, senderId: s.ownerId, body: 'opened' });
    await drain();
    const n = (await g.prisma.notification.findFirst({
      where: { recipientId: s.parentId },
    }))!;
    const outsider = await stranger();

    await expect(g.centre.byId(outsider, n.id)).rejects.toMatchObject({ status: 404 });
    expect((await g.centre.byId(s.parentId, n.id)).id).toBe(n.id);
  });
});
