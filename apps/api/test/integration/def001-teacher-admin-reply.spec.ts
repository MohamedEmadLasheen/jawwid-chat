/**
 * DEF-001, end to end through the real service stack.
 *
 * The unit tests state the policy against fixtures. This one proves it with
 * membership read from chat.conversation_member by the service itself, because
 * the whole fix rests on that row being the authority -- a fixture cannot show
 * that the real resolution path supplies it.
 */
import { CommError, CommErrorCode } from '@platform/errors';
import { buildGraph, seed, truncate, Scenario } from './harness';

const g = buildGraph();
let s: Scenario;

beforeAll(async () => g.prisma.$connect());
afterAll(async () => g.prisma.$disconnect());
beforeEach(async () => {
  await truncate(g.prisma);
  s = await seed(g.prisma);
  // Nobody is on duty for anybody: every allow below has to come from
  // membership, never from a coverage answer that happens to match.
  g.coverage.onDutyId = null;
});

const text = (body: string, clientMessageId: string) => ({
  type: 'text',
  body,
  clientMessageId,
});

describe('DEF-001 — the Teacher <-> Admin channel is answerable', () => {
  it('an ordinary admin, off duty everywhere, can reply to the teacher', async () => {
    const conv = await g.conversations.getOrCreateDirect(s.teacherId, s.ownerId);
    expect(conv.familyId).toBeNull(); // C-2: never family-scoped

    await g.messages.send({
      conversationId: conv.id,
      senderId: s.teacherId,
      ...text('teacher asks', 'def001-t1'),
    });

    const reply = await g.messages.send({
      conversationId: conv.id,
      senderId: s.ownerId,
      ...text('admin answers', 'def001-a1'),
    });

    expect(reply.moderation).toBe('published');
    // OWNER, not ASSIST: message.service writes a `message.assist` audit row for
    // assist/escalation, so the wrong mode would forge an assist event here.
    expect(reply.onBehalfMode).toBe('owner');
  });

  it('both messages are then readable by both participants', async () => {
    const conv = await g.conversations.getOrCreateDirect(s.teacherId, s.ownerId);
    await g.messages.send({ conversationId: conv.id, senderId: s.teacherId, ...text('q', 'def001-t2') });
    await g.messages.send({ conversationId: conv.id, senderId: s.ownerId, ...text('a', 'def001-a2') });

    for (const viewer of [s.teacherId, s.ownerId]) {
      const page = await g.messages.list({ conversationId: conv.id, actorId: viewer });
      expect(page.messages.map((m) => m.body).sort()).toEqual(['a', 'q']);
    }
  });

  it('works on an existing conversation, not only a freshly created one', async () => {
    const first = await g.conversations.getOrCreateDirect(s.teacherId, s.ownerId);
    const again = await g.conversations.getOrCreateDirect(s.teacherId, s.ownerId);
    expect(again.id).toBe(first.id);

    const reply = await g.messages.send({
      conversationId: again.id,
      senderId: s.ownerId,
      ...text('answer on the existing channel', 'def001-a3'),
    });
    expect(reply.moderation).toBe('published');
  });
});

describe('DEF-001 — the boundaries, with real membership rows', () => {
  it('a NON-MEMBER admin who knows the conversation id is refused', async () => {
    const conv = await g.conversations.getOrCreateDirect(s.teacherId, s.ownerId);

    // otherAdminId is a real, active, family-facing admin who is simply not in
    // this conversation. Under the old read rule canRead let them READ it, and
    // the send path's own membership check was the refusal (NOT_CONVERSATION_
    // MEMBER). Since staff scope (2026-10-14) they are refused one step
    // earlier: a Teacher <-> Admin conversation has no family, so no owner and
    // no duty roster can bring it into an admin's charge, and only membership
    // (or a live sticky claim, see the next case) can. Either way: refused, and
    // NOT_ON_DUTY would be a misleading code here.
    await expect(
      g.messages.send({
        conversationId: conv.id,
        senderId: s.otherAdminId,
        ...text('intrusion', 'def001-x1'),
      }),
    ).rejects.toMatchObject({ code: CommErrorCode.STAFF_OUT_OF_SCOPE });
    expect(await g.prisma.message.count({ where: { conversationId: conv.id } })).toBe(0);
  });

  it('a departed admin is not rescued by the stickiness their own reply created', async () => {
    const conv = await g.conversations.getOrCreateDirect(s.teacherId, s.ownerId);

    // Reply once: MessageService makes this admin the sticky handler for
    // handoff.grace_minutes.
    await g.messages.send({ conversationId: conv.id, senderId: s.ownerId, ...text('a', 'def001-s1') });
    const row = await g.prisma.conversation.findUnique({ where: { id: conv.id } });
    expect(row!.stickyHandlerId).toBe(s.ownerId);

    // Now remove them. Without the shape deciding outright, the sticky branch
    // would still allow this send on nothing but that stale row.
    await g.prisma.conversationMember.updateMany({
      where: { conversationId: conv.id, actorId: s.ownerId },
      data: { leftAt: new Date() },
    });

    // PD-8: with no live staff member left in the channel nobody's scope
    // reaches it any more, so the refusal now comes from the read check --
    // earlier than the DEF-001 branch, and still not rescued by the sticky row.
    await expect(
      g.messages.send({ conversationId: conv.id, senderId: s.ownerId, ...text('b', 'def001-s2') }),
    ).rejects.toMatchObject({ code: CommErrorCode.STAFF_OUT_OF_SCOPE });
    expect(await g.prisma.message.count({ where: { conversationId: conv.id } })).toBe(1);
  });

  it('an admin who LEFT the conversation can no longer send', async () => {
    const conv = await g.conversations.getOrCreateDirect(s.teacherId, s.ownerId);
    await g.prisma.conversationMember.updateMany({
      where: { conversationId: conv.id, actorId: s.ownerId },
      data: { leftAt: new Date() },
    });

    // The client may still be showing the thread; the server is not.
    await expect(
      g.messages.send({
        conversationId: conv.id,
        senderId: s.ownerId,
        ...text('after leaving', 'def001-x2'),
      }),
    ).rejects.toBeInstanceOf(CommError);
  });

  it('a family-scoped conversation follows the PD-8 scope: on_duty() grants and refuses nothing', async () => {
    // The coverage engine names the OTHER Operations supervisor...
    g.coverage.onDutyId = s.otherAdminId;
    const direct = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
    expect(direct.familyId).not.toBeNull();

    // ...the children's supervisor still answers the parent, as OWNER,
    const posted = await g.messages.send({
      conversationId: direct.id,
      senderId: s.ownerId,
      ...text('the supervisor answers', 'def001-x3'),
    });
    expect(posted.onBehalfMode).toBe('owner');

    // ...and the "on duty" admin with no charge over the family can neither
    // write into this 1:1 nor open their own with the parent.
    await expect(
      g.messages.send({ conversationId: direct.id, senderId: s.otherAdminId, ...text('x', 'def001-x4') }),
    ).rejects.toMatchObject({ code: CommErrorCode.STAFF_OUT_OF_SCOPE });
    await expect(g.conversations.getOrCreateDirect(s.parentId, s.otherAdminId)).rejects.toMatchObject({
      code: CommErrorCode.STAFF_OUT_OF_SCOPE,
    });
    expect(await g.prisma.message.count({ where: { conversationId: direct.id } })).toBe(1);
  });

  it('a family-scoped GROUP is still governed by the family path, not the new branch', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);
    expect(group.familyId).not.toBeNull();

    // PD-8: a group that HAS a family is governed by the scope of its child's
    // supervisor, never by the DEF-001 membership branch and never by
    // on_duty(). An admin the coverage engine names, who supervises nobody
    // here, is refused and writes nothing -- asserted so the fix cannot later
    // be widened into groups by accident.
    g.coverage.onDutyId = s.otherAdminId;
    const before = await g.prisma.message.count({ where: { conversationId: group.id } });
    await expect(
      g.messages.send({
        conversationId: group.id,
        senderId: s.otherAdminId,
        ...text('on duty but not in charge', 'def001-g1'),
      }),
    ).rejects.toMatchObject({ code: CommErrorCode.STAFF_OUT_OF_SCOPE });
    expect(await g.prisma.message.count({ where: { conversationId: group.id } })).toBe(before);

    // The child's supervisor posts normally, whatever the coverage engine says.
    const posted = await g.messages.send({
      conversationId: group.id,
      senderId: s.ownerId,
      ...text('the supervisor in the group', 'def001-g2'),
    });
    expect(posted.moderation).toBe('published');
  });

  it('an internal note on the teacher channel is still allowed, by its own rule', async () => {
    const conv = await g.conversations.getOrCreateDirect(s.teacherId, s.ownerId);
    const note = await g.messages.send({
      conversationId: conv.id,
      senderId: s.ownerId,
      type: 'text',
      body: 'internal',
      visibility: 'internal',
      clientMessageId: 'def001-n1',
    });
    expect(note.visibility).toBe('internal');
  });

  it('the teacher cannot reach another teacher’s staff channel', async () => {
    const mine = await g.conversations.getOrCreateDirect(s.teacherId, s.ownerId);

    await expect(
      g.messages.send({
        conversationId: mine.id,
        senderId: s.unrelatedTeacherId,
        ...text('not my channel', 'def001-x4'),
      }),
    ).rejects.toMatchObject({ code: CommErrorCode.NOT_CONVERSATION_MEMBER });
  });

  it('a client-supplied requestedMode still grants a non-member nothing (JC-005)', async () => {
    const conv = await g.conversations.getOrCreateDirect(s.teacherId, s.ownerId);

    for (const requestedMode of ['owner', 'coverage', 'assist', 'escalation']) {
      await expect(
        g.messages.send({
          conversationId: conv.id,
          senderId: s.otherAdminId,
          ...text('mode probe', `def001-m-${requestedMode}`),
          requestedMode,
        } as never),
      ).rejects.toBeInstanceOf(CommError);
    }
  });
});
