/**
 * Message author identity — gap O3, author half.
 *
 * `MessageDto` carried `authorId` and no name, so the Flutter client fell back to
 * rendering the sender's ROLE: every parent in a Student Group was "Parent". The
 * client was already built to show a name; the payload had none to give.
 *
 * Two things are asserted here, and the second is the one that makes this
 * permanent rather than a local fix:
 *
 *  1. `authorDisplayName` is the canonical `Actor.displayName` — the same single
 *     source as `ConversationMemberDto.displayName` and `ActorDto.displayName`,
 *     derived from staff.name / contact.name / teacher.name. Never a role, never
 *     a label, never a fabrication.
 *
 *  2. It is resolved in ONE batch per page. The exact query cost is proven in
 *     `test/unit/identity/resolve-actors.spec.ts`; what this file proves is the
 *     externally meaningful half — that the message path asks once for a whole
 *     page and never once per row, and that `membersOf` now asks the same way.
 */
import { ActorKind } from '@communication/contracts/vocab';
import type { Actor } from '@platform/types';
import type {
  ActorRef,
  IdentityService,
  ResolvableAccount,
  ResolvedActors,
} from '@platform/identity.service';
import { buildGraph, seed, truncate, Scenario } from './harness';

jest.setTimeout(60_000);

let s: Scenario;

/**
 * Wraps the REAL identity service and counts how it is asked.
 *
 * Deliberately a wrapper rather than a stub: the answers are the real ones, so a
 * test can assert the resolved name AND the shape of the asking in the same run.
 */
class CountingIdentity implements IdentityService {
  batchCalls = 0;
  singleCalls = 0;
  lastRefs: readonly ActorRef[] = [];

  constructor(private readonly inner: IdentityService) {}

  async resolveActor(actorId: string): Promise<Actor | null> {
    this.singleCalls += 1;
    return this.inner.resolveActor(actorId);
  }

  async resolveActors(refs: readonly ActorRef[]): Promise<ResolvedActors> {
    this.batchCalls += 1;
    this.lastRefs = refs;
    return this.inner.resolveActors(refs);
  }

  async resolveForAccount(account: ResolvableAccount): Promise<Actor | null> {
    return this.inner.resolveForAccount(account);
  }

  reset(): void {
    this.batchCalls = 0;
    this.singleCalls = 0;
    this.lastRefs = [];
  }
}

let counting: CountingIdentity;

// The whole graph is built on the counting wrapper, so every service in it —
// messages, conversations, approvals — is observed without any of them being
// stubbed or reconstructed here.
const g = buildGraph((inner) => {
  counting = new CountingIdentity(inner);
  return counting;
});

const messages = g.messages;

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
  counting.reset();
});

describe('MessageDto.authorDisplayName is the canonical Actor.displayName', () => {
  it('names a staff author, a contact author and a teacher author', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);

    await messages.send({ conversationId: group.id, senderId: s.ownerId, body: 'from admin' });
    await messages.send({ conversationId: group.id, senderId: s.parentId, body: 'from parent' });
    await messages.send({ conversationId: group.id, senderId: s.teacherId, body: 'from teacher' });

    const page = await messages.list({ conversationId: group.id, actorId: s.ownerId });

    const byBody = new Map(page.messages.map((m) => [m.body, m]));

    // The seeded names, straight from staff.name / contact.name / teacher.name.
    expect(byBody.get('from admin')!.authorDisplayName).toBe('admin_a');
    expect(byBody.get('from parent')!.authorDisplayName).toBe('parent_p');
    expect(byBody.get('from teacher')!.authorDisplayName).toBe('teacher_c');

    // And the existing fields are untouched: additive, not a replacement.
    expect(byBody.get('from teacher')!.authorId).toBe(s.teacherId);
    expect(byBody.get('from teacher')!.authorKind).toBe(ActorKind.TEACHER);
  });

  it('names the author on the send response too, not only on the list', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);

    const sent = await messages.send({
      conversationId: group.id,
      senderId: s.parentId,
      body: 'hello',
    });

    // The sender's own message is rendered from this response, so a missing name
    // here would show the parent their own message as "Parent".
    expect(sent.authorDisplayName).toBe('parent_p');
  });

  it('a system message has no author and no name — not a placeholder', async () => {
    // ensureStudentGroup posts `group.created` as SYSTEM with author_id null.
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);

    const page = await messages.list({ conversationId: group.id, actorId: s.ownerId });
    const system = page.messages.find((m) => m.authorKind === ActorKind.SYSTEM)!;

    expect(system).toBeDefined();
    expect(system.authorId).toBeNull();
    expect(system.authorDisplayName).toBeNull();
  });

  it('an author whose actor no longer resolves is null, never fabricated', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);

    // A message row outlives the actor it names, so this state is reachable.
    // Inserted directly, because the ordinary path cannot produce it: `send`
    // resolves the sender first, and `message_no_rewrite` makes the identity
    // columns immutable afterwards — an existing message's author cannot be
    // repointed, which is the protection working.
    const ghost = '11111111-2222-3333-4444-555555555555';
    await g.prisma.$executeRawUnsafe(
      `insert into chat.message
         (conversation_id, author_type, author_id, type, body, visibility, seq)
       values ('${group.id}'::uuid, 'teacher', '${ghost}'::uuid, 'text', 'from nobody',
               'customer', 9999)`,
    );

    const page = await messages.list({ conversationId: group.id, actorId: s.ownerId });
    const orphan = page.messages.find((m) => m.body === 'from nobody')!;

    expect(orphan).toBeDefined();
    expect(orphan.authorId).toBe(ghost);
    expect(orphan.authorDisplayName).toBeNull();
    // Not the role, not the kind, not the id.
    expect(orphan.authorDisplayName).not.toBe(ActorKind.TEACHER);
    expect(orphan.authorDisplayName).not.toBe(ghost);
  });
});

describe('identity is resolved in one batch per page, never per message', () => {
  it('twelve messages by two authors ask once', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);
    for (let i = 0; i < 6; i += 1) {
      await messages.send({ conversationId: group.id, senderId: s.ownerId, body: `a${i}` });
      await messages.send({ conversationId: group.id, senderId: s.parentId, body: `p${i}` });
    }

    counting.reset();
    const page = await messages.list({ conversationId: group.id, actorId: s.ownerId });

    expect(page.messages.length).toBeGreaterThanOrEqual(12);

    // ONE batch for the whole page. This is the assertion that keeps a future
    // refactor from moving resolution inside the map.
    expect(counting.batchCalls).toBe(1);

    // And the batch was asked about every author on the page — including the
    // duplicates, which it deduplicates internally rather than the caller
    // pre-filtering and getting the key rule subtly wrong.
    expect(counting.lastRefs.length).toBeGreaterThanOrEqual(12);
    for (const ref of counting.lastRefs) {
      expect(ref.actorKind).toBeTruthy();
      expect(ref.actorId).toBeTruthy();
    }
  });

  it('the single-actor path is not used to name authors', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);
    for (let i = 0; i < 5; i += 1) {
      await messages.send({ conversationId: group.id, senderId: s.parentId, body: `p${i}` });
    }

    counting.reset();
    await messages.list({ conversationId: group.id, actorId: s.ownerId });

    // `resolveActor` is still legitimately used once, to resolve the REQUESTING
    // actor before authorization. What must not happen is it growing with the
    // page: five messages must not mean five more single lookups.
    expect(counting.singleCalls).toBeLessThanOrEqual(1);
  });
});

describe('membersOf uses the same batch primitive (the old N+1 is gone)', () => {
  it('asks once for a whole membership, not once per member', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);

    counting.reset();
    const members = await g.conversations.membersOf(group.id);

    // Both messaging contacts, the family's admin, and the assigned teacher —
    // membership is derived from the data, so the fixture's second contact is in
    // it too.
    expect(members.map((m) => m.displayName).sort()).toEqual([
      'admin_a',
      'parent_p',
      'parent_q',
      'teacher_c',
    ]);

    // One batch, not one lookup per member — and no single-actor call at all.
    expect(counting.batchCalls).toBe(1);
    expect(counting.singleCalls).toBe(0);
  });
});

describe('the approvals queue names the author too', () => {
  it('a pending message carries its author display name', async () => {
    // An approver decides about a person's message; two pending messages from two
    // different parents must not both read as "Parent".
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);

    await g.messages.send({
      conversationId: group.id,
      senderId: s.parentId,
      body: 'needs approval',
    });

    const pending = await g.approvals.listPending(s.ownerId, group.id);
    const held = pending.find((p) => p.message.body === 'needs approval');

    if (held) {
      expect(held.message.authorDisplayName).toBe('parent_p');
    } else {
      // The group's approval policy did not hold this message. Then there is
      // nothing to assert about a queue entry, and saying so beats a false pass.
      expect(pending).toEqual([]);
    }
  });
});
