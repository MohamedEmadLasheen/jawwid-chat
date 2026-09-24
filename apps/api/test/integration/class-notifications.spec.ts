/**
 * WHAT THE CLASS PROJECTION TELLS A PARENT.
 *
 * Three things, and the boundaries between them are the point:
 *
 *   a missed class     notifies, once, through the existing engine
 *   an attended class  notifies nobody, deliberately
 *   a class occurrence produces reminders keyed on the occurrence, which a
 *                      cancellation withdraws and a move replaces
 *
 * Plus the reliability half: the legacy `next_class_at` write now commits its
 * event with the fact, and a stale replay of that event cannot resurrect
 * reminders for a class time that has moved on.
 *
 * Nothing here adds a delivery path. Every notification below is
 * `NotificationService.schedule()`, the same call the messages, calls and
 * announcements produce, reached from the same outbox worker.
 *
 * Requires the migrated database (DATABASE_URL).
 */
import { randomUUID } from 'node:crypto';
import { buildGraph, seed, truncate, Scenario } from './harness';
import { NotificationType } from '@communication/contracts/notifications';
import { CommEvent } from '@communication/contracts/events';
import { NotificationStatus } from '@communication/contracts/vocab';

const g = buildGraph();
let s: Scenario;
let coreChildId: string;

const drainOutbox = () => g.outboxWorker.drain(200);

const admin = () => ({
  actorId: s.ownerId,
  kind: 'staff' as const,
  displayName: 'admin_a',
  locale: 'ar' as const,
  isActive: true,
  staffRole: 'admin' as const,
});

async function coreEvent(
  eventType: string,
  // The envelope's SOURCE time. Ordering is by this, never by the moment the
  // delivery arrived -- so the tests name it for what it is.
  payload: Record<string, unknown>,
  occurredAt = new Date(),
): Promise<void> {
  await g.prisma.$executeRaw`
    insert into chat.core_event (source, external_event_id, event_type, payload,
                                occurred_at, received_at)
    values ('jawwid_core', ${randomUUID()}, ${eventType}, ${JSON.stringify(payload)}::jsonb,
            ${occurredAt}::timestamptz, now())`;
}

/** A mirrored, upcoming occurrence. Returns both ids. */
async function occurrence(
  startsAt = new Date(Date.now() + 48 * 3600_000),
): Promise<{ coreId: string; id: string }> {
  const coreId = randomUUID();
  await coreEvent(
    'class_session.upserted',
    {
      core_class_session_id: coreId,
      core_child_id: coreChildId,
      starts_at: startsAt.toISOString(),
      status: 'scheduled',
    },
    new Date(Date.now() - 60_000),
  );
  await g.coreIngest.drain();
  const row = (await g.prisma.classSession.findUnique({
    where: { coreClassSessionId: coreId },
  }))!;
  return { coreId, id: row.id };
}

async function notificationsOfType(type: string) {
  return g.prisma.notification.findMany({ where: { recipientId: s.parentId, type } });
}

async function scheduledReminders(classSessionId?: string) {
  return g.prisma.notification.findMany({
    where: {
      recipientId: s.parentId,
      eventType: 'class_scheduled',
      status: NotificationStatus.SCHEDULED,
      ...(classSessionId ? { dedupeKey: { contains: `:session:${classSessionId}:` } } : {}),
    },
  });
}

beforeEach(async () => {
  await truncate(g.prisma);
  s = await seed(g.prisma);
  g.coverage.onDutyId = s.ownerId;
  coreChildId = randomUUID();
  await g.prisma.$executeRaw`
    update chat.learner set core_child_id = ${coreChildId}::uuid where id = ${s.learnerId}::uuid`;
});

afterAll(async () => {
  await truncate(g.prisma);
  await g.prisma.$disconnect();
});

// =========================================================================
describe('a missed class', () => {
  async function missed(): Promise<{ coreId: string; id: string }> {
    const session = await occurrence();
    await drainOutbox();
    await coreEvent('attendance.upserted', {
      core_class_session_id: session.coreId,
      outcome: 'class_missed',
    });
    await g.coreIngest.drain();
    await drainOutbox();
    return session;
  }

  it('reaches the parent, names the child, and says which class', async () => {
    await missed();

    const rows = await notificationsOfType(NotificationType.CLASS_MISSED);
    expect(rows).toHaveLength(1);
    expect(rows[0].learnerId).toBe(s.learnerId);
    expect(rows[0].category).toBe('classes');
    // The child and the class time are IN the frozen text: a parent of three
    // reading a lock screen must not have to open the app to find out which.
    expect(rows[0].title).toContain('learner_l');
    expect(rows[0].body).toBeTruthy();
    expect(rows[0].deeplink).toBe(`/learners/${s.learnerId}/classes`);
  });

  it('goes to BOTH parents of the family, through the existing resolver', async () => {
    await missed();

    // RecipientResolver.forLearner is the only parent lookup in this product,
    // and this uses it rather than a second one that could drift.
    const all = await g.prisma.notification.findMany({
      where: { type: NotificationType.CLASS_MISSED },
    });
    expect(new Set(all.map((n) => n.recipientId))).toEqual(
      new Set([s.parentId, s.otherParentId]),
    );
  });

  it('is one notification however many times the event is delivered', async () => {
    const session = await missed();

    // A redelivered Core event, a retried outbox row, a second worker.
    await coreEvent('attendance.upserted', {
      core_class_session_id: session.coreId,
      outcome: 'class_missed',
    });
    await g.coreIngest.drain();
    await drainOutbox();
    await drainOutbox();

    expect(await notificationsOfType(NotificationType.CLASS_MISSED)).toHaveLength(1);
  });

  it('is muteable, and the mute is honoured', async () => {
    await g.notifications.registerDevice({
      actorId: s.parentId, token: 'missed-device', platform: 'android',
    });
    await g.preferences.set(s.parentId, 'classes', false);
    await missed();
    await g.notifications.dispatchDue(new Date());

    const n = (await notificationsOfType(NotificationType.CLASS_MISSED))[0];
    const push = (await g.deliveries.trace(n.id)).find((d) => d.channel === 'push');
    // A missed class has already happened -- nothing the parent does in the
    // next ten minutes changes it -- so it is not essential, and a parent who
    // muted Classes is not buzzed. They still have it in the centre.
    expect(push!.skipReason).toBe('PREFERENCE_OFF');
    expect((await g.centre.unreadCounts(s.parentId)).total).toBeGreaterThan(0);
  });
});

// =========================================================================
describe('an attended class', () => {
  it('is projected and notifies NOBODY', async () => {
    const session = await occurrence();
    await drainOutbox();
    await coreEvent('attendance.upserted', {
      core_class_session_id: session.coreId,
      outcome: 'class_attended',
    });
    await g.coreIngest.drain();
    await drainOutbox();

    // The fact is recorded...
    expect(await g.prisma.classAttendance.count()).toBe(1);
    // ...and nobody is told. "Your child attended their class" is the normal
    // case, and a platform that announces the normal case teaches parents to
    // swipe everything away, including the one that matters.
    expect(
      await g.prisma.notification.count({ where: { type: NotificationType.CLASS_MISSED } }),
    ).toBe(0);
  });

  it('a correction from missed to attended does not un-tell the parent', async () => {
    const session = await occurrence();
    await drainOutbox();
    await coreEvent(
      'attendance.upserted',
      { core_class_session_id: session.coreId, outcome: 'class_missed' },
      new Date(Date.now() - 60_000),
    );
    await g.coreIngest.drain();
    await drainOutbox();
    expect(await notificationsOfType(NotificationType.CLASS_MISSED)).toHaveLength(1);

    await coreEvent('attendance.upserted', {
      core_class_session_id: session.coreId,
      outcome: 'class_attended',
    });
    await g.coreIngest.drain();
    await drainOutbox();

    // The projection is corrected; the notification stays. A parent who was
    // told is a parent who was told, and silently deleting it would make the
    // centre unreliable as a record -- the same rule a cancelled announcement
    // follows.
    expect((await g.prisma.classAttendance.findFirst())!.outcome).toBe('class_attended');
    expect(await notificationsOfType(NotificationType.CLASS_MISSED)).toHaveLength(1);
  });
});

// =========================================================================
describe('reminders against the occurrence', () => {
  it('a new session schedules them, keyed on the session', async () => {
    const session = await occurrence();
    await drainOutbox();

    const reminders = await scheduledReminders(session.id);
    expect(reminders.length).toBeGreaterThan(0);
    for (const r of reminders) {
      expect(r.type).toBe(NotificationType.CLASS_REMINDER);
      // The occurrence is in the key, which is what makes per-session
      // cancellation possible at all.
      expect(r.dedupeKey).toContain(`:session:${session.id}:`);
    }
  });

  it('two sessions for one learner keep two sets', async () => {
    const first = await occurrence(new Date(Date.now() + 48 * 3600_000));
    const second = await occurrence(new Date(Date.now() + 96 * 3600_000));
    await drainOutbox();

    // The learner-and-time key the legacy path uses could not express this.
    expect((await scheduledReminders(first.id)).length).toBeGreaterThan(0);
    expect((await scheduledReminders(second.id)).length).toBeGreaterThan(0);
  });

  it('a cancellation withdraws that session’s reminders and no other’s', async () => {
    const keep = await occurrence(new Date(Date.now() + 96 * 3600_000));
    const drop = await occurrence(new Date(Date.now() + 48 * 3600_000));
    await drainOutbox();
    expect((await scheduledReminders(drop.id)).length).toBeGreaterThan(0);

    await coreEvent('class_session.cancelled', { core_class_session_id: drop.coreId });
    await g.coreIngest.drain();
    await drainOutbox();

    expect(await scheduledReminders(drop.id)).toHaveLength(0);
    expect((await scheduledReminders(keep.id)).length).toBeGreaterThan(0);
  });

  it('a move replaces them rather than adding to them', async () => {
    const session = await occurrence(new Date(Date.now() + 48 * 3600_000));
    await drainOutbox();
    const before = await scheduledReminders(session.id);
    // Non-vacuous: if the first set were empty, everything below would pass
    // while proving nothing.
    expect(before.length).toBeGreaterThan(0);

    const moved = new Date(Date.now() + 96 * 3600_000);
    await coreEvent('class_session.upserted', {
      core_class_session_id: session.coreId,
      core_child_id: coreChildId,
      starts_at: moved.toISOString(),
      status: 'rescheduled',
    });
    await g.coreIngest.drain();
    await drainOutbox();

    const after = await scheduledReminders(session.id);
    expect(after).toHaveLength(before.length);
    // Same count, new times: the old ones were cancelled, not left to fire.
    for (const r of after) {
      expect(r.scheduledAt.getTime()).toBeGreaterThan(Date.now() + 48 * 3600_000);
    }
    // Asserted on identity rather than on a count: every reminder that was live
    // for the old time is now cancelled, and none of the live ones is one of
    // them. A count would pass whatever the handler happened to run twice.
    const cancelled = await g.prisma.notification.findMany({
      where: {
        // Scoped to one parent, because `before` is: the family has two, and
        // every reminder exists once per parent.
        recipientId: s.parentId,
        eventType: 'class_scheduled',
        status: NotificationStatus.CANCELLED,
        dedupeKey: { contains: `:session:${session.id}:` },
      },
    });
    expect(cancelled.map((n) => n.id).sort()).toEqual(before.map((n) => n.id).sort());
  });

  it('a cancelled session never gets reminders, whatever arrives later', async () => {
    const session = await occurrence();
    await drainOutbox();
    expect((await scheduledReminders(session.id)).length).toBeGreaterThan(0);
    await coreEvent('class_session.cancelled', { core_class_session_id: session.coreId });
    await g.coreIngest.drain();
    await drainOutbox();

    // A stale SCHEDULED event for the same session, drained after the
    // cancellation. The handler re-reads the session and does nothing.
    await g.prisma.outboxEvent.create({
      data: {
        type: CommEvent.CLASS_SESSION_SCHEDULED,
        payload: {
          classSessionId: session.id,
          learnerId: s.learnerId,
          startsAt: new Date(Date.now() + 48 * 3600_000).toISOString(),
          status: 'scheduled',
          previousStartsAt: null,
          previousStatus: null,
        },
      },
    });
    await drainOutbox();

    expect(await scheduledReminders(session.id)).toHaveLength(0);
  });

  it('a session already in the past schedules nothing', async () => {
    const session = await occurrence(new Date(Date.now() - 3600_000));
    await drainOutbox();

    // "Your class starts in 30 minutes" delivered afterwards is worse than
    // silence.
    expect(await scheduledReminders(session.id)).toHaveLength(0);
  });
});

// =========================================================================
describe('the legacy schedule path is no longer lossy', () => {
  beforeEach(async () => {
    await g.prisma.learner.update({
      where: { id: s.learnerId },
      data: { nextClassAt: new Date('2026-09-29T14:00:00Z') },
    });
  });

  it('commits the outbox event with the schedule change', async () => {
    await g.classSchedule.reschedule(admin(), {
      learnerId: s.learnerId,
      nextClassAt: new Date('2026-09-29T15:00:00Z'),
      reason: 'availability',
    });

    const events = await g.prisma.outboxEvent.findMany({
      where: { type: CommEvent.LEARNER_SCHEDULE_CHANGED },
    });
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({
      learnerId: s.learnerId,
      previousAt: '2026-09-29T14:00:00.000Z',
      nextAt: '2026-09-29T15:00:00.000Z',
    });
  });

  it('a failed transaction leaves neither the change nor the event', async () => {
    const spy = jest
      .spyOn(g.audit, 'audit')
      .mockRejectedValue(new Error('audit storage gone'));

    await expect(
      g.classSchedule.reschedule(admin(), {
        learnerId: s.learnerId,
        nextClassAt: new Date('2026-09-29T15:00:00Z'),
        reason: 'availability',
      }),
    ).rejects.toThrow();
    spy.mockRestore();

    // No orphan event promising a notification about a change that never
    // happened, and the learner is untouched.
    expect(await g.prisma.outboxEvent.count()).toBe(0);
    expect(
      (await g.prisma.learner.findUnique({ where: { id: s.learnerId } }))!.nextClassAt,
    ).toEqual(new Date('2026-09-29T14:00:00Z'));
  });

  it('the recovery path delivers what a crash swallowed', async () => {
    // The fast path fails after the commit -- the exact crash window this
    // closes. The transaction already holds the change and the event.
    const spy = jest
      .spyOn(g.notifications, 'schedule')
      .mockRejectedValue(new Error('process died'));

    await expect(
      g.classSchedule.reschedule(admin(), {
        learnerId: s.learnerId,
        nextClassAt: new Date('2026-09-29T15:00:00Z'),
        reason: 'availability',
      }),
    ).rejects.toThrow();
    spy.mockRestore();

    expect(
      await g.prisma.notification.count({
        where: { type: NotificationType.CLASS_SCHEDULE_CHANGED },
      }),
    ).toBe(0);

    // The worker picks up the event that committed with the change.
    await drainOutbox();

    const told = await g.prisma.notification.findMany({
      where: { type: NotificationType.CLASS_SCHEDULE_CHANGED },
    });
    expect(told.length).toBeGreaterThan(0);
    expect(told.map((n) => n.recipientId)).toContain(s.parentId);
  });

  it('the recovery path creates nothing when the fast path already ran', async () => {
    await g.classSchedule.reschedule(admin(), {
      learnerId: s.learnerId,
      nextClassAt: new Date('2026-09-29T15:00:00Z'),
      reason: 'availability',
    });
    const before = await g.prisma.notification.count({
      where: { type: NotificationType.CLASS_SCHEDULE_CHANGED },
    });

    await drainOutbox();
    await drainOutbox();

    // Both paths converge on the same dedupe key, so the second one is a no-op.
    expect(
      await g.prisma.notification.count({
        where: { type: NotificationType.CLASS_SCHEDULE_CHANGED },
      }),
    ).toBe(before);
  });

  it('A STALE EVENT CANNOT RESURRECT OLD REMINDERS', async () => {
    // Change #1, with its event left undrained.
    await g.classSchedule.reschedule(admin(), {
      learnerId: s.learnerId,
      nextClassAt: new Date(Date.now() + 48 * 3600_000),
      reason: 'first move',
    });
    // Change #2 supersedes it and cancels #1's reminders.
    const finalTime = new Date(Date.now() + 96 * 3600_000);
    await g.classSchedule.reschedule(admin(), {
      learnerId: s.learnerId,
      nextClassAt: finalTime,
      reason: 'second move',
    });

    const liveBefore = await g.prisma.notification.findMany({
      where: { eventType: 'class_scheduled', status: NotificationStatus.SCHEDULED },
    });

    // Now #1's event finally drains. Without the guard it would re-notify and
    // recreate reminders for a class time that no longer exists -- a parent
    // told to be somewhere at the old time.
    await drainOutbox();

    const liveAfter = await g.prisma.notification.findMany({
      where: { eventType: 'class_scheduled', status: NotificationStatus.SCHEDULED },
    });
    expect(liveAfter.map((n) => n.id).sort()).toEqual(liveBefore.map((n) => n.id).sort());
    // Every live reminder belongs to the CURRENT time, not the superseded one.
    for (const r of liveAfter) {
      expect(r.dedupeKey).toContain(finalTime.toISOString());
    }
  });

  it('the current state wins: a hand-made stale event is a no-op', async () => {
    await g.prisma.outboxEvent.create({
      data: {
        type: CommEvent.LEARNER_SCHEDULE_CHANGED,
        payload: {
          learnerId: s.learnerId,
          previousAt: null,
          nextAt: new Date('2020-01-01T00:00:00Z').toISOString(),
          actorId: s.ownerId,
          reason: 'ancient history',
        },
      },
    });

    await drainOutbox();

    // The learner's next_class_at is not what this event said it became, so the
    // event is history and does nothing. No comparison of timestamps, no sleep:
    // a comparison against the authoritative current value.
    expect(await g.prisma.notification.count({ where: { recipientId: s.parentId } })).toBe(0);
  });
});
