/**
 * A PARENT OF THREE.
 *
 * The single-child case hides every interesting bug. A parent with Ahmed, Omar
 * and Sara gets notifications about all three in one list, on one badge, from
 * one bell -- and "your child's class was moved" is worthless to them. Every
 * notification has to name WHICH child, carry that child's id, and link to that
 * child's context and no other.
 *
 * The authorization question is the other half. A deep link is a string; it
 * proves nothing. These tests make a second family with its own parent and its
 * own children, and check that no link, id or notification crosses between
 * them.
 *
 * Requires the migrated database (DATABASE_URL).
 */
import { randomUUID } from 'node:crypto';
import { buildGraph, seed, truncate, Scenario } from './harness';
import { NotificationType } from '@communication/contracts/notifications';
import { MessageType } from '@communication/contracts/vocab';

const g = buildGraph();
let s: Scenario;

/** Ahmed, Omar and Sara -- three children of the seeded family. */
interface Children {
  ahmed: string;
  omar: string;
  sara: string;
}

/** A second family entirely: their own parent, their own child, their own group. */
interface OtherFamily {
  familyId: string;
  parentId: string;
  learnerId: string;
}

async function addChildren(): Promise<Children> {
  const ids = { ahmed: randomUUID(), omar: randomUUID(), sara: randomUUID() };
  for (const [name, id] of [['Ahmed', ids.ahmed], ['Omar', ids.omar], ['Sara', ids.sara]]) {
    await g.prisma.$executeRawUnsafe(
      `insert into chat.learner (id, family_id, name, teacher_id)
       values ('${id}'::uuid, '${s.familyId}'::uuid, '${name}', '${s.teacherId}'::uuid)`,
    );
  }
  return ids;
}

async function otherFamily(): Promise<OtherFamily> {
  const ids = {
    familyId: randomUUID(),
    parentId: randomUUID(),
    learnerId: randomUUID(),
  };
  await g.prisma.$executeRawUnsafe(
    `insert into chat.family (id, display_name, owner_id, language)
     values ('${ids.familyId}'::uuid, 'family_y', '${s.ownerId}'::uuid, 'ar')`,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.contact (id, family_id, name, role_preset, can_message, is_active)
     values ('${ids.parentId}'::uuid, '${ids.familyId}'::uuid, 'parent_z',
             'primary_guardian', true, true)`,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.learner (id, family_id, name, teacher_id)
     values ('${ids.learnerId}'::uuid, '${ids.familyId}'::uuid, 'learner_n',
             '${s.teacherId}'::uuid)`,
  );
  return ids;
}

const admin = () => ({
  actorId: s.ownerId,
  kind: 'staff' as const,
  displayName: 'admin_a',
  locale: 'ar' as const,
  isActive: true,
  staffRole: 'admin' as const,
});

const drain = () => g.outboxWorker.drain(200);

async function groupFor(learnerId: string): Promise<string> {
  return (await g.conversations.ensureStudentGroup(learnerId)).id;
}

/** Every notification this parent holds, newest first. */
async function mine() {
  return g.prisma.notification.findMany({
    where: { recipientId: s.parentId },
    orderBy: { createdAt: 'asc' },
  });
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
describe('every notification names the child it is about', () => {
  it('a message in Ahmed’s group says Ahmed, and links to Ahmed’s group', async () => {
    const children = await addChildren();
    const ahmedsGroup = await groupFor(children.ahmed);
    const sent = await g.messages.send({
      conversationId: ahmedsGroup,
      senderId: s.ownerId,
      body: 'homework is ready',
    });
    await drain();

    const [n] = await mine();
    expect(n.learnerId).toBe(children.ahmed);
    expect(n.title).toContain('Ahmed');
    // Not "one of your children" and not the family name: the parent has to
    // know which child without opening anything.
    expect(n.title).not.toContain('Omar');
    expect(n.title).not.toContain('Sara');
    expect(n.deeplink).toBe(`/chats/${ahmedsGroup}?message=${sent.id}`);
  });

  it('a voice message in Omar’s group says Omar, and says it is a voice message', async () => {
    const children = await addChildren();
    const omarsGroup = await groupFor(children.omar);
    const sent = await g.messages.send({
      conversationId: omarsGroup,
      senderId: s.ownerId,
      type: MessageType.VOICE,
      attachments: [
        {
          kind: 'voice',
          objectKey: `voice/${randomUUID()}.m4a`,
          mimeType: 'audio/mp4',
          byteSize: 2048,
          durationMs: 4000,
        },
      ],
    });
    await drain();

    const [n] = await mine();
    expect(n.type).toBe(NotificationType.VOICE_MESSAGE_RECEIVED);
    expect(n.learnerId).toBe(children.omar);
    expect(n.title).toContain('Omar');
    expect(n.deeplink).toBe(`/chats/${omarsGroup}?message=${sent.id}`);
  });

  it('a schedule change for Sara says Sara, and links to Sara’s classes', async () => {
    const children = await addChildren();
    await g.prisma.learner.update({
      where: { id: children.sara },
      data: { nextClassAt: new Date('2026-09-29T14:00:00Z') },
    });

    await g.classSchedule.reschedule(admin(), {
      learnerId: children.sara,
      nextClassAt: new Date('2026-09-29T15:00:00Z'),
      reason: 'teacher availability',
    });

    const [n] = await mine();
    expect(n.type).toBe(NotificationType.CLASS_SCHEDULE_CHANGED);
    expect(n.learnerId).toBe(children.sara);
    expect((n.variables as Record<string, string>).student_name).toBe('Sara');
    // The link goes to SARA's classes. A link to "classes" would make the
    // parent work out which child it meant from a screen showing all three.
    expect(n.deeplink).toBe(`/learners/${children.sara}/classes`);
  });

  it('a missed call in Ahmed’s group says Ahmed', async () => {
    const children = await addChildren();
    const ahmedsGroup = await groupFor(children.ahmed);
    const { callId } = await g.calls.start(ahmedsGroup, s.ownerId);
    await g.calls.end(callId, s.ownerId, 'missed');
    await drain();

    const missed = (await mine()).filter((n) => n.type === NotificationType.MISSED_CALL);
    expect(missed).toHaveLength(1);
    expect(missed[0].learnerId).toBe(children.ahmed);
    // The group, and the call within it -- still Ahmed's group and no other.
    expect(missed[0].deeplink).toMatch(new RegExp(`^/chats/${ahmedsGroup}\\?call=`));
  });

  it('three children at once stay three distinguishable notifications', async () => {
    const children = await addChildren();
    const groups = {
      ahmed: await groupFor(children.ahmed),
      omar: await groupFor(children.omar),
      sara: await groupFor(children.sara),
    };

    for (const [child, conversationId] of Object.entries(groups)) {
      await g.messages.send({
        conversationId,
        senderId: s.ownerId,
        body: `about ${child}`,
      });
    }
    await drain();

    const rows = await mine();
    expect(rows).toHaveLength(3);

    // One per child, each carrying its own child's id, its own group's link,
    // and its own child's name -- on ONE badge, which is the point: the count
    // is the parent's, the identity is the child's.
    expect(new Set(rows.map((r) => r.learnerId))).toEqual(
      new Set([children.ahmed, children.omar, children.sara]),
    );
    expect(new Set(rows.map((r) => r.conversationId))).toEqual(
      new Set(Object.values(groups)),
    );
    expect((await g.centre.unreadCounts(s.parentId)).total).toBe(3);

    for (const row of rows) {
      const name = { [children.ahmed]: 'Ahmed', [children.omar]: 'Omar', [children.sara]: 'Sara' }[
        row.learnerId!
      ]!;
      expect(row.title).toContain(name);
      expect(row.deeplink).toContain(row.conversationId!);
    }
  });

  it('a dedupe key is per child, so three children are never one notification', async () => {
    const children = await addChildren();
    // The same fact for three children on the same day. A key that left the
    // child out -- or left the message out -- would collapse these into one and
    // two parents' worth of children would go untold.
    for (const child of Object.values(children)) {
      await g.prisma.learner.update({
        where: { id: child },
        data: { nextClassAt: new Date('2026-09-29T14:00:00Z') },
      });
      await g.classSchedule.reschedule(admin(), {
        learnerId: child,
        nextClassAt: new Date('2026-09-29T15:00:00Z'),
        reason: 'holiday',
      });
    }

    // Rescheduling also schedules that child's reminders, so the changes are
    // taken on their own here.
    const rows = (await mine()).filter(
      (r) => r.type === NotificationType.CLASS_SCHEDULE_CHANGED,
    );
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.dedupeKey)).size).toBe(3);
    expect(new Set(rows.map((r) => r.learnerId))).toEqual(
      new Set(Object.values(children)),
    );
  });
});

// =========================================================================
describe('a deep link never crosses a family', () => {
  it('another family’s parent cannot open this notification', async () => {
    const children = await addChildren();
    await g.messages.send({
      conversationId: await groupFor(children.ahmed),
      senderId: s.ownerId,
      body: 'private to this family',
    });
    await drain();
    const [n] = await mine();
    const other = await otherFamily();

    // The id is real and the link is well-formed. Neither is a credential --
    // the backend re-authorizes on the landing, and refuses.
    await expect(g.centre.byId(other.parentId, n.id)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('refusing looks the same as not existing', async () => {
    const other = await otherFamily();

    // 404 for both, deliberately: a 403 on a real id and a 404 on a made-up one
    // would let anyone probe which notification ids exist.
    await expect(g.centre.byId(other.parentId, randomUUID())).rejects.toMatchObject({
      status: 404,
    });
  });

  it('the conversation a link points at refuses too, not just the notification', async () => {
    const children = await addChildren();
    const ahmedsGroup = await groupFor(children.ahmed);
    await g.messages.send({
      conversationId: ahmedsGroup,
      senderId: s.ownerId,
      body: 'still private',
    });
    await drain();
    const other = await otherFamily();

    // Following the link by hand, past the notification: the conversation is
    // the second door, and it is locked independently.
    await expect(
      g.messages.list({ conversationId: ahmedsGroup, actorId: other.parentId }),
    ).rejects.toBeDefined();
  });

  it('a notification for one family is never created for another', async () => {
    const children = await addChildren();
    const other = await otherFamily();
    await g.messages.send({
      conversationId: await groupFor(children.ahmed),
      senderId: s.ownerId,
      body: 'fan-out check',
    });
    await drain();

    // Fan-out is by conversation membership, so the other family is not a
    // recipient -- they do not get a notification they cannot open, they get
    // no notification at all.
    expect(
      await g.prisma.notification.count({ where: { recipientId: other.parentId } }),
    ).toBe(0);
  });

  it('marking read is scoped to the reader, across children and families', async () => {
    const children = await addChildren();
    for (const child of [children.ahmed, children.omar]) {
      await g.messages.send({
        conversationId: await groupFor(child),
        senderId: s.ownerId,
        body: 'two children',
      });
    }
    await drain();
    const rows = await mine();
    const other = await otherFamily();

    // Another parent naming a real notification id.
    expect(await g.centre.markRead(other.parentId, rows[0].id)).toBe(false);
    expect(
      (await g.prisma.notification.findUnique({ where: { id: rows[0].id } }))!.readAt,
    ).toBeNull();

    // And the owner reading ONE child's notification leaves the other child's
    // alone: read state is per notification, not per parent.
    expect(await g.centre.markRead(s.parentId, rows[0].id)).toBe(true);
    expect((await g.centre.unreadCounts(s.parentId)).total).toBe(1);
  });

  it('reading one child’s thread does not read another child’s', async () => {
    const children = await addChildren();
    const ahmedsGroup = await groupFor(children.ahmed);
    const omarsGroup = await groupFor(children.omar);
    await g.messages.send({ conversationId: ahmedsGroup, senderId: s.ownerId, body: 'a' });
    await g.messages.send({ conversationId: omarsGroup, senderId: s.ownerId, body: 'o' });
    await drain();

    // Opening Ahmed's thread reads Ahmed's notifications. Omar's are a
    // different child's and stay unread.
    expect(await g.centre.markConversationRead(s.parentId, ahmedsGroup)).toBe(1);

    const rows = await mine();
    const ahmeds = rows.find((r) => r.learnerId === children.ahmed)!;
    const omars = rows.find((r) => r.learnerId === children.omar)!;
    expect(ahmeds.readAt).not.toBeNull();
    expect(omars.readAt).toBeNull();
    expect((await g.centre.unreadCounts(s.parentId)).total).toBe(1);
  });
});
