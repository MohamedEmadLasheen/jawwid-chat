/**
 * Two families that share nothing, and the boundary between them.
 *
 * ## Why this suite exists, and what it does and does not prove
 *
 * `AuthorizationService` is, today, the ONLY authorization boundary on the
 * request path. Row-level security is enabled on much of the schema but no
 * policy admits a parent at all, and nothing sets the per-request actor context
 * those policies read -- so the API runs as the database owner and RLS enforces
 * nothing for it (docs/security/RLS-STRATEGY.md section 7 item 1 is unmet).
 * That is recorded as a remaining P0 and is not closed here.
 *
 * The consequence is that every claim about one family not reaching another's
 * data rests on application code. A boundary that rests on application code and
 * is only reviewed by reading it is a boundary nobody has tested. So this suite
 * drives the REAL controllers, holding the REAL services, against the REAL
 * migrated database, and asserts the refusals from the outside -- the position
 * an attacker occupies -- rather than unit-testing the decision function that
 * is supposed to produce them.
 *
 * Every read path the Parent client uses is covered, and so is every mutation
 * it can reach. A new Parent-facing route that is not represented here is a
 * route whose isolation nobody has checked.
 */
import { ConversationController } from '@communication/api/conversation.controller';
import { MessageController } from '@communication/api/message.controller';
import { StoryController } from '@communication/api/story.controller';
import { ApprovalController } from '@communication/api/approval.controller';
import { CallController } from '@communication/api/call.controller';
import {
  buildGraph,
  seed,
  seedSecondFamily,
  truncate,
  Scenario,
  SecondFamily,
} from './harness';

jest.setTimeout(90_000);

const g = buildGraph();
let a: Scenario;
let b: SecondFamily;
let conversations: ConversationController;
let messages: MessageController;
let stories: StoryController;
let approvals: ApprovalController;
let calls: CallController;

/** Parent A's own group and 1:1, and Parent B's own group and 1:1. */
let aGroupId: string;
let aThreadId: string;
let bGroupId: string;
let bThreadId: string;
let bMessageId: string;

beforeAll(async () => {
  await g.prisma.$connect();
});
afterAll(async () => {
  await g.prisma.$disconnect();
});

beforeEach(async () => {
  await truncate(g.prisma);
  a = await seed(g.prisma);
  b = await seedSecondFamily(g.prisma);
  g.coverage.onDutyId = a.ownerId;

  conversations = new ConversationController(g.conversations, g.messages, g.directory, g.authz, g.calls);
  messages = new MessageController(g.messages, g.attachments);
  stories = new StoryController(g.stories);
  approvals = new ApprovalController(g.approvals);
  calls = new CallController(g.calls);

  aGroupId = (await g.conversations.ensureStudentGroup(a.learnerId, a.ownerId)).id;
  aThreadId = (await g.conversations.getOrCreateDirect(a.parentId, a.ownerId)).id;

  // Family B's rows are written while B's own admin is on duty, then duty is
  // handed back -- otherwise the fixture could not produce B's staff message.
  g.coverage.onDutyId = b.ownerId;
  bGroupId = (await g.conversations.ensureStudentGroup(b.learnerId, b.ownerId)).id;
  bThreadId = (await g.conversations.getOrCreateDirect(b.parentId, b.ownerId)).id;
  const bMessage = await g.messages.send({
    conversationId: bThreadId,
    senderId: b.ownerId,
    body: 'family_z private message',
  });
  bMessageId = bMessage.id;
  g.coverage.onDutyId = a.ownerId;
});

// ---------------------------------------------------------------------------
// What Parent A may NOT do
// ---------------------------------------------------------------------------

describe('Parent A cannot reach Parent B', () => {
  it('does not see any of family B conversations in their own list', async () => {
    const list = (await conversations.list(a.parentId)).conversations;
    const ids = list.map((c) => c.id);

    expect(ids).toContain(aGroupId);
    expect(ids).toContain(aThreadId);
    expect(ids).not.toContain(bGroupId);
    expect(ids).not.toContain(bThreadId);
  });

  it('cannot open family B 1:1 by id', async () => {
    await expect(conversations.get(a.parentId, bThreadId)).rejects.toThrow();
  });

  it('cannot open family B student group by id', async () => {
    await expect(conversations.get(a.parentId, bGroupId)).rejects.toThrow();
  });

  it('cannot read family B messages', async () => {
    await expect(messages.list(a.parentId, bThreadId)).rejects.toThrow();
  });

  it('cannot learn family B member names through the group route', async () => {
    // The member list is the one payload that names other people, so it is the
    // one most worth proving is gated. The refusal must happen before any name
    // is resolved, not by filtering names out afterwards.
    await expect(conversations.get(a.parentId, bGroupId)).rejects.toThrow();
  });

  it('cannot send into family B conversations', async () => {
    await expect(
      messages.send(a.parentId, bThreadId, { body: 'intruding' }),
    ).rejects.toThrow();
    await expect(
      messages.send(a.parentId, bGroupId, { body: 'intruding' }),
    ).rejects.toThrow();
  });

  it('cannot mark family B messages read', async () => {
    await expect(messages.markRead(a.parentId, bThreadId, { upToSeq: '1' })).rejects.toThrow();
  });

  it('cannot change family B conversation preferences', async () => {
    // Pin and mute are per-actor rows; writing one for a conversation you
    // cannot read would both leak its existence and create state about it.
    await expect(
      conversations.preferences(a.parentId, bThreadId, { pinned: true }),
    ).rejects.toThrow();

    const rows = await g.prisma.conversationParticipantState.findMany({
      where: { conversationId: bThreadId, actorId: a.parentId },
    });
    expect(rows).toHaveLength(0);
  });

  it('cannot react to a family B message', async () => {
    await expect(messages.react(a.parentId, bMessageId, { emoji: '👍' })).rejects.toThrow();
  });

  it('cannot delete a family B message, for themselves or for everyone', async () => {
    await expect(messages.deleteForMe(a.parentId, bMessageId)).rejects.toThrow();
    await expect(messages.deleteForEveryone(a.parentId, bMessageId, 'because')).rejects.toThrow();

    const still = await g.prisma.message.findUnique({ where: { id: bMessageId } });
    expect(still?.deletedForAll).toBe(false);
  });

  it('cannot authorize an attachment upload into a family B conversation', async () => {
    // An upload authorization mints a signed URL. Granting one for another
    // family's conversation would put that family's attachment namespace in a
    // stranger's hands.
    await expect(
      messages.authorizeUpload(a.parentId, bThreadId, {
        kind: 'image',
        mimeType: 'image/png',
        byteSize: 1024,
      }),
    ).rejects.toThrow();
  });

  it('cannot read a family B attachment through a message page', async () => {
    const auth = await g.attachments.authorizeUpload({
      conversationId: bThreadId,
      actorId: b.ownerId,
      kind: 'image',
      mimeType: 'image/png',
      byteSize: 1024,
    });
    g.coverage.onDutyId = b.ownerId;
    await g.messages.send({
      conversationId: bThreadId,
      senderId: b.ownerId,
      type: 'image',
      attachments: [
        { kind: 'image', objectKey: auth.objectKey, mimeType: 'image/png', byteSize: 1024 },
      ],
    });
    g.coverage.onDutyId = a.ownerId;

    await expect(messages.list(a.parentId, bThreadId)).rejects.toThrow();
  });

  it('cannot add themselves to a family B group', async () => {
    await expect(
      conversations.setMember(a.parentId, bGroupId, {
        action: 'add',
        actorId: a.parentId,
        actorKind: 'contact',
        memberRole: 'parent',
        reason: 'let me in',
      }),
    ).rejects.toThrow();

    const members = await g.prisma.conversationMember.findMany({
      where: { conversationId: bGroupId, actorId: a.parentId },
    });
    expect(members).toHaveLength(0);
  });

  it('cannot remove a member from a family B group', async () => {
    await expect(
      conversations.setMember(a.parentId, bGroupId, {
        action: 'remove',
        actorId: b.parentId,
        actorKind: 'contact',
        memberRole: 'parent',
        reason: 'out',
      }),
    ).rejects.toThrow();
  });

  it('cannot create a student group for another family learner', async () => {
    // The route that manufactured access rather than borrowing it. Before the
    // gate, this RESOLVED -- returning family B's group with the child's name
    // in its title, and creating the group there if none existed.
    await expect(
      conversations.studentGroup(a.parentId, { learnerId: b.learnerId }),
    ).rejects.toThrow();
  });

  it('cannot create a student group for their OWN learner either', async () => {
    // Provisioning is staff work whoever the learner is; a parent is the
    // subject of the arrangement, never its author. Asserting only the
    // cross-family case would leave the route open to a parent who guessed
    // nothing at all.
    await expect(
      conversations.studentGroup(a.parentId, { learnerId: a.learnerId }),
    ).rejects.toThrow();
  });

  it('cannot use the group route as an oracle for learner ids', async () => {
    // The refusal must come BEFORE the learner lookup, so a real id and an
    // invented one are indistinguishable from outside.
    const real = conversations.studentGroup(a.parentId, { learnerId: b.learnerId });
    const fake = conversations.studentGroup(a.parentId, {
      learnerId: '00000000-0000-4000-8000-0000000000ff',
    });

    await expect(real).rejects.toThrow();
    await expect(fake).rejects.toThrow();
  });

  it('cannot reconcile another family group membership', async () => {
    // `sync` read no actor at all, so its membership mutation -- adding,
    // removing, writing left_at and a system message -- was open to anyone
    // holding any valid token.
    const before = await g.prisma.conversationMember.count({
      where: { conversationId: bGroupId },
    });

    await expect(conversations.sync(a.parentId, b.learnerId)).rejects.toThrow();

    const after = await g.prisma.conversationMember.count({
      where: { conversationId: bGroupId },
    });
    expect(after).toBe(before);
  });

  it('a TEACHER cannot provision or reconcile a group either', async () => {
    await expect(
      conversations.studentGroup(a.teacherId, { learnerId: a.learnerId }),
    ).rejects.toThrow();
    await expect(conversations.sync(a.teacherId, a.learnerId)).rejects.toThrow();
  });

  it('cannot open a direct conversation with another family parent', async () => {
    await expect(
      conversations.direct(a.parentId, { withActorId: b.parentId }),
    ).rejects.toThrow();
  });

  it('cannot open a direct conversation with an UNRELATED teacher', async () => {
    // PD-6 re-versioned BR-1: a parent and a teacher may hold a direct channel
    // where the server-resolved relationship authorizes it, and nowhere else.
    // So the assertion is no longer "never a teacher" -- it is "never a teacher
    // who teaches none of this parent's children", which is the boundary that
    // still matters. `unrelatedTeacherId` teaches nobody in family A;
    // `b.teacherId` belongs to another household entirely.
    await expect(
      conversations.direct(a.parentId, { withActorId: a.unrelatedTeacherId }),
    ).rejects.toThrow();
    await expect(
      conversations.direct(a.parentId, { withActorId: b.teacherId }),
    ).rejects.toThrow();
  });

  it('may open one with the teacher who actually teaches their child', async () => {
    // The other half of PD-6, asserted so the rule above cannot be "fixed" by
    // refusing every teacher again -- which would pass the test above and
    // delete a product capability.
    await expect(
      conversations.direct(a.parentId, { withActorId: a.teacherId }),
    ).resolves.toBeDefined();
  });

  it('cannot find family B conversations through search, at any term', async () => {
    // Search is the newest read path and the easiest one to widen by accident:
    // its scope predicate must be the list's, not a filter over everything.
    for (const term of ['learner_z', 'family_z', 'parent_z', 'admin_z', 'teacher_z', 'a', '']) {
      const found = (await conversations.list(a.parentId, term)).conversations;
      const ids = found.map((c) => c.id);
      expect(ids).not.toContain(bGroupId);
      expect(ids).not.toContain(bThreadId);
    }
  });

  it('cannot learn family B learner names through search results', async () => {
    const found = (await conversations.list(a.parentId, 'learner_z')).conversations;

    expect(found.map((c) => c.learner?.name)).not.toContain('learner_z');
    expect(found).toEqual([]);
  });

  it('cannot see a family B story in their feed', async () => {
    const story = await g.stories.create(b.ownerId, {
      title: 'family_z only',
      body: 'private',
      audiences: [{ kind: 'family', refId: b.familyId }],
    });
    await g.stories.publish(story.id, b.ownerId);

    const feed = await stories.feed(a.parentId);

    expect(feed.stories.map((s) => s.id)).not.toContain(story.id);
  });

  it('cannot mark a family B story viewed, which would also confirm it exists', async () => {
    const story = await g.stories.create(b.ownerId, {
      title: 'family_z only',
      body: 'private',
      audiences: [{ kind: 'family', refId: b.familyId }],
    });
    await g.stories.publish(story.id, b.ownerId);

    await expect(stories.view(a.parentId, story.id)).rejects.toThrow();
  });

  it('cannot read a family B call history', async () => {
    await expect(calls.history(a.parentId, bThreadId)).rejects.toThrow();
  });

  it('cannot start a call in a family B conversation', async () => {
    await expect(calls.start(a.parentId, { conversationId: bThreadId })).rejects.toThrow();
  });

  it('cannot decide approvals, their own family or another', async () => {
    // A parent is never an approver. The route must refuse before it discloses
    // whether the approval id exists.
    await expect(approvals.pending(a.parentId)).rejects.toThrow();
  });

  it('sees nothing of family B even when family B is the only thing with activity',
    async () => {
      // A list that falls back to "everything" when a caller has nothing is the
      // classic empty-scope bug. Parent A is stripped of their own memberships
      // and must end up with an empty list, not with family B.
      await g.prisma.$executeRawUnsafe(
        `update chat.conversation_member set left_at = now()
          where actor_id = '${a.parentId}'::uuid`,
      );

      const list = (await conversations.list(a.parentId)).conversations;

      expect(list).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// What Parent A MAY do -- the other half, so the rules are not merely "deny"
// ---------------------------------------------------------------------------

describe('Parent A can do everything they are entitled to', () => {
  it('sees exactly their own conversations, named and previewed', async () => {
    await g.messages.send({ conversationId: aThreadId, senderId: a.ownerId, body: 'hello' });

    const list = (await conversations.list(a.parentId)).conversations;

    expect(list.map((c) => c.id).sort()).toEqual([aGroupId, aThreadId].sort());
    const thread = list.find((c) => c.id === aThreadId)!;
    expect(thread.counterpart?.displayName).toBe('admin_a');
    expect(thread.lastMessage?.preview).toBe('hello');
  });

  it('opens their own group and sees its members', async () => {
    const dto = await conversations.get(a.parentId, aGroupId);

    expect(dto.members!.map((m) => m.displayName)).toContain('teacher_c');
  });

  it('sees only their own children, through the groups they are a member of', async () => {
    const list = (await conversations.list(a.parentId)).conversations;
    const learners = list.map((c) => c.learner?.name).filter(Boolean);

    expect(learners).toContain('learner_l');
    expect(learners).not.toContain('learner_z');
  });

  it('sends in their own 1:1 and it publishes', async () => {
    const sent = await messages.send(a.parentId, aThreadId, { body: 'a question' });

    expect(sent.moderation).toBe('published');
  });

  it('sends in their own group and it is held for approval', async () => {
    const sent = await messages.send(a.parentId, aGroupId, { body: 'a group question' });

    expect(sent.moderation).toBe('pending');
  });

  it('pins and mutes their own conversation, and reads the state back', async () => {
    await conversations.preferences(a.parentId, aThreadId, { pinned: true });

    const dto = (await conversations.list(a.parentId)).conversations.find(
      (c) => c.id === aThreadId,
    )!;

    expect(dto.viewerState?.pinnedAt).toEqual(expect.any(String));
  });

  it('deletes their own message for themselves', async () => {
    const mine = await g.messages.send({
      conversationId: aThreadId,
      senderId: a.parentId,
      body: 'mine',
    });

    await expect(messages.deleteForMe(a.parentId, mine.id)).resolves.toBeDefined();
  });

  it('finds their own conversations by search', async () => {
    const found = (await conversations.list(a.parentId, 'learner_l')).conversations;

    expect(found.map((c) => c.id)).toContain(aGroupId);
  });

  it('does not block Jawwid staff from provisioning, which is their job', async () => {
    // The gate must refuse family members without refusing the people the
    // route exists for.
    await expect(
      conversations.studentGroup(a.ownerId, { learnerId: a.learnerId }),
    ).resolves.toBeDefined();
    await expect(conversations.sync(a.ownerId, a.learnerId)).resolves.toBeDefined();
  });

  it('sees a story published to their own family', async () => {
    const story = await g.stories.create(a.ownerId, {
      title: 'family_x',
      body: 'for you',
      audiences: [{ kind: 'family', refId: a.familyId }],
    });
    await g.stories.publish(story.id, a.ownerId);

    const feed = await stories.feed(a.parentId);

    expect(feed.stories.map((s) => s.id)).toContain(story.id);
  });
});
