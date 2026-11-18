/**
 * RT-014 -- every membership writer locks member rows before the conversation.
 *
 * A send takes FOR SHARE on the conversation's live member rows (id order),
 * then the conversation row FOR UPDATE. A writer that locked the conversation
 * first -- a member insert's foreign-key KEY SHARE, a rename, a seat's
 * announcement -- and only THEN ended a member row could deadlock with it:
 * the send holds the row the writer wants and waits for the conversation the
 * writer holds. Postgres cancels one of them (40P01), and the send's one retry
 * does not help when the writer is the one cancelled.
 *
 * The department-room, trial-group and supervision syncs now take FOR UPDATE
 * on those member rows, in id order, before any insert, rename or removal; the
 * seat sweep takes them for every conversation it claimed before ending the
 * first seat. Proven here deterministically, each writer paused at the point
 * where it used to hold the conversation (just before its removal), a send
 * started against it, and then released: the send WAITS for the writer and
 * goes through once, nobody is cancelled, and the membership is as the writer
 * left it. Before this order the same steps deadlocked.
 *
 * "Nobody is cancelled" is checked twice: the writer's transaction commits,
 * and the send ran exactly one attempt (a cancelled send runs a second).
 */
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaAuditService } from '@platform/audit.service';
import { PrismaService } from '@platform/prisma.service';
import { ConversationSeatService } from '@communication/seats/conversation-seat.service';
import { SeatPolicyRegistry } from '@communication/seats/seat-policy';
import { DepartmentRoomService } from '../../src/org/department-room.service';
import { SupervisionConversationService } from '../../src/supervision/supervision-conversation.service';
import { TrialGroupService } from '../../src/lessons/trial-group.service';
import { CardPoster } from '../../src/supervision/card-poster';
import { buildGraph, seed, truncate, Scenario } from './harness';

jest.setTimeout(60_000);

type Tx = Prisma.TransactionClient;

const g = buildGraph();
const other = new PrismaService(); // a second pool: the writer on its own connection
const audit = new PrismaAuditService();
const rooms = new DepartmentRoomService(other, g.conversations, g.outbox);
const supervision = new SupervisionConversationService(other, g.authz, g.conversations, g.outbox, audit);
const trialGroups = new TrialGroupService(other, g.authz, g.conversations, g.outbox, new CardPoster(g.conversations, g.outbox, audit), g.config, audit);
const seats = new ConversationSeatService(other, g.authz, g.conversations, g.outbox, new SeatPolicyRegistry(), audit);

let s: Scenario;
let orgId: string;
let tmgr: string;
let tsupA: string;
let tsupB: string;
let attempts: jest.SpyInstance;

const q = <T>(sql: string, ...values: unknown[]) => g.prisma.$queryRawUnsafe<T[]>(sql, ...values);

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
const lockWaiters = async () => Number((await q<{ n: bigint }>(`select count(*) as n from pg_locks where not granted`))[0].n);

/**
 * The writer's transaction client, paused just before its removal (the first
 * conversationMember.updateMany): by then it has done everything that used to
 * lock the conversation first -- its member inserts, its rename.
 */
function pausedBeforeRemoval(tx: Tx, reached: () => void, release: Promise<void>): Tx {
  let paused = false;
  const members = new Proxy(tx.conversationMember, {
    get(target, prop) {
      if (prop === 'updateMany') {
        return async (args: Prisma.ConversationMemberUpdateManyArgs) => {
          if (!paused) {
            paused = true;
            reached();
            await release;
          }
          return target.updateMany(args);
        };
      }
      const v = Reflect.get(target, prop, target);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
  return new Proxy(tx, {
    get(target, prop) {
      if (prop === 'conversationMember') return members;
      const v = Reflect.get(target, prop, target);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}

/**
 * Run `sync` in its own transaction on the second pool, paused before its
 * removal; send `senderId`'s message into `conversationId` while it is paused;
 * release it. Returns the message and the sync's result once both are done.
 */
async function raceSyncAndSend<T>(
  conversationId: string,
  senderId: string,
  sync: (tx: Tx) => Promise<T>,
) {
  const reached = deferred();
  const release = deferred();
  const syncing = other.$transaction(
    (tx) => sync(pausedBeforeRemoval(tx, reached.resolve, release.promise)),
    { timeout: 20_000 },
  );
  await reached.promise;

  const clientMessageId = randomUUID();
  const sending = g.messages.send({ conversationId, senderId, body: 'during the sync', clientMessageId });
  // The send waits on a member row the sync holds -- before it has taken
  // anything the sync still needs.
  await waitUntil(async () => (await lockWaiters()) > 0, 'the send waits for the sync');
  release.resolve();

  const synced = await syncing; // committed: the sync was not cancelled
  const message = await sending;
  expect(attempts).toHaveBeenCalledTimes(1); // nor was the send: one attempt
  expect(await g.prisma.message.count({ where: { clientMessageId } })).toBe(1);
  expect(await lockWaiters()).toBe(0);
  return { message, synced };
}

const live = async (conversationId: string) =>
  (await g.prisma.conversationMember.findMany({ where: { conversationId, leftAt: null }, select: { actorId: true } }))
    .map((m) => m.actorId)
    .sort();
const receiptHolders = async (messageId: string) =>
  (await g.prisma.messageReceipt.findMany({ where: { messageId }, select: { actorId: true } }))
    .map((r) => r.actorId)
    .sort();
/** End a live member row directly, so the next sync adds the person back (a member insert). */
const endRow = (conversationId: string, actorId: string) =>
  g.prisma.conversationMember.updateMany({ where: { conversationId, actorId, leftAt: null }, data: { leftAt: new Date() } });
/** Operations' room, opened by a first sync: managerId, ownerId and otherAdminId. */
async function roomOf(): Promise<string> {
  const change = await other.$transaction((tx) => rooms.syncInTx(tx, s.departmentId, null));
  if (!change) throw new Error('the seed has no Operations department');
  return change.conversationId;
}
const leaveDepartment = (staffId: string) =>
  g.prisma.$executeRaw`DELETE FROM chat.department_member WHERE staff_id = ${staffId}::uuid`;

/** The Teachers department: tmgr manages, tsupA and tsupB are its supervisors. */
async function teachersDepartment() {
  [tmgr, tsupA, tsupB] = [randomUUID(), randomUUID(), randomUUID()];
  await g.prisma.$executeRawUnsafe(
    `insert into chat.staff (id, name, role, is_active) values
       ($1::uuid, 'tmgr_w', 'manager', true), ($2::uuid, 'tsup_wa', 'admin', true), ($3::uuid, 'tsup_wb', 'admin', true)`,
    tmgr, tsupA, tsupB,
  );
  const [{ id: dept }] = await q<{ id: string }>(
    `insert into chat.department (kind, display_name, manager_id) values ('teachers', 'teachers', $1::uuid) returning id::text as id`,
    tmgr,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.department_member (staff_id, organization_id, department_id, position) values
       ($1::uuid, chat.default_organization_id(), $3::uuid, 'supervisor'),
       ($2::uuid, chat.default_organization_id(), $3::uuid, 'supervisor')`,
    tsupA, tsupB, dept,
  );
}

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
  await truncate(g.prisma);
  s = await seed(g.prisma);
  g.coverage.onDutyId = s.ownerId;
  orgId = (await q<{ id: string }>(`select chat.default_organization_id()::text as id`))[0].id;
  // Both supervisors of the Teachers department sit in a teacher's rooms.
  await g.prisma.$executeRaw`UPDATE chat.config SET value = 'false'::jsonb WHERE key = 'teacher_supervisor.strict_scope'`;
  attempts = jest.spyOn(g.messages as unknown as { sendOnce: (...a: unknown[]) => Promise<unknown> }, 'sendOnce');
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe('RT-014 · a send and a sync that adds a member before it removes one', () => {
  it('department room (an insert, then a removal): the send waits for the sync; neither is cancelled', async () => {
    // Operations: managerId manages, ownerId and otherAdminId are its supervisors.
    const room = await roomOf();
    expect(await live(room)).toEqual([s.managerId, s.ownerId, s.otherAdminId].sort());

    await endRow(room, s.managerId); // the sync adds them back: a member insert
    await leaveDepartment(s.otherAdminId); // and ends this seat: a removal
    const { message, synced } = await raceSyncAndSend(room, s.ownerId, (tx) => rooms.syncInTx(tx, s.departmentId, null));

    expect(synced).toEqual({ conversationId: room, added: [s.managerId], removed: [s.otherAdminId] });
    expect(await live(room)).toEqual([s.managerId, s.ownerId].sort());
    // Ordered after the sync: the person it removed is not a recipient.
    expect(await receiptHolders(message.id)).not.toContain(s.otherAdminId);
  });

  it('department room (a rename, then a removal): the send waits for the sync; neither is cancelled', async () => {
    const room = await roomOf();
    await g.prisma.$executeRaw`UPDATE chat.department SET display_name = 'operations desk' WHERE id = ${s.departmentId}::uuid`;
    await leaveDepartment(s.otherAdminId);
    const { message, synced } = await raceSyncAndSend(room, s.ownerId, (tx) => rooms.syncInTx(tx, s.departmentId, null));

    expect(synced).toEqual({ conversationId: room, added: [], removed: [s.otherAdminId] });
    expect((await g.prisma.conversation.findUniqueOrThrow({ where: { id: room } })).title).toBe('operations desk');
    expect(await receiptHolders(message.id)).not.toContain(s.otherAdminId);
  });

  it('department room, the send first: the sync waits for it before it writes anything', async () => {
    const room = await roomOf();
    await endRow(room, s.managerId);
    await leaveDepartment(s.otherAdminId);

    const reached = deferred();
    const release = deferred();
    g.conversations.afterLiveLock = async (actorId) => {
      if (actorId !== s.ownerId) return;
      g.conversations.afterLiveLock = undefined;
      reached.resolve();
      await release.promise;
    };
    try {
      const sending = g.messages.send({ conversationId: room, senderId: s.ownerId, body: 'before the sync', clientMessageId: randomUUID() });
      await reached.promise; // the send holds its member rows and the room
      const syncing = other.$transaction((tx) => rooms.syncInTx(tx, s.departmentId, null), { timeout: 20_000 });
      await waitUntil(async () => (await lockWaiters()) > 0, 'the sync waits for the send');
      release.resolve();

      const message = await sending;
      expect(await syncing).toEqual({ conversationId: room, added: [s.managerId], removed: [s.otherAdminId] });
      expect(attempts).toHaveBeenCalledTimes(1);
      // Ordered before the sync: the removed supervisor was still a member.
      expect(await receiptHolders(message.id)).toContain(s.otherAdminId);
    } finally {
      g.conversations.afterLiveLock = undefined;
    }
  });

  it('teacher supervision conversation (an insert, then a removal): the send waits for the sync; neither is cancelled', async () => {
    await teachersDepartment();
    const conv = await other.$transaction((tx) => supervision.ensureInTx(tx, s.teacherId, orgId, null));
    expect(await live(conv.id)).toEqual([s.teacherId, tmgr, tsupA, tsupB].sort());

    await endRow(conv.id, tsupA);
    await leaveDepartment(tsupB);
    const { message } = await raceSyncAndSend(conv.id, tmgr, (tx) => supervision.ensureInTx(tx, s.teacherId, orgId, null));

    expect(await live(conv.id)).toEqual([s.teacherId, tmgr, tsupA].sort());
    expect(await receiptHolders(message.id)).not.toContain(tsupB);
  });

  it('teacher supervision conversation, the staff resync: the send waits for it; neither is cancelled', async () => {
    await teachersDepartment();
    const conv = await other.$transaction((tx) => supervision.ensureInTx(tx, s.teacherId, orgId, null));
    await endRow(conv.id, tsupA);
    await leaveDepartment(tsupB);
    const { synced } = await raceSyncAndSend(conv.id, tmgr, (tx) => supervision.resyncStaffInTx(tx, conv.id, null));

    expect(synced).toEqual({ added: [tsupA], removed: [tsupB] });
    expect(await live(conv.id)).toEqual([s.teacherId, tmgr, tsupA].sort());
  });

  it('trial group (an insert, then a removal): the send waits for the sync; neither is cancelled', async () => {
    await teachersDepartment();
    const conv = await other.$transaction((tx) => trialGroups.ensureInTx(tx, s.teacherId, orgId, null));
    expect(await live(conv.id)).toEqual([s.teacherId, tmgr, tsupA, tsupB].sort());

    await endRow(conv.id, tsupA);
    await leaveDepartment(tsupB);
    const { message } = await raceSyncAndSend(conv.id, tmgr, (tx) => trialGroups.ensureInTx(tx, s.teacherId, orgId, null));

    expect(await live(conv.id)).toEqual([s.teacherId, tmgr, tsupA].sort());
    expect(await receiptHolders(message.id)).not.toContain(tsupB);
  });

  it('trial group, the staff resync: the send waits for it; neither is cancelled', async () => {
    await teachersDepartment();
    const conv = await other.$transaction((tx) => trialGroups.ensureInTx(tx, s.teacherId, orgId, null));
    await endRow(conv.id, tsupA);
    await leaveDepartment(tsupB);
    const { synced } = await raceSyncAndSend(conv.id, tmgr, (tx) => trialGroups.resyncStaffInTx(tx, conv.id, null));

    expect(synced).toEqual({ added: [tsupA], removed: [tsupB] });
    expect(await live(conv.id)).toEqual([s.teacherId, tmgr, tsupA].sort());
  });
});

describe('RT-014 · a send and a seat sweep that ends two seats of one conversation', () => {
  it('the send waits for the sweep, which announces the first seat before it ends the second; neither is cancelled', async () => {
    const groupId = (await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId)).id;
    // Two staff seated by choice, with fixed member-row ids above every other
    // member's: a send locks the group's member rows in id order, so it holds
    // the second seat's row (…f1) when it reaches the first's (…f2).
    const [first, second] = [randomUUID(), randomUUID()];
    const rowOf = { [first]: 'ffffffff-ffff-4fff-bfff-fffffffffff2', [second]: 'ffffffff-ffff-4fff-bfff-fffffffffff1' };
    await g.prisma.$executeRawUnsafe(
      `insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'seat_w1', 'admin', true), ($2::uuid, 'seat_w2', 'admin', true)`,
      first, second,
    );
    // Seated in this order, so the sweep claims (and ends) `first` first.
    for (const staffId of [first, second]) {
      await g.prisma.conversationMember.create({
        data: { id: rowOf[staffId], conversationId: groupId, actorId: staffId, actorKind: 'staff', memberRole: 'admin', isSilent: false },
      });
      await g.prisma.$executeRawUnsafe(
        `insert into chat.conversation_seat (organization_id, conversation_id, staff_id, reason, member_id)
         values ($1::uuid, $2::uuid, $3::uuid, 'manual', $4::uuid)`,
        orgId, groupId, staffId, rowOf[staffId],
      );
    }
    // Both are due: no standing here, and silent for longer than idle_days.
    await g.prisma.$executeRawUnsafe(
      `update chat.conversation_seat set last_active_at = now() - interval '30 days' where conversation_id = $1::uuid`,
      groupId,
    );

    // Pause the sweep right after the first seat's announcement: it then holds
    // the group's row, and the second seat's member row is still to end.
    const reached = deferred();
    const release = deferred();
    const announce = g.conversations.postAnnouncement.bind(g.conversations);
    let paused = false;
    jest.spyOn(g.conversations, 'postAnnouncement').mockImplementation(async (...args) => {
      const id = await announce(...args);
      if (!paused) {
        paused = true;
        reached.resolve();
        await release.promise;
      }
      return id;
    });

    const sweeping = seats.sweep();
    await reached.promise;
    const clientMessageId = randomUUID();
    const sending = g.messages.send({ conversationId: groupId, senderId: s.parentId, body: 'during the sweep', clientMessageId });
    await waitUntil(async () => (await lockWaiters()) > 0, 'the send waits for the sweep');
    release.resolve();

    expect(await sweeping).toBe(2); // committed: the sweep was not cancelled
    const message = await sending;
    expect(attempts).toHaveBeenCalledTimes(1); // nor was the send
    expect(await g.prisma.message.count({ where: { clientMessageId } })).toBe(1);
    const holders = await receiptHolders(message.id);
    expect(holders).not.toContain(first);
    expect(holders).not.toContain(second);
    expect(await live(groupId)).not.toContain(first);
    expect(await live(groupId)).not.toContain(second);
    expect(await lockWaiters()).toBe(0);
  });
});
