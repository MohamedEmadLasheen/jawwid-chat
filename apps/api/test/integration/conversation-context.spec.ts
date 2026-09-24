/**
 * Learner context and unread counts on ConversationDto, against the real
 * migrated database.
 *
 * These are the two fields the Parent chat list could not render: `learnerId`
 * has always been on the DTO, but an id is not a heading, and the unread count
 * existed only behind a per-conversation endpoint the list could not afford to
 * call once per row.
 *
 * Both are things only a database can prove. An unread count is a query over
 * receipts, hidden rows and retractions; learner scoping is a question about
 * who is a member of what. A mocked Prisma would assert the shape of the call
 * and nothing about the answer.
 */
import { randomUUID } from 'node:crypto';
import { toConversationDto } from '@communication/contracts/dto';
import { buildGraph, seed, truncate, withAssignmentGate, Scenario } from './harness';

jest.setTimeout(60_000);

const g = buildGraph();
let s: Scenario;

beforeAll(async () => {
  await g.prisma.$connect();
});
afterAll(async () => {
  await g.prisma.$disconnect();
});
beforeEach(async () => {
  await truncate(g.prisma);
  s = await seed(g.prisma);
  g.coverage.onDutyId = s.ownerId;
});

/** The family's own thread with Jawwid: a direct conversation, no learner. */
async function familyThread() {
  return g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
}

/** The learner's official group: parent, teacher, admin. */
async function studentGroup() {
  return g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);
}

/** What the controller does, in one place, so the tests assert the real path. */
async function listFor(actorId: string) {
  const rows = await g.conversations.listForActor(actorId);
  const unread = await g.messages.unreadCountsFor(
    rows.map((c) => c.id),
    actorId,
  );
  return rows.map((c) =>
    toConversationDto(c, undefined, { unreadCount: unread.get(c.id) ?? 0 }),
  );
}

// -------------------------------------------------------------------------
describe('learner context', () => {
  it('a student group carries the learner, resolved to a name', async () => {
    const group = await studentGroup();

    const dto = (await listFor(s.parentId)).find((c) => c.id === group.id);

    expect(dto!.learner).toEqual({ id: s.learnerId, name: 'learner_l' });
    expect(dto!.learnerId).toBe(s.learnerId);
  });

  it('the family thread has no learner, and says so as null', async () => {
    const thread = await familyThread();

    const dto = (await listFor(s.parentId)).find((c) => c.id === thread.id);

    // Not undefined: the conversation was loaded, and the answer is that it is
    // about the family rather than about one child.
    expect(dto!.learner ?? null).toBeNull();
    expect(dto!.learnerId).toBeNull();
  });

  it('exposes only id and name — never level, schedule or teacher', async () => {
    // chat.learner also carries level, next_class_at and teacher_id. They are
    // operational detail a parent's chat list has no use for, and this is the
    // test that fails if somebody widens the include.
    await g.prisma.$executeRawUnsafe(
      `update chat.learner set level = 'intermediate', next_class_at = now()
       where id = '${s.learnerId}'::uuid`,
    );
    const group = await studentGroup();

    const dto = (await listFor(s.parentId)).find((c) => c.id === group.id);

    expect(Object.keys(dto!.learner!).sort()).toEqual(['id', 'name']);
  });

  it('a parent never receives another family\'s learner', async () => {
    // A second family, with its own child and its own group.
    const otherFamily = randomUUID();
    const otherLearner = randomUUID();
    const otherContact = randomUUID();
    await g.prisma.$executeRawUnsafe(
      `insert into chat.family (id, display_name, owner_id, language)
       values ('${otherFamily}'::uuid, 'family_y', '${s.ownerId}'::uuid, 'ar')`,
    );
    await g.prisma.$executeRawUnsafe(
      `insert into chat.contact (id, family_id, name, role_preset, can_message, is_active)
       values ('${otherContact}'::uuid, '${otherFamily}'::uuid, 'parent_z',
               'primary_guardian', true, true)`,
    );
    await withAssignmentGate(
      g.prisma,
      `insert into chat.learner (id, family_id, name, teacher_id)
       values ('${otherLearner}'::uuid, '${otherFamily}'::uuid, 'learner_other',
               '${s.teacherId}'::uuid)`,
    );

    await studentGroup();
    await g.conversations.ensureStudentGroup(otherLearner, s.ownerId);

    const mine = await listFor(s.parentId);

    expect(mine.map((c) => c.learner?.name)).not.toContain('learner_other');
    expect(mine.map((c) => c.learnerId)).not.toContain(otherLearner);
  });
});

// -------------------------------------------------------------------------
describe('unread count', () => {
  it('counts what the other side sent', async () => {
    const conv = await familyThread();
    for (let i = 0; i < 3; i += 1) {
      await g.messages.send({ conversationId: conv.id, senderId: s.ownerId, body: `m${i}` });
    }

    const dto = (await listFor(s.parentId)).find((c) => c.id === conv.id);
    expect(dto!.unreadCount).toBe(3);
  });

  it('is zero on a conversation with nothing in it', async () => {
    const conv = await familyThread();

    const dto = (await listFor(s.parentId)).find((c) => c.id === conv.id);
    // Zero, not absent: the list asked, and the answer is none.
    expect(dto!.unreadCount).toBe(0);
  });

  it('never counts the actor\'s own messages', async () => {
    const conv = await familyThread();
    await g.messages.send({ conversationId: conv.id, senderId: s.parentId, body: 'mine' });

    const dto = (await listFor(s.parentId)).find((c) => c.id === conv.id);
    expect(dto!.unreadCount).toBe(0);
  });

  it('falls to zero once read, and the list reflects it', async () => {
    const conv = await familyThread();
    await g.messages.send({ conversationId: conv.id, senderId: s.ownerId, body: 'one' });
    await g.messages.send({ conversationId: conv.id, senderId: s.ownerId, body: 'two' });

    expect((await listFor(s.parentId)).find((c) => c.id === conv.id)!.unreadCount).toBe(2);

    await g.messages.markReadUpTo(conv.id, s.parentId, '2');

    expect((await listFor(s.parentId)).find((c) => c.id === conv.id)!.unreadCount).toBe(0);
  });

  it('rises again when a new message arrives after a read', async () => {
    // The lifecycle the chat list has to survive without realtime: read to
    // zero, something new arrives, refetch, badge returns.
    const conv = await familyThread();
    await g.messages.send({ conversationId: conv.id, senderId: s.ownerId, body: 'one' });
    await g.messages.markReadUpTo(conv.id, s.parentId, '1');
    expect((await listFor(s.parentId)).find((c) => c.id === conv.id)!.unreadCount).toBe(0);

    await g.messages.send({ conversationId: conv.id, senderId: s.ownerId, body: 'two' });

    expect((await listFor(s.parentId)).find((c) => c.id === conv.id)!.unreadCount).toBe(1);
  });

  it('excludes a message the actor deleted for themselves', async () => {
    // The defect this closes: message_hidden_for leaves the receipt untouched,
    // so a parent who deleted an unread message kept it in their badge with no
    // way to clear it — the message is not in their conversation to be read.
    const conv = await familyThread();
    const a = await g.messages.send({ conversationId: conv.id, senderId: s.ownerId, body: 'a' });
    await g.messages.send({ conversationId: conv.id, senderId: s.ownerId, body: 'b' });

    expect((await listFor(s.parentId)).find((c) => c.id === conv.id)!.unreadCount).toBe(2);

    await g.messages.deleteForMe(a.id, s.parentId);

    expect((await listFor(s.parentId)).find((c) => c.id === conv.id)!.unreadCount).toBe(1);
  });

  it('a delete-for-me by one actor does not change another actor\'s count', async () => {
    const conv = await familyThread();
    const m = await g.messages.send({
      conversationId: conv.id,
      senderId: s.parentId,
      body: 'from the parent',
    });

    expect((await listFor(s.ownerId)).find((c) => c.id === conv.id)!.unreadCount).toBe(1);

    // A different actor hides it for themselves.
    await g.messages.deleteForMe(m.id, s.ownerId);

    expect((await listFor(s.ownerId)).find((c) => c.id === conv.id)!.unreadCount).toBe(0);
  });

  it('excludes a message retracted for everyone', async () => {
    const conv = await familyThread();
    const m = await g.messages.send({ conversationId: conv.id, senderId: s.ownerId, body: 'oops' });

    expect((await listFor(s.parentId)).find((c) => c.id === conv.id)!.unreadCount).toBe(1);

    await g.messages.deleteForEveryone(m.id, s.ownerId, 'sent in error');

    // Its body and attachments are gone; counting it would ask the parent to go
    // and read nothing.
    expect((await listFor(s.parentId)).find((c) => c.id === conv.id)!.unreadCount).toBe(0);
  });

  it('never counts a message still awaiting approval', async () => {
    // A pending group message creates no receipts at all, so it cannot reach
    // anyone's badge before a supervisor has approved it.
    const group = await studentGroup();
    await g.messages.send({
      conversationId: group.id,
      senderId: s.parentId,
      body: 'held for review',
    });

    const dto = (await listFor(s.teacherId)).find((c) => c.id === group.id);
    expect(dto!.unreadCount).toBe(0);
  });

  it('a contact never counts an internal note', async () => {
    const conv = await familyThread();
    await g.messages.send({
      conversationId: conv.id,
      senderId: s.ownerId,
      body: 'staff eyes only',
      visibility: 'internal',
    });

    const dto = (await listFor(s.parentId)).find((c) => c.id === conv.id);
    expect(dto!.unreadCount).toBe(0);
  });

  it('the list count and the single-conversation endpoint agree', async () => {
    // One predicate serves both. If these ever disagree, one of them is lying
    // to the badge.
    const conv = await familyThread();
    await g.messages.send({ conversationId: conv.id, senderId: s.ownerId, body: 'one' });
    const m = await g.messages.send({ conversationId: conv.id, senderId: s.ownerId, body: 'two' });
    await g.messages.deleteForMe(m.id, s.parentId);

    const fromList = (await listFor(s.parentId)).find((c) => c.id === conv.id)!.unreadCount;
    const fromEndpoint = await g.messages.unreadCount(conv.id, s.parentId);

    expect(fromList).toBe(fromEndpoint);
  });
});

// -------------------------------------------------------------------------
describe('one parent never learns another parent\'s unread state', () => {
  it('two contacts in the same family carry their own counts', async () => {
    // Both are contacts of family_x with can_message, so ensureStudentGroup
    // puts both in the group from Core. That is the closest two actors get in
    // this product, and their counts are still their own.
    const group = await studentGroup();
    const members = await g.prisma.conversationMember.findMany({
      where: { conversationId: group.id, leftAt: null },
    });
    expect(members.map((m) => m.actorId)).toEqual(
      expect.arrayContaining([s.parentId, s.otherParentId]),
    );

    await g.messages.send({ conversationId: group.id, senderId: s.ownerId, body: 'to the group' });

    const mine = (await listFor(s.parentId)).find((c) => c.id === group.id)!;
    const theirs = (await listFor(s.otherParentId)).find((c) => c.id === group.id)!;
    expect(mine.unreadCount).toBe(1);
    expect(theirs.unreadCount).toBe(1);

    // One of them reads it. The other's badge must not move.
    await g.messages.markReadUpTo(group.id, s.parentId, '9999');

    expect((await listFor(s.parentId)).find((c) => c.id === group.id)!.unreadCount).toBe(0);
    expect((await listFor(s.otherParentId)).find((c) => c.id === group.id)!.unreadCount).toBe(1);
  });

  it('a parent is never told about a conversation they are not in', async () => {
    const otherContact = randomUUID();
    const otherFamily = randomUUID();
    await g.prisma.$executeRawUnsafe(
      `insert into chat.family (id, display_name, owner_id, language)
       values ('${otherFamily}'::uuid, 'family_y', '${s.ownerId}'::uuid, 'ar')`,
    );
    await g.prisma.$executeRawUnsafe(
      `insert into chat.contact (id, family_id, name, role_preset, can_message, is_active)
       values ('${otherContact}'::uuid, '${otherFamily}'::uuid, 'parent_z',
               'primary_guardian', true, true)`,
    );

    const theirThread = await g.conversations.getOrCreateDirect(otherContact, s.ownerId);
    await g.messages.send({
      conversationId: theirThread.id,
      senderId: s.ownerId,
      body: 'not for you',
    });

    const mine = await listFor(s.parentId);

    expect(mine.map((c) => c.id)).not.toContain(theirThread.id);
  });

  it('the count query cannot be made to answer about an unauthorized id',
    async () => {
      // Defence in depth. The controller only ever passes ids that
      // listForActor already authorized, but even handed a foreign id this is
      // scoped to the actor's OWN receipts — so it can only count messages
      // that were addressed to them, and there are none.
      const otherContact = randomUUID();
      const otherFamily = randomUUID();
      await g.prisma.$executeRawUnsafe(
        `insert into chat.family (id, display_name, owner_id, language)
         values ('${otherFamily}'::uuid, 'family_y', '${s.ownerId}'::uuid, 'ar')`,
      );
      await g.prisma.$executeRawUnsafe(
        `insert into chat.contact (id, family_id, name, role_preset, can_message, is_active)
         values ('${otherContact}'::uuid, '${otherFamily}'::uuid, 'parent_z',
                 'primary_guardian', true, true)`,
      );
      const theirThread = await g.conversations.getOrCreateDirect(otherContact, s.ownerId);
      await g.messages.send({
        conversationId: theirThread.id,
        senderId: s.ownerId,
        body: 'not for you',
      });

      const counts = await g.messages.unreadCountsFor([theirThread.id], s.parentId);

      expect(counts.get(theirThread.id)).toBeUndefined();
    });
});

// -------------------------------------------------------------------------
describe('the count is one query, whatever the list length', () => {
  it('returns counts for many conversations in a single round trip', async () => {
    // The reason the field was left off the DTO in the first place (mobile gap
    // O1) was one round trip per row. The database call is spied on rather than
    // the wall clock timed: a duration assertion would be flaky, and "it was
    // fast" is not the claim. The claim is that there is exactly one call
    // however many conversations are asked about.
    const conversations = [await familyThread(), await studentGroup()];
    for (const conv of conversations) {
      await g.messages.send({ conversationId: conv.id, senderId: s.ownerId, body: 'hello' });
    }

    const groupBy = jest.spyOn(g.prisma.message, 'groupBy');

    const counts = await g.messages.unreadCountsFor(
      conversations.map((c) => c.id),
      s.parentId,
    );

    expect(groupBy).toHaveBeenCalledTimes(1);
    expect(counts.size).toBe(2);
    for (const conv of conversations) {
      expect(counts.get(conv.id)).toBe(1);
    }
    groupBy.mockRestore();
  });

  it('an empty list asks the database nothing', async () => {
    const groupBy = jest.spyOn(g.prisma.message, 'groupBy');

    expect((await g.messages.unreadCountsFor([], s.parentId)).size).toBe(0);

    expect(groupBy).not.toHaveBeenCalled();
    groupBy.mockRestore();
  });
});
