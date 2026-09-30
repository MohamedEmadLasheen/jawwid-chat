/**
 * The Parent-facing contract, for the seven defects the Parent QA pass found.
 *
 * Every one of them was reported as a Flutter symptom -- a blank row, a "?"
 * avatar, a role word where a name belongs, raw JSON on screen, an empty member
 * list, a pin that forgot itself, a missing preview -- and every one of them
 * was an API CONTRACT gap underneath. So they are asserted here, against the
 * real controller holding the real services against the real migrated database,
 * rather than in a widget test that could be made green by a client-side
 * fallback. A client cannot render what the payload does not carry.
 *
 * `conversation-dto-contract.spec.ts` covers the learner/unreadCount pair this
 * suite builds on; nothing here re-asserts those.
 */
import { ConversationController } from '@communication/api/conversation.controller';
import { MessageController } from '@communication/api/message.controller';
import type { ConversationDto } from '@communication/contracts/dto';
import { buildGraph, seed, truncate, Scenario } from './harness';

jest.setTimeout(60_000);

const g = buildGraph();
let s: Scenario;
let conversations: ConversationController;
let messages: MessageController;

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
  conversations = new ConversationController(g.conversations, g.messages, g.directory, g.authz, g.calls);
  messages = new MessageController(g.messages, g.attachments);
});

async function listFor(actorId: string): Promise<ConversationDto[]> {
  return (await conversations.list(actorId)).conversations;
}

/**
 * Write a system message directly.
 *
 * `chat.message.body` is immutable once sent (a deliberate schema invariant),
 * so a payload the application would never produce has to be inserted rather
 * than edited into place.
 */
async function writeSystemMessage(conversationId: string, seq: number, body: string) {
  await g.prisma.$executeRawUnsafe(
    `insert into chat.message
       (conversation_id, author_type, author_id, type, body, visibility, moderation, origin, seq)
     values ('${conversationId}'::uuid, 'system', null, 'system', $$${body}$$,
             'customer', 'published', 'automation', ${seq})`,
  );
}

// ---------------------------------------------------------------------------
// FIX 1 -- the 1:1 has an identity
// ---------------------------------------------------------------------------

describe('a direct conversation carries the other participant', () => {
  it('names the counterpart on the list row, from actual principal data', async () => {
    const thread = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);

    const dto = (await listFor(s.parentId)).find((c) => c.id === thread.id)!;

    // The row itself still has no title -- a 1:1 is not a room somebody named,
    // and inventing one on the server would be the same hardcoding the client
    // was asked not to do.
    expect(dto.title).toBeNull();
    expect(dto.counterpart).toEqual({
      actorId: s.ownerId,
      actorKind: 'staff',
      displayName: 'admin_a',
    });
  });

  it('resolves the counterpart per caller, not per conversation', async () => {
    // The same row, asked for by both sides, yields each side's OTHER member.
    // A counterpart cached across actors would hand a parent their own name.
    const thread = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);

    const asParent = (await listFor(s.parentId)).find((c) => c.id === thread.id)!;
    const asAdmin = (await listFor(s.ownerId)).find((c) => c.id === thread.id)!;

    expect(asParent.counterpart?.actorId).toBe(s.ownerId);
    expect(asAdmin.counterpart?.actorId).toBe(s.parentId);
  });

  it('is present on the detail route too, so the chat header can use it', async () => {
    const thread = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);

    const dto = await conversations.get(s.parentId, thread.id);

    expect(dto.counterpart?.displayName).toBe('admin_a');
  });

  it('is null on a group, where the title and learner already identify it', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);

    const dto = (await listFor(s.parentId)).find((c) => c.id === group.id)!;

    expect(dto.counterpart).toBeNull();
    expect(dto.title).toContain('learner_l');
  });
});

// ---------------------------------------------------------------------------
// FIX 2 -- senders have names
// ---------------------------------------------------------------------------

describe('a message carries its author display name', () => {
  it('names a staff author and a teacher author in the same page', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);
    await g.messages.send({ conversationId: group.id, senderId: s.ownerId, body: 'from admin' });
    await g.messages.send({ conversationId: group.id, senderId: s.teacherId, body: 'from teacher' });

    // The teacher's note is held for approval and is invisible to the parent
    // until it is decided, so it goes through the real approval flow first --
    // a name is only ever asserted on a message the reader may actually see.
    const pending = await g.approvals.listPending(s.ownerId);
    await g.approvals.approve(pending[0].approvalId, s.ownerId);

    const page = await messages.list(s.parentId, group.id);
    const byBody = new Map(page.messages.map((m) => [m.body, m.authorName]));

    expect(byBody.get('from admin')).toBe('admin_a');
    expect(byBody.get('from teacher')).toBe('teacher_c');
  });

  it('names the parent on their own message', async () => {
    const thread = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
    await g.messages.send({ conversationId: thread.id, senderId: s.parentId, body: 'mine' });

    const page = await messages.list(s.parentId, thread.id);

    expect(page.messages.find((m) => m.body === 'mine')!.authorName).toBe('parent_p');
  });

  it('never renders an actor id as a name, on any message in a page', async () => {
    // The trigger `assert_message_author_exists` makes an unresolvable STAFF or
    // CONTACT author unrepresentable, so the failure mode this guards is the
    // one that is representable: a name that is silently an internal
    // identifier. The id must never be the fallback (boundary doc 25); the
    // unresolved case itself is covered by the directory unit test.
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);
    await g.messages.send({ conversationId: group.id, senderId: s.ownerId, body: 'a' });
    await g.messages.send({ conversationId: group.id, senderId: s.parentId, body: 'b' });

    const page = await messages.list(s.parentId, group.id);

    expect(page.messages.length).toBeGreaterThan(1);
    for (const m of page.messages) {
      if (m.authorName !== null) {
        expect(m.authorName).not.toBe(m.authorId);
        expect(m.authorName).not.toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
// FIX 3 -- system messages are data, never prose
// ---------------------------------------------------------------------------

describe('a system message never ships its payload as text', () => {
  it('publishes kind and params, and nulls the body', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);

    const page = await messages.list(s.parentId, group.id);
    const system = page.messages.find((m) => m.type === 'system')!;

    expect(system.systemEvent).toEqual({
      kind: 'group.created',
      params: { learner: 'learner_l' },
    });
    // The defect was this field carrying `{"kind":"group.created",...}`.
    expect(system.body).toBeNull();
  });

  it('never leaves a JSON-looking body on any message in a page', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);
    await g.messages.send({ conversationId: group.id, senderId: s.ownerId, body: 'ordinary' });

    const page = await messages.list(s.parentId, group.id);

    for (const m of page.messages) {
      expect(m.body ?? '').not.toMatch(/^\s*\{.*"kind"\s*:/);
    }
  });

  it('degrades to no event, not an exception, on an unparseable payload', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);
    await writeSystemMessage(group.id, 2, 'not json at all');

    const page = await messages.list(s.parentId, group.id);
    const system = page.messages.find((m) => m.seq === '2')!;

    expect(system.systemEvent).toBeNull();
    // The unparseable payload must not reach a screen either.
    expect(system.body).toBeNull();
  });

  it('passes an unknown future kind straight through for the client to handle', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);
    await writeSystemMessage(group.id, 2, '{"kind":"group.renamed","title":"new"}');

    const page = await messages.list(s.parentId, group.id);
    const system = page.messages.find((m) => m.seq === '2')!;

    expect(system.systemEvent).toEqual({ kind: 'group.renamed', params: { title: 'new' } });
  });
});

// ---------------------------------------------------------------------------
// FIX 4 -- the approval notice matches the policy that actually applies
// ---------------------------------------------------------------------------

describe('viewerRequiresApproval reflects the real moderation policy', () => {
  it('is false on a 1:1, where approval has never applied', async () => {
    const thread = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);

    const dto = (await listFor(s.parentId)).find((c) => c.id === thread.id)!;

    // The stored flag is true on the row; the POLICY still does not hold a 1:1
    // message. This is the exact pair the client used to get wrong.
    expect(dto.parentRequiresApproval).toBe(true);
    expect(dto.viewerRequiresApproval).toBe(false);
  });

  it('is true for a parent in a group whose parent approval is on', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);

    const dto = (await listFor(s.parentId)).find((c) => c.id === group.id)!;

    expect(dto.viewerRequiresApproval).toBe(true);
  });

  it('is false for a parent when only the TEACHER needs approval', async () => {
    // The defect: the client OR-ed the two flags, so a parent was told their
    // messages were reviewed because somebody else's were.
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);
    await g.prisma.$executeRawUnsafe(
      `update chat.conversation set parent_requires_approval = false,
                                    teacher_requires_approval = true
        where id = '${group.id}'::uuid`,
    );

    const dto = (await listFor(s.parentId)).find((c) => c.id === group.id)!;

    expect(dto.teacherRequiresApproval).toBe(true);
    expect(dto.viewerRequiresApproval).toBe(false);
  });

  it('answers per viewer: the same group holds the teacher and not the parent', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);
    await g.prisma.$executeRawUnsafe(
      `update chat.conversation set parent_requires_approval = false,
                                    teacher_requires_approval = true
        where id = '${group.id}'::uuid`,
    );

    const asParent = (await listFor(s.parentId)).find((c) => c.id === group.id)!;
    const asTeacher = (await listFor(s.teacherId)).find((c) => c.id === group.id)!;

    expect(asParent.viewerRequiresApproval).toBe(false);
    expect(asTeacher.viewerRequiresApproval).toBe(true);
  });

  it('agrees with the moderation the message is actually stored with', async () => {
    // One rule, one implementation: if the notice says "reviewed", the next
    // message must genuinely be held, and vice versa.
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);

    const dto = (await listFor(s.parentId)).find((c) => c.id === group.id)!;
    const sent = await g.messages.send({
      conversationId: group.id,
      senderId: s.parentId,
      body: 'does this hold?',
    });

    expect(dto.viewerRequiresApproval).toBe(true);
    expect(sent.moderation).toBe('pending');
  });
});

// ---------------------------------------------------------------------------
// FIX 5 -- group members come back, named
// ---------------------------------------------------------------------------

describe('GET /conversations/:id returns the members Group Info renders', () => {
  it('returns every live member with a name and a role', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);

    const dto = await conversations.get(s.parentId, group.id);

    expect(dto.members).toBeDefined();
    const byName = new Map(dto.members!.map((m) => [m.displayName, m.memberRole]));
    expect(byName.get('parent_p')).toBe('parent');
    expect(byName.get('parent_q')).toBe('parent');
    expect(byName.get('admin_a')).toBe('admin');
    expect(byName.get('teacher_c')).toBe('teacher');
  });

  it('carries actorKind alongside the name, so the client can group by role', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);

    const dto = await conversations.get(s.parentId, group.id);

    for (const m of dto.members!) {
      expect(['staff', 'contact', 'teacher']).toContain(m.actorKind);
      expect(typeof m.actorId).toBe('string');
    }
  });

  it('omits a member who has left', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);
    await g.prisma.$executeRawUnsafe(
      `update chat.conversation_member set left_at = now()
        where conversation_id = '${group.id}'::uuid and actor_id = '${s.otherParentId}'::uuid`,
    );

    const dto = await conversations.get(s.parentId, group.id);

    expect(dto.members!.map((m) => m.actorId)).not.toContain(s.otherParentId);
  });

  it('refuses the whole payload to a non-member, members included', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);
    await g.prisma.$executeRawUnsafe(
      `update chat.conversation_member set left_at = now()
        where conversation_id = '${group.id}'::uuid and actor_id = '${s.otherParentId}'::uuid`,
    );

    await expect(conversations.get(s.otherParentId, group.id)).rejects.toThrow();
  });

  it('returns a two-member list for a 1:1 without inventing a third', async () => {
    const thread = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);

    const dto = await conversations.get(s.parentId, thread.id);

    expect(dto.members).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// FIX 6 -- pin, mute and archive survive being read back
// ---------------------------------------------------------------------------

describe('the caller own pin/mute/archive state round-trips', () => {
  it('returns a pin that was set', async () => {
    const thread = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
    await conversations.preferences(s.parentId, thread.id, { pinned: true });

    const dto = (await listFor(s.parentId)).find((c) => c.id === thread.id)!;

    expect(dto.viewerState?.pinnedAt).toEqual(expect.any(String));
  });

  it('clears a pin that was unset', async () => {
    const thread = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
    await conversations.preferences(s.parentId, thread.id, { pinned: true });
    await conversations.preferences(s.parentId, thread.id, { pinned: false });

    const dto = (await listFor(s.parentId)).find((c) => c.id === thread.id)!;

    expect(dto.viewerState?.pinnedAt).toBeNull();
  });

  it('returns a mute expiry that was set, and clears it on unmute', async () => {
    const thread = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
    const until = new Date(Date.now() + 86_400_000).toISOString();

    await conversations.preferences(s.parentId, thread.id, { mutedUntil: until });
    let dto = (await listFor(s.parentId)).find((c) => c.id === thread.id)!;
    expect(dto.viewerState?.mutedUntil).toEqual(expect.any(String));

    await conversations.preferences(s.parentId, thread.id, { mutedUntil: null });
    dto = (await listFor(s.parentId)).find((c) => c.id === thread.id)!;
    expect(dto.viewerState?.mutedUntil).toBeNull();
  });

  it('is per actor: one parent pinning does not pin for anyone else', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);
    await conversations.preferences(s.parentId, group.id, { pinned: true });

    const mine = (await listFor(s.parentId)).find((c) => c.id === group.id)!;
    const theirs = (await listFor(s.otherParentId)).find((c) => c.id === group.id)!;

    expect(mine.viewerState?.pinnedAt).toEqual(expect.any(String));
    expect(theirs.viewerState?.pinnedAt).toBeNull();
  });

  it('keeps the caller own archive separate from the conversation being closed', async () => {
    // A parent archiving their copy must not make the room read-only, and a
    // staff archive must not look like a personal one.
    const thread = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
    await conversations.preferences(s.parentId, thread.id, { archived: true });

    const dto = (await listFor(s.parentId)).find((c) => c.id === thread.id)!;

    expect(dto.viewerState?.archivedAt).toEqual(expect.any(String));
    expect(dto.archivedAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// FIX 7 -- the list row has a preview
// ---------------------------------------------------------------------------

describe('lastMessage gives the list row something to show', () => {
  it('previews a text message, with its author named', async () => {
    const thread = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
    await g.messages.send({ conversationId: thread.id, senderId: s.ownerId, body: 'see you at five' });

    const dto = (await listFor(s.parentId)).find((c) => c.id === thread.id)!;

    expect(dto.lastMessage?.type).toBe('text');
    expect(dto.lastMessage?.preview).toBe('see you at five');
    expect(dto.lastMessage?.authorName).toBe('admin_a');
  });

  it('gives a voice note its type and no invented text', async () => {
    const thread = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
    const auth = await g.attachments.authorizeUpload({
      conversationId: thread.id,
      actorId: s.ownerId,
      kind: 'voice',
      mimeType: 'audio/mpeg',
      byteSize: 2048,
    });
    await g.messages.send({
      conversationId: thread.id,
      senderId: s.ownerId,
      type: 'voice',
      attachments: [
        { kind: 'voice', objectKey: auth.objectKey, mimeType: 'audio/mpeg', byteSize: 2048, durationMs: 3000 },
      ],
    });

    const dto = (await listFor(s.parentId)).find((c) => c.id === thread.id)!;

    expect(dto.lastMessage?.type).toBe('voice');
    // The words belong to the client, which knows the reader's language.
    expect(dto.lastMessage?.preview).toBeNull();
  });

  it('gives a system last-message its event and never its payload', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);

    const dto = (await listFor(s.parentId)).find((c) => c.id === group.id)!;

    expect(dto.lastMessage?.type).toBe('system');
    expect(dto.lastMessage?.preview).toBeNull();
    expect(dto.lastMessage?.systemEvent?.kind).toBe('group.created');
  });

  it('is null for a conversation with nothing in it', async () => {
    const thread = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);

    const dto = (await listFor(s.parentId)).find((c) => c.id === thread.id)!;

    expect(dto.lastMessage).toBeNull();
  });

  it('bounds a very long body rather than shipping the whole thing', async () => {
    const thread = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
    await g.messages.send({
      conversationId: thread.id,
      senderId: s.ownerId,
      body: 'x'.repeat(4000),
    });

    const dto = (await listFor(s.parentId)).find((c) => c.id === thread.id)!;

    expect(dto.lastMessage!.preview!.length).toBeLessThanOrEqual(141);
  });

  it('does not preview a message held for approval to anyone but its author', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);
    await g.messages.send({ conversationId: group.id, senderId: s.ownerId, body: 'published' });
    await g.messages.send({ conversationId: group.id, senderId: s.parentId, body: 'held' });

    const asOtherParent = (await listFor(s.otherParentId)).find((c) => c.id === group.id)!;
    const asAuthor = (await listFor(s.parentId)).find((c) => c.id === group.id)!;

    expect(asOtherParent.lastMessage?.preview).toBe('published');
    expect(asAuthor.lastMessage?.preview).toBe('held');
  });
});

// ---------------------------------------------------------------------------
// FIX 8 -- search is server-side and inside the caller's scope
// ---------------------------------------------------------------------------

describe('conversation search', () => {
  it('finds a group by the learner name', async () => {
    await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);

    const found = (await conversations.list(s.parentId, 'learner_l')).conversations;

    expect(found.map((c) => c.learner?.name)).toContain('learner_l');
  });

  it('finds a 1:1 by the other participant name, which is on no conversation column',
    async () => {
      const thread = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);

      const found = (await conversations.list(s.parentId, 'admin_a')).conversations;

      expect(found.map((c) => c.id)).toContain(thread.id);
    });

  it('folds Arabic the way the audience types it', async () => {
    // The client used to fold hamza, tashkeel, taa marbuta and Arabic-Indic
    // digits before matching. Moving search to the server without bringing that
    // with it would have made it quietly worse for an Arabic-first product, so
    // `chat.search_fold` applies the same folding to both sides.
    await g.prisma.$executeRawUnsafe(
      `update chat.learner set name = 'أحمد' where id = '${s.learnerId}'::uuid`,
    );
    await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);

    for (const term of ['أحمد', 'احمد', 'أحـمد']) {
      const found = (await conversations.list(s.parentId, term)).conversations;
      expect(found.map((c) => c.learner?.name)).toContain('أحمد');
    }
  });

  it('does not fold two different names into each other', async () => {
    await g.prisma.$executeRawUnsafe(
      `update chat.learner set name = 'أحمد' where id = '${s.learnerId}'::uuid`,
    );
    await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);

    const found = (await conversations.list(s.parentId, 'محمد')).conversations;

    expect(found).toEqual([]);
  });

  it('is case-insensitive', async () => {
    await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);

    const found = (await conversations.list(s.parentId, 'LEARNER_L')).conversations;

    expect(found.length).toBeGreaterThan(0);
  });

  it('returns an empty list, not everything, when nothing matches', async () => {
    await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);

    const found = (await conversations.list(s.parentId, 'zzzzz-no-such-thing')).conversations;

    expect(found).toEqual([]);
  });

  it('restores the full list when the term is cleared', async () => {
    await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);
    await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);

    const all = (await conversations.list(s.parentId, '   ')).conversations;

    expect(all.length).toBe(2);
  });

  it('decorates search results exactly like list rows', async () => {
    // A result that arrives without a name or a preview would send the client
    // back to a second request, which is the shape this phase removed.
    const thread = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
    await g.messages.send({ conversationId: thread.id, senderId: s.ownerId, body: 'hello there' });

    const found = (await conversations.list(s.parentId, 'admin_a')).conversations;
    const dto = found.find((c) => c.id === thread.id)!;

    expect(dto.counterpart?.displayName).toBe('admin_a');
    expect(dto.lastMessage?.preview).toBe('hello there');
    expect(typeof dto.unreadCount).toBe('number');
  });
});
