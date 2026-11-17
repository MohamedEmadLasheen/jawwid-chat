/**
 * RT-014 -- a send is ordered strictly before or after a membership removal.
 *
 * The send decision (canSend) and the recipient list used to be computed from
 * reads made BEFORE the send transaction, and nothing inside it looked at
 * membership again. A removal committed between that read and the send's
 * commit was therefore invisible: the removed person could still post, and a
 * removed recipient still got a receipt.
 *
 * The send now takes FOR SHARE on the conversation's live member rows inside
 * its transaction -- before the conversation row, the order every removal path
 * uses (member row, then the conversation row its announcement locks) -- and
 * re-reads membership under those locks. Proven here deterministically, with a
 * removal held open on its own connection and row-lock waits, never timing:
 *   - removed first (written, not yet committed when the send pre-checks): the
 *     send waits, then is refused exactly as a later send would be; nothing written;
 *   - a recipient removed the same way is not given a receipt;
 *   - a removal that also locks the conversation row after its member row does
 *     not deadlock with the send;
 *   - a writer that locks the conversation first (a room sync's member insert,
 *     then a removal) does deadlock with it: Postgres cancels the send, which
 *     runs once more from the start and is sent exactly once;
 *   - a send already past its locked checks is ordered BEFORE a removal, which
 *     waits for it;
 *   - control: ordinary sends are unchanged.
 */
import { randomUUID } from 'node:crypto';
import { CommError, CommErrorCode } from '@platform/errors';
import { PrismaService } from '@platform/prisma.service';
import { buildGraph, seed, truncate, Scenario } from './harness';

jest.setTimeout(60_000);

const g = buildGraph();
const other = new PrismaService(); // a second pool: the remover on its own connection
let s: Scenario;
let groupId: string;

const q = <T>(sql: string) => g.prisma.$queryRawUnsafe<T[]>(sql);

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
async function waitUntil(cond: () => Promise<boolean>, what: string, withinMs = 10_000) {
  const end = Date.now() + withinMs;
  while (!(await cond())) {
    if (Date.now() > end) throw new Error(`timed out: ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}
const lockWaiters = async () =>
  Number((await q<{ n: bigint }>(`select count(*) as n from pg_locks where not granted`))[0].n);

async function refusalOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ALLOWED';
  } catch (e) {
    return e instanceof CommError ? e.code : String((e as Error).message);
  }
}

const removeSql = (actorId: string) =>
  `update chat.conversation_member set left_at = now()
    where conversation_id = '${groupId}'::uuid and actor_id = '${actorId}'::uuid and left_at is null`;

/**
 * A removal written and held open on its own connection. `thenLockConversation`
 * makes it behave like the removal paths that announce themselves: member row
 * first, then the conversation row (FOR UPDATE, as systemMessage takes it).
 */
async function heldRemoval(actorId: string) {
  const written = deferred();
  const lockConversation = deferred();
  const conversationLocked = deferred();
  const commit = deferred();
  let wantsConversation = false;
  const done = other.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(removeSql(actorId));
    written.resolve();
    await Promise.race([lockConversation.promise, commit.promise]);
    if (wantsConversation) {
      await tx.$queryRawUnsafe(`select 1 from chat.conversation where id = '${groupId}'::uuid for update`);
      conversationLocked.resolve();
      await commit.promise;
    }
  }, { timeout: 20_000 });
  await written.promise;
  return {
    lockConversation: async () => {
      wantsConversation = true;
      lockConversation.resolve();
      await conversationLocked.promise;
    },
    commit: async () => {
      commit.resolve();
      await done;
    },
  };
}

const receiptHolders = async (messageId: string) =>
  (await g.prisma.messageReceipt.findMany({ where: { messageId }, select: { actorId: true } }))
    .map((r) => r.actorId)
    .sort();

/** The group's live members, less `except`, sorted. */
const liveExcept = async (...except: string[]) =>
  (await g.prisma.conversationMember.findMany({ where: { conversationId: groupId, leftAt: null }, select: { actorId: true } }))
    .map((m) => m.actorId)
    .filter((id) => !except.includes(id))
    .sort();

beforeAll(async () => {
  await g.prisma.$connect();
  await other.$connect();
});
afterAll(async () => {
  await truncate(g.prisma);
  await other.$disconnect();
  await g.prisma.$disconnect();
});
beforeEach(async () => {
  g.conversations.afterLiveLock = undefined;
  await truncate(g.prisma);
  s = await seed(g.prisma);
  g.coverage.onDutyId = s.ownerId;
  groupId = (await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId)).id;
});
afterEach(() => {
  g.conversations.afterLiveLock = undefined;
});

describe('RT-014 · a send and a concurrent membership removal', () => {
  it('control: the group has the members these cases rely on, and an ordinary send reaches all of them', async () => {
    const live = (await g.prisma.conversationMember.findMany({ where: { conversationId: groupId, leftAt: null } }))
      .map((m) => m.actorId);
    expect(live).toEqual(expect.arrayContaining([s.parentId, s.otherParentId, s.teacherId, s.ownerId]));

    const m = await g.messages.send({ conversationId: groupId, senderId: s.parentId, body: 'hello', clientMessageId: randomUUID() });
    expect(await receiptHolders(m.id)).toEqual(live.filter((id) => id !== s.parentId).sort());
    expect(await lockWaiters()).toBe(0);
  });

  it('the SENDER removed after the pre-check, before the commit: the send waits, then is refused as a later send is; nothing written', async () => {
    const held = await heldRemoval(s.parentId);
    const clientMessageId = randomUUID();
    const outcome = refusalOf(
      g.messages.send({ conversationId: groupId, senderId: s.parentId, body: 'raced', clientMessageId }),
    );
    await waitUntil(async () => (await lockWaiters()) > 0, 'the send waits on the member row being removed');
    await held.commit();

    expect(await outcome).toBe(CommErrorCode.NOT_CONVERSATION_MEMBER);
    expect(await g.prisma.message.count({ where: { clientMessageId } })).toBe(0);
    // The same answer the pre-check gives once the removal is visible to it.
    expect(
      await refusalOf(g.messages.send({ conversationId: groupId, senderId: s.parentId, body: 'later', clientMessageId: randomUUID() })),
    ).toBe(CommErrorCode.NOT_CONVERSATION_MEMBER);
  });

  it('a RECIPIENT removed after the pre-check, before the commit: the message is sent and the removed member gets no receipt', async () => {
    const expected = await liveExcept(s.parentId, s.otherParentId);
    const held = await heldRemoval(s.otherParentId);
    const sending = g.messages.send({ conversationId: groupId, senderId: s.parentId, body: 'to the group', clientMessageId: randomUUID() });
    await waitUntil(async () => (await lockWaiters()) > 0, 'the send waits on the member row being removed');
    await held.commit();

    const m = await sending;
    const holders = await receiptHolders(m.id);
    expect(holders).not.toContain(s.otherParentId);
    expect(holders).toEqual(expected);
    expect(holders).toEqual(expect.arrayContaining([s.ownerId, s.teacherId]));
  });

  it('a removal that locks the conversation row after its member row (as an announcing removal does) does not deadlock with the send', async () => {
    const held = await heldRemoval(s.otherParentId);
    const sending = g.messages.send({ conversationId: groupId, senderId: s.parentId, body: 'no deadlock', clientMessageId: randomUUID() });
    await waitUntil(async () => (await lockWaiters()) > 0, 'the send waits on the member row being removed');
    // The send holds nothing the removal needs: it waits on the member row
    // BEFORE taking the conversation row, so the removal gets it at once.
    await held.lockConversation();
    await held.commit();

    const m = await sending;
    expect(await receiptHolders(m.id)).not.toContain(s.otherParentId);
  });

  it('a room sync that locks the conversation (a member insert) before removing someone deadlocks with the send: the send is cancelled, runs again, and is sent once', async () => {
    const expected = await liveExcept(s.parentId, s.otherParentId);
    const keyShared = deferred();
    const removeNow = deferred();
    const removed = deferred();
    const commit = deferred();
    const sync = other.$transaction(async (tx) => {
      // Postgres cancels whichever waiter's deadlock check runs first. The
      // send's runs after the default deadlock_timeout (1 s); the sync's is
      // put far later, so the victim is always the send -- the case under test.
      await tx.$executeRawUnsafe(`set local deadlock_timeout = '30s'`);
      // The lock a conversation_member insert's foreign-key check takes on its
      // conversation (department-room, trial-group and supervision syncs add
      // a member before they remove one).
      await tx.$queryRawUnsafe(`select 1 from chat.conversation where id = '${groupId}'::uuid for key share`);
      keyShared.resolve();
      await removeNow.promise;
      await tx.$executeRawUnsafe(removeSql(s.otherParentId));
      removed.resolve();
      await commit.promise;
    }, { timeout: 30_000 });
    await keyShared.promise;

    const clientMessageId = randomUUID();
    const sending = g.messages.send({ conversationId: groupId, senderId: s.parentId, body: 'deadlocked once', clientMessageId });
    // The send holds its FOR SHARE on the member rows and waits for the
    // conversation row, which the sync's KEY SHARE blocks.
    await waitUntil(async () => (await lockWaiters()) > 0, 'the send waits on the conversation row');
    removeNow.resolve();
    // The removal waits on the send's FOR SHARE: a cycle. It can only go
    // through once the send's transaction is gone -- and that transaction
    // cannot commit while it waits on the sync -- so reaching here means
    // Postgres cancelled the send (40P01) and rolled it back.
    await removed.promise;
    commit.resolve();
    await sync;

    // Not a 500: the send ran again from the start and went through, once,
    // on the membership the sync committed.
    const m = await sending;
    expect(await g.prisma.message.count({ where: { clientMessageId } })).toBe(1);
    expect(await g.prisma.message.count({ where: { conversationId: groupId, body: 'deadlocked once' } })).toBe(1);
    const holders = await receiptHolders(m.id);
    expect(holders).not.toContain(s.otherParentId);
    expect(holders).toEqual(expected);
    expect(
      (await g.prisma.conversationMember.findFirst({ where: { conversationId: groupId, actorId: s.otherParentId } }))?.leftAt,
    ).not.toBeNull();
  });

  it('a send already past its locked checks is ordered BEFORE a removal, which waits for it', async () => {
    const reached = deferred();
    const release = deferred();
    g.conversations.afterLiveLock = async (actorId) => {
      if (actorId !== s.parentId) return;
      g.conversations.afterLiveLock = undefined;
      reached.resolve();
      await release.promise;
    };
    const clientMessageId = randomUUID();
    const sending = g.messages.send({ conversationId: groupId, senderId: s.parentId, body: 'first', clientMessageId });
    await reached.promise;

    let removed = false;
    const removal = other.$executeRawUnsafe(removeSql(s.otherParentId)).then(() => (removed = true));
    await waitUntil(async () => (await lockWaiters()) > 0, 'the removal waits for the send');
    expect(removed).toBe(false);

    release.resolve();
    const m = await sending;
    await removal;
    expect(removed).toBe(true);
    // Ordered before the removal: they were a member when it was sent.
    expect(await receiptHolders(m.id)).toContain(s.otherParentId);
    expect(await g.prisma.message.count({ where: { clientMessageId } })).toBe(1);
  });

  it('control: a staff send and a parent send go through as before, with nobody removed', async () => {
    const fromStaff = await g.messages.send({ conversationId: groupId, senderId: s.ownerId, body: 'from staff', clientMessageId: randomUUID() });
    expect(await receiptHolders(fromStaff.id)).toEqual(await liveExcept(s.ownerId));
    const fromParent = await g.messages.send({ conversationId: groupId, senderId: s.parentId, body: 'from parent', clientMessageId: randomUUID() });
    expect(await receiptHolders(fromParent.id)).toEqual(await liveExcept(s.parentId));
    // An internal note still reaches staff members only.
    const note = await g.messages.send({
      conversationId: groupId, senderId: s.ownerId, body: 'note', visibility: 'internal', clientMessageId: randomUUID(),
    });
    const noteHolders = await receiptHolders(note.id);
    for (const nonStaff of [s.parentId, s.otherParentId, s.teacherId]) expect(noteHolders).not.toContain(nonStaff);
    expect(await lockWaiters()).toBe(0);
  });
});
