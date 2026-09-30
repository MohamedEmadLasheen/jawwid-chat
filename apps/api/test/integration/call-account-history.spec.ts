/**
 * THIS ACTOR'S calls — and, far more importantly, nobody else's.
 *
 * WHY THIS FILE EXISTS. The Calls screen is the ACCOUNT's call list, and the
 * obvious way to build one is the wrong way: `where family_id = <my family>`.
 * A family holds conversations a given parent is not a member of — the second
 * parent's 1:1 with an admin, a teacher/admin thread about the learner — so a
 * family-wide query hands a parent somebody else's calls. That is an
 * authorization expansion wearing a convenience query's clothes, and the
 * regression test below exists to make it impossible to ship.
 *
 * WHAT IS AUTHORITATIVE HERE. `CallService.historyForActor` derives its scope
 * from `ConversationService.listForActor`, which IS the canonical "conversations
 * this actor may read" surface. These tests assert the CONSEQUENCES of that at
 * the boundary — what each actor kind receives — rather than re-asserting the
 * rule, so a change to the canonical rule shows up here as a behaviour change
 * instead of being silently mirrored.
 *
 * FAMILY-SCOPED history is NOT implemented and is not tested here. Its
 * authorization contract is undefined in this repository; see the W8-W2
 * closeout.
 */
import { randomUUID } from 'node:crypto';
import { CommErrorCode } from '@platform/errors';
import { Scenario, buildGraph, seed, truncate } from './harness';

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

/** A call in a direct conversation between two actors, started by `from`. */
async function callBetween(a: string, b: string, from: string) {
  const conv = await g.conversations.getOrCreateDirect(a, b);
  const { callId } = await g.calls.start(conv.id, from);
  return { conversationId: conv.id, callId };
}

const idsOf = (page: { items: { id: string }[] }) => page.items.map((c) => c.id);

/**
 * Clone an existing call row `count` times, all with the SAME `started_at`.
 *
 * Cheap, and deliberately degenerate: a page boundary that lands inside a run of
 * identical timestamps is exactly where an ordering without a tiebreak repeats or
 * skips a row. Going through `CallService.start` would take a transaction each
 * and would not let the timestamps be pinned.
 */
async function cloneCalls(callId: string, count: number, pinned: string) {
  await g.prisma.$executeRawUnsafe(
    `update chat.call set started_at = '${pinned}'::timestamptz where id = '${callId}'::uuid`,
  );
  for (let i = 0; i < count; i += 1) {
    await g.prisma.$executeRawUnsafe(
      `insert into chat.call (conversation_id, family_id, initiator_id, type, room_name, status, started_at)
       select conversation_id, family_id, initiator_id, type, room_name || '-clone-${i}', status,
              '${pinned}'::timestamptz
         from chat.call where id = '${callId}'::uuid`,
    );
  }
}

// =========================================================================
describe('1/8/9. the account list, ordered by the server', () => {
  it('9. an actor with no calls gets an empty page, not an error', async () => {
    const page = await g.calls.historyForActor(s.parentId);

    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });

  it('1. a parent sees the calls of the conversations they are in', async () => {
    const own = await callBetween(s.parentId, s.ownerId, s.ownerId);

    const page = await g.calls.historyForActor(s.parentId);

    expect(idsOf(page)).toEqual([own.callId]);
    expect(page.items[0].conversationId).toBe(own.conversationId);
  });

  it('8. newest first, and the order is the server\'s', async () => {
    const first = await callBetween(s.parentId, s.ownerId, s.ownerId);
    const second = await callBetween(s.parentId, s.teacherId, s.teacherId);
    // Age the first so the order is unambiguous rather than same-millisecond.
    await g.prisma.$executeRawUnsafe(
      `update chat.call set started_at = now() - interval '1 hour' where id = '${first.callId}'::uuid`,
    );

    const page = await g.calls.historyForActor(s.parentId);

    expect(idsOf(page)).toEqual([second.callId, first.callId]);
  });

  it('8b. a page boundary inside identical timestamps repeats and skips nothing',
    async () => {
      // THE TIEBREAK TEST. Six calls share one `started_at`, so ordering by time
      // alone leaves their relative order arbitrary and every page boundary falls
      // inside the run. Without `id` in both the ORDER BY and the cursor, walking
      // the pages duplicates a row or loses one.
      const seed0 = await callBetween(s.parentId, s.ownerId, s.ownerId);
      await cloneCalls(seed0.callId, 5, '2026-09-28T10:00:00.000Z');

      const seen: string[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 6; page += 1) {
        const result: { items: { id: string }[]; nextCursor: string | null } =
          await g.calls.historyForActor(s.parentId, {
            limit: 2,
            ...(cursor ? { cursor } : {}),
          });
        seen.push(...idsOf(result));
        cursor = result.nextCursor;
        if (!cursor) break;
      }

      expect(seen).toHaveLength(6);
      expect(new Set(seen).size).toBe(6);
    });
});

// =========================================================================
describe('5/14. a family is not a permission — THE regression test', () => {
  it('14. two conversations share a family; the parent sees only their own', async () => {
    // Both contacts belong to the seeded family, so both conversations carry the
    // SAME family_id. Only one of them has this parent as a member.
    const mine = await callBetween(s.parentId, s.ownerId, s.ownerId);
    const theirs = await callBetween(s.otherParentId, s.ownerId, s.ownerId);

    const a = await g.prisma.conversation.findUnique({ where: { id: mine.conversationId } });
    const b = await g.prisma.conversation.findUnique({ where: { id: theirs.conversationId } });
    expect(a!.familyId).not.toBeNull();
    expect(b!.familyId).toBe(a!.familyId);
    expect(mine.conversationId).not.toBe(theirs.conversationId);

    const page = await g.calls.historyForActor(s.parentId);

    expect(idsOf(page)).toEqual([mine.callId]);
    expect(idsOf(page)).not.toContain(theirs.callId);
  });

  it('5. and the other parent sees only theirs, from the same family', async () => {
    const mine = await callBetween(s.parentId, s.ownerId, s.ownerId);
    const theirs = await callBetween(s.otherParentId, s.ownerId, s.ownerId);

    const page = await g.calls.historyForActor(s.otherParentId);

    expect(idsOf(page)).toEqual([theirs.callId]);
    expect(idsOf(page)).not.toContain(mine.callId);
  });

  it('14b. a teacher does not inherit a family\'s calls either', async () => {
    const parentAndAdmin = await callBetween(s.parentId, s.ownerId, s.ownerId);
    // Started BY the teacher: an admin initiating a teacher<->admin call is
    // refused by the coverage rule, which is the existing matrix behaving
    // correctly and not what this test is about.
    const teacherAndAdmin = await callBetween(s.teacherId, s.ownerId, s.teacherId);

    const page = await g.calls.historyForActor(s.teacherId);

    expect(idsOf(page)).toContain(teacherAndAdmin.callId);
    expect(idsOf(page)).not.toContain(parentAndAdmin.callId);
  });

  it('14c. leaving a conversation removes its calls from the account list', async () => {
    // Membership is the boundary, and it is evaluated now rather than when the
    // call happened.
    const mine = await callBetween(s.parentId, s.ownerId, s.ownerId);
    expect(idsOf(await g.calls.historyForActor(s.parentId))).toEqual([mine.callId]);

    await g.prisma.conversationMember.updateMany({
      where: { conversationId: mine.conversationId, actorId: s.parentId },
      data: { leftAt: new Date() },
    });

    expect(idsOf(await g.calls.historyForActor(s.parentId))).toEqual([]);
  });
});

// =========================================================================
describe('2/4/6. authorization, through the existing contract', () => {
  it('2. an unknown actor is refused', async () => {
    await expect(g.calls.historyForActor(randomUUID())).rejects.toMatchObject({
      code: CommErrorCode.UNKNOWN_ACTOR,
    });
  });

  it('2b. a deactivated actor is refused', async () => {
    await callBetween(s.parentId, s.ownerId, s.ownerId);
    await g.prisma.contact.update({
      where: { id: s.parentId },
      data: { isActive: false },
    });

    await expect(g.calls.historyForActor(s.parentId)).rejects.toMatchObject({
      code: CommErrorCode.ACTOR_INACTIVE,
    });
  });

  it('6. family-facing staff see the conversations the canonical rule gives them',
    async () => {
      // `listForActor` probes AuthorizationService.canRead for staff and then
      // returns the conversation set. This asserts the CONSEQUENCE — an admin
      // sees calls from conversations they are not a member of — which is the
      // existing contract ("family-facing staff may open any family
      // conversation"), not a new rule introduced here.
      const parentAndTeacher = await callBetween(s.parentId, s.teacherId, s.teacherId);

      const page = await g.calls.historyForActor(s.otherAdminId);

      expect(idsOf(page)).toContain(parentAndTeacher.callId);
    });

  it('6b. a non-family-facing staff role is refused outright', async () => {
    const financeId = randomUUID();
    await g.prisma.$executeRawUnsafe(
      `insert into chat.staff (id, name, role, is_active)
       values ('${financeId}'::uuid, 'staff_f', 'finance', true)`,
    );
    await callBetween(s.parentId, s.ownerId, s.ownerId);

    await expect(g.calls.historyForActor(financeId)).rejects.toMatchObject({
      code: CommErrorCode.ROLE_CANNOT_MESSAGE_FAMILY,
    });
  });

  it('4. an unrelated teacher sees nothing, not an error', async () => {
    await callBetween(s.parentId, s.ownerId, s.ownerId);

    const page = await g.calls.historyForActor(s.unrelatedTeacherId);

    expect(page.items).toEqual([]);
  });
});

// =========================================================================
describe('7. pagination is the server\'s', () => {
  it('7. a page carries a cursor, and the next page continues from it', async () => {
    const made: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const conv = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
      const { callId } = await g.calls.start(conv.id, s.ownerId);
      await g.prisma.$executeRawUnsafe(
        `update chat.call set started_at = now() - make_interval(mins => ${i}) where id = '${callId}'::uuid`,
      );
      made.push(callId);
    }

    const first = await g.calls.historyForActor(s.parentId, { limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    const second = await g.calls.historyForActor(s.parentId, {
      limit: 2,
      cursor: first.nextCursor!,
    });
    const third = await g.calls.historyForActor(s.parentId, {
      limit: 2,
      cursor: second.nextCursor!,
    });

    // Every call exactly once, newest first, across the pages.
    const seen = [...idsOf(first), ...idsOf(second), ...idsOf(third)];
    expect(seen).toEqual(made);
    expect(new Set(seen).size).toBe(made.length);
    expect(third.nextCursor).toBeNull();
  });

  it('7b. the last page has no cursor', async () => {
    await callBetween(s.parentId, s.ownerId, s.ownerId);

    const page = await g.calls.historyForActor(s.parentId, { limit: 10 });

    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBeNull();
  });

  it('7c. a malformed cursor returns the first page rather than failing', async () => {
    const mine = await callBetween(s.parentId, s.ownerId, s.ownerId);

    const page = await g.calls.historyForActor(s.parentId, { cursor: 'not-a-cursor' });

    expect(idsOf(page)).toEqual([mine.callId]);
  });

  it('7d. a cursor is not a capability: it cannot reach another actor\'s calls',
    async () => {
      const theirs = await callBetween(s.otherParentId, s.ownerId, s.ownerId);
      const mine = await callBetween(s.parentId, s.ownerId, s.ownerId);
      // A cursor built from a call this parent may not read.
      const stolen = Buffer.from(
        `${new Date(Date.now() + 60_000).toISOString()}|${theirs.callId}`,
        'utf8',
      ).toString('base64url');

      const page = await g.calls.historyForActor(s.parentId, { cursor: stolen });

      expect(idsOf(page)).toEqual([mine.callId]);
      expect(idsOf(page)).not.toContain(theirs.callId);
    });

  it('7e. a client cannot ask for the whole table', async () => {
    // MORE ROWS THAN THE CAP, or the assertion proves nothing: with three calls
    // present, an unclamped `limit: 100000` also returns three.
    const seed0 = await callBetween(s.parentId, s.ownerId, s.ownerId);
    await cloneCalls(seed0.callId, 104, '2026-09-28T09:00:00.000Z');

    const page = await g.calls.historyForActor(s.parentId, { limit: 100_000 });

    // Clamped to the server's maximum, not obeyed.
    expect(page.items).toHaveLength(100);
    expect(page.nextCursor).not.toBeNull();
  });

  it('7f. an absurdly small or negative limit is clamped up, not honoured',
    async () => {
      const seed0 = await callBetween(s.parentId, s.ownerId, s.ownerId);
      await cloneCalls(seed0.callId, 2, '2026-09-28T09:30:00.000Z');

      const page = await g.calls.historyForActor(s.parentId, { limit: -5 });

      expect(page.items.length).toBeGreaterThanOrEqual(1);
    });
});

// =========================================================================
describe('11/12/13. what a history row may carry', () => {
  it('11/12/13. no phone number, no room name, no token, no media handle', async () => {
    await callBetween(s.parentId, s.ownerId, s.ownerId);

    const page = await g.calls.historyForActor(s.parentId);
    const serialized = JSON.stringify(page);

    // The room name is server-minted as `jawwid-<conversation>-<uuid>` and is a
    // media handle; it must not travel with history.
    expect(serialized).not.toMatch(/jawwid-/);
    expect(serialized).not.toMatch(/roomName/i);
    expect(serialized).not.toMatch(/token/i);
    // Nothing that looks like a dialable number, in a product that has none.
    expect(serialized).not.toMatch(/\+\d[\d\s()-]{6,}/);
  });

  it('the row carries exactly the established history fields', async () => {
    await callBetween(s.parentId, s.ownerId, s.ownerId);

    const page = await g.calls.historyForActor(s.parentId);

    expect(Object.keys(page.items[0]).sort()).toEqual(
      [
        'conversationId',
        'durationSeconds',
        'endedAt',
        'id',
        'initiatorId',
        'outcome',
        'participants',
        'startedAt',
        'status',
        'type',
      ].sort(),
    );
    expect(Object.keys(page.items[0].participants[0]).sort()).toEqual(
      ['actorId', 'actorKind', 'joinedAt', 'leftAt'].sort(),
    );
  });

  it('the per-conversation endpoint and this one agree, because they share a mapper',
    async () => {
      const mine = await callBetween(s.parentId, s.ownerId, s.ownerId);

      const [fromConversation] = await g.calls.history(mine.conversationId, s.parentId);
      const page = await g.calls.historyForActor(s.parentId);

      expect(page.items[0]).toEqual(fromConversation);
    });
});

// =========================================================================
describe('3. tenancy', () => {
  it('3. cross-tenant isolation is not exercisable here, and this records why',
    async () => {
      // RT-030: `getOrCreateDirect` never sets `organization_id`, so every
      // conversation this harness can create lands in the default organization
      // and a second tenant's call cannot be produced through the service at
      // all. Asserted rather than left as a silent gap — the same statement the
      // ring-timeout suite makes.
      await callBetween(s.parentId, s.ownerId, s.ownerId);

      const organizations = new Set(
        (await g.prisma.conversation.findMany({ select: { organizationId: true } })).map(
          (c) => c.organizationId,
        ),
      );
      expect(organizations.size).toBeLessThanOrEqual(1);
    });
});
