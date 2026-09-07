/**
 * PHASE 5 -- broadcast: audience, queue, fan-out, retry, deduplication,
 * delivery tracking and partial failure.
 *
 * The shape this suite exists to prove is NOT happening:
 *
 *     for (const family of families) await sendMessage(family)
 *
 * inside the creating request. Creating a broadcast writes a ledger and
 * returns; a leased worker delivers; one failing recipient fails only itself.
 */
import { randomUUID } from 'node:crypto';
import { PrismaService } from '@platform/prisma.service';
import { CommErrorCode } from '@platform/errors';
import { buildGraph, seed, truncate, Scenario } from './harness';
import {
  AudienceKind,
  BroadcastRecipientStatus,
  BroadcastState,
  Origin,
} from '@communication/contracts/vocab';

const prisma = new PrismaService();
const g = buildGraph();
let s: Scenario;

const actorOf = async (id: string) => (await g.identity.resolveActor(id))!;

beforeEach(async () => {
  await truncate(prisma);
  s = await seed(prisma);
  g.coverage.onDutyId = s.ownerId;
  // Every recipient needs somewhere for the message to land. The broadcast
  // resolves this at CREATION, not during delivery.
  await g.conversations.getOrCreateDirect(s.ownerId, s.parentId);
});
afterAll(async () => {
  await truncate(prisma);
  await prisma.$disconnect();
});

const compose = (audiences: Array<{ kind: string; refId?: string | null }>, extra = {}) => ({
  title: 'Closure',
  body: 'The academy is closed on Monday.',
  audiences,
  ...extra,
});

/** Create, queue and drain until nothing is left. Bounded so a bug cannot hang. */
async function deliver(broadcastId: string): Promise<void> {
  await g.broadcasts.queue(broadcastId, s.managerId);
  for (let i = 0; i < 20; i += 1) {
    if ((await g.broadcastWorker.drain()) === 0) break;
  }
}

describe('authorization', () => {
  it('a manager may broadcast', async () => {
    const b = await g.broadcasts.create(s.managerId, compose([{ kind: AudienceKind.ALL_FAMILIES }]));
    expect(b.state).toBe(BroadcastState.DRAFT);
  });

  it('an ADMIN may not -- Phase 5 did not widen broadcasts.send', async () => {
    // Implementing the feature was not taken as licence to widen who may use it.
    await expect(
      g.broadcasts.create(s.ownerId, compose([{ kind: AudienceKind.ASSIGNED_FAMILIES }])),
    ).rejects.toMatchObject({ code: CommErrorCode.PERMISSION_DENIED });
  });

  it('a parent may not', async () => {
    await expect(
      g.broadcasts.create(s.parentId, compose([{ kind: AudienceKind.ALL_FAMILIES }])),
    ).rejects.toMatchObject({ code: CommErrorCode.PERMISSION_DENIED });
  });

  it('a granted admin is STILL narrowed to their own scope by the resolver', async () => {
    // The second, independent check: even with the permission, the audience
    // resolver refuses a clause outside the author's live scope.
    await prisma.$executeRawUnsafe(
      `insert into chat.account_permission_override (account_id, permission, effect, reason)
       values ('${s.accounts[s.ownerId]}'::uuid, 'broadcasts.send', 'allow', 'pilot')`,
    );
    await expect(
      g.broadcasts.create(s.ownerId, compose([{ kind: AudienceKind.ALL_FAMILIES }])),
    ).rejects.toMatchObject({ code: CommErrorCode.AUDIENCE_TOO_BROAD });

    // ...and their own families still work.
    const b = await g.broadcasts.create(
      s.ownerId,
      compose([{ kind: AudienceKind.ASSIGNED_FAMILIES }]),
    );
    expect(b.recipientCount).toBeGreaterThan(0);
  });
});

describe('audience resolution and deduplication', () => {
  it('a MIXED audience reaches each person exactly once', async () => {
    // The brief's example: family + group + label all matching one household
    // must still be ONE message.
    const manager = await actorOf(s.managerId);
    const label = await g.labels.create(manager, { name: 'Installments' });
    await g.labels.addFamilies(manager, label.id, [s.familyId]);
    const group = await g.groups.create(manager, { name: 'Thursday', ownerId: s.ownerId });
    await g.groups.addMember(manager, group.id, s.learnerId);

    const b = await g.broadcasts.create(
      s.managerId,
      compose([
        { kind: AudienceKind.FAMILY, refId: s.familyId },
        { kind: AudienceKind.GROUP, refId: group.id },
        { kind: AudienceKind.LABEL, refId: label.id },
        { kind: AudienceKind.ALL_TEACHERS },
      ]),
    );

    const rows = await prisma.broadcastRecipient.findMany({ where: { broadcastId: b.id } });
    // Two contacts + two teachers. Not six.
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((r) => r.actorId)).size).toBe(4);
  });

  it('the DATABASE makes a duplicate recipient impossible', async () => {
    const b = await g.broadcasts.create(
      s.managerId,
      compose([{ kind: AudienceKind.FAMILY, refId: s.familyId }]),
    );
    await expect(
      prisma.$executeRawUnsafe(
        `insert into chat.broadcast_recipient (broadcast_id, actor_id, matched_kind)
         values ('${b.id}'::uuid, '${s.parentId}'::uuid, 'family')`,
      ),
    ).rejects.toThrow();
  });

  it('preview answers with the SAME resolver that will deliver', async () => {
    const clauses = [{ kind: AudienceKind.ALL_FAMILIES }];
    const preview = await g.broadcasts.preview(s.managerId, clauses);
    const b = await g.broadcasts.create(s.managerId, compose(clauses));
    expect(b.recipientCount).toBe(preview.recipientCount);
  });

  it('a forged family id is refused', async () => {
    await expect(
      g.broadcasts.create(
        s.managerId,
        compose([{ kind: AudienceKind.FAMILY, refId: randomUUID() }]),
      ),
    ).rejects.toMatchObject({ code: CommErrorCode.AUDIENCE_TARGET_NOT_FOUND });
  });

  it('a forged group id is refused', async () => {
    await expect(
      g.broadcasts.create(
        s.managerId,
        compose([{ kind: AudienceKind.GROUP, refId: randomUUID() }]),
      ),
    ).rejects.toMatchObject({ code: CommErrorCode.AUDIENCE_TARGET_NOT_FOUND });
  });
});

describe('the request does not deliver', () => {
  it('creating writes a ledger and sends nothing', async () => {
    const before = await prisma.message.count();
    const b = await g.broadcasts.create(s.managerId, compose([{ kind: AudienceKind.ALL_FAMILIES }]));

    expect(await prisma.message.count()).toBe(before);
    const rows = await prisma.broadcastRecipient.findMany({ where: { broadcastId: b.id } });
    expect(rows.every((r) => r.status === BroadcastRecipientStatus.PENDING)).toBe(true);
  });

  it('queueing makes recipients claimable and still sends nothing', async () => {
    const before = await prisma.message.count();
    const b = await g.broadcasts.create(s.managerId, compose([{ kind: AudienceKind.ALL_FAMILIES }]));
    const queued = await g.broadcasts.queue(b.id, s.managerId);

    expect(queued.state).toBe(BroadcastState.QUEUED);
    expect(await prisma.message.count()).toBe(before);
  });
});

describe('fan-out', () => {
  it('delivers one message per recipient and completes', async () => {
    const b = await g.broadcasts.create(
      s.managerId,
      compose([{ kind: AudienceKind.FAMILY, refId: s.familyId }]),
    );
    await deliver(b.id);

    const status = await g.broadcasts.status(b.id, s.managerId);
    expect(status.state).toBe(BroadcastState.COMPLETED);
    expect(status.sentCount).toBe(status.recipientCount);
    expect(status.failedCount).toBe(0);

    const rows = await prisma.broadcastRecipient.findMany({ where: { broadcastId: b.id } });
    for (const row of rows) {
      expect(row.status).toBe(BroadcastRecipientStatus.SENT);
      expect(row.messageId).not.toBeNull();
      expect(row.sentAt).not.toBeNull();
    }
  });

  it('the delivered message is marked as coming from a broadcast', async () => {
    const b = await g.broadcasts.create(
      s.managerId,
      compose([{ kind: AudienceKind.FAMILY, refId: s.familyId }]),
    );
    await deliver(b.id);

    const row = await prisma.broadcastRecipient.findFirstOrThrow({
      where: { broadcastId: b.id, messageId: { not: null } },
    });
    const message = await prisma.message.findUniqueOrThrow({ where: { id: row.messageId! } });
    // Distinguishable from a person typing, in the database and every client.
    expect(message.origin).toBe(Origin.BROADCAST);
    expect(message.body).toBe('The academy is closed on Monday.');
  });

  it('schedules exactly one notification per recipient', async () => {
    const b = await g.broadcasts.create(
      s.managerId,
      compose([{ kind: AudienceKind.FAMILY, refId: s.familyId }]),
    );
    await deliver(b.id);

    const notifications = await prisma.notification.findMany({
      where: { dedupeKey: { startsWith: `broadcast:${b.id}:` } },
    });
    expect(notifications).toHaveLength(2);
  });

  it('re-draining after completion delivers nothing more', async () => {
    const b = await g.broadcasts.create(
      s.managerId,
      compose([{ kind: AudienceKind.FAMILY, refId: s.familyId }]),
    );
    await deliver(b.id);
    const messages = await prisma.message.count();

    expect(await g.broadcastWorker.drain()).toBe(0);
    expect(await prisma.message.count()).toBe(messages);
  });
});

describe('idempotency', () => {
  it('a retried create with the same key returns the FIRST broadcast', async () => {
    // A manager's phone retrying a timed-out POST must not send the same
    // announcement to every family twice.
    const first = await g.broadcasts.create(
      s.managerId,
      compose([{ kind: AudienceKind.ALL_FAMILIES }], { idempotencyKey: 'monday-closure' }),
    );
    const second = await g.broadcasts.create(
      s.managerId,
      compose([{ kind: AudienceKind.ALL_FAMILIES }], { idempotencyKey: 'monday-closure' }),
    );

    expect(second.id).toBe(first.id);
    expect(await prisma.broadcast.count()).toBe(1);
  });

  it('the DATABASE refuses a duplicate idempotency key', async () => {
    await g.broadcasts.create(
      s.managerId,
      compose([{ kind: AudienceKind.ALL_FAMILIES }], { idempotencyKey: 'monday-closure' }),
    );
    await expect(
      prisma.$executeRawUnsafe(
        `insert into chat.broadcast (body, created_by, idempotency_key)
         values ('again', '${s.managerId}'::uuid, 'monday-closure')`,
      ),
    ).rejects.toThrow();
  });

  it('a redelivered lease does NOT write a second message', async () => {
    // The at-least-once window the lease deliberately accepts: crash after the
    // message is written, before the status is confirmed. `message_id` is the
    // anchor that makes the retry a no-op.
    const b = await g.broadcasts.create(
      s.managerId,
      compose([{ kind: AudienceKind.FAMILY, refId: s.familyId }]),
    );
    await deliver(b.id);
    const messages = await prisma.message.count();

    // Simulate the crash: the message exists, the row is back in the queue.
    await prisma.broadcastRecipient.updateMany({
      where: { broadcastId: b.id },
      data: {
        status: BroadcastRecipientStatus.QUEUED,
        availableAt: new Date(Date.now() - 1000),
        claimedBy: null,
      },
    });
    await prisma.broadcast.updateMany({
      where: { id: b.id },
      data: { state: BroadcastState.QUEUED },
    });

    await g.broadcastWorker.drain();
    expect(await prisma.message.count()).toBe(messages);
  });

  it('queueing twice is not an error', async () => {
    const b = await g.broadcasts.create(s.managerId, compose([{ kind: AudienceKind.ALL_FAMILIES }]));
    await g.broadcasts.queue(b.id, s.managerId);
    const again = await g.broadcasts.queue(b.id, s.managerId);
    expect(again.state).toBe(BroadcastState.QUEUED);
  });
});

describe('failure isolation and partial failure', () => {
  it('one unreachable recipient does not stop the others', async () => {
    const b = await g.broadcasts.create(
      s.managerId,
      compose([{ kind: AudienceKind.FAMILY, refId: s.familyId }]),
    );
    // One recipient has nowhere for a message to land: a PERMANENT failure that
    // retrying cannot fix.
    await prisma.broadcastRecipient.updateMany({
      where: { broadcastId: b.id, actorId: s.otherParentId },
      data: { conversationId: null },
    });

    await deliver(b.id);

    const status = await g.broadcasts.status(b.id, s.managerId);
    // partial_failure is a REAL terminal answer, not a rounding in either
    // direction: one person got it and one did not.
    expect(status.state).toBe(BroadcastState.PARTIAL_FAILURE);
    expect(status.sentCount).toBe(1);
    expect(status.failedCount).toBe(1);

    const failed = await prisma.broadcastRecipient.findFirstOrThrow({
      where: { broadcastId: b.id, actorId: s.otherParentId },
    });
    expect(failed.failureCode).toBe('NO_CONVERSATION');
    // Parked immediately: the attempt budget is kept for failures retrying can fix.
    expect(failed.attempts).toBe(1);
  });

  it('an inactive recipient is parked, not retried forever', async () => {
    const b = await g.broadcasts.create(
      s.managerId,
      compose([{ kind: AudienceKind.FAMILY, refId: s.familyId }]),
    );
    await prisma.contact.updateMany({ where: { id: s.otherParentId }, data: { isActive: false } });

    await deliver(b.id);

    const row = await prisma.broadcastRecipient.findFirstOrThrow({
      where: { broadcastId: b.id, actorId: s.otherParentId },
    });
    expect(row.status).toBe(BroadcastRecipientStatus.FAILED);
    expect(row.failureCode).toBe('RECIPIENT_INACTIVE');
  });

  it('a broadcast where every recipient fails is FAILED, not partial', async () => {
    const b = await g.broadcasts.create(
      s.managerId,
      compose([{ kind: AudienceKind.FAMILY, refId: s.familyId }]),
    );
    await prisma.broadcastRecipient.updateMany({
      where: { broadcastId: b.id },
      data: { conversationId: null },
    });
    await deliver(b.id);

    expect((await g.broadcasts.status(b.id, s.managerId)).state).toBe(BroadcastState.FAILED);
  });
});

describe('retry and the lease', () => {
  it('a claim is a LEASE -- it does not mark the recipient sent', async () => {
    const b = await g.broadcasts.create(s.managerId, compose([{ kind: AudienceKind.ALL_FAMILIES }]));
    await g.broadcasts.queue(b.id, s.managerId);

    // Freeze delivery by removing the conversation AFTER queueing, so the
    // worker claims and then fails.
    const rows = await prisma.broadcastRecipient.findMany({ where: { broadcastId: b.id } });
    expect(rows.every((r) => r.status === BroadcastRecipientStatus.QUEUED)).toBe(true);
    expect(rows.every((r) => r.sentAt === null)).toBe(true);
  });

  it('a recipient whose lease lapsed is reclaimed rather than lost', async () => {
    const b = await g.broadcasts.create(
      s.managerId,
      compose([{ kind: AudienceKind.FAMILY, refId: s.familyId }]),
    );
    await g.broadcasts.queue(b.id, s.managerId);

    // A worker took the row and died: claimed, lease in the past, nothing else.
    await prisma.broadcastRecipient.updateMany({
      where: { broadcastId: b.id },
      data: {
        claimedAt: new Date(Date.now() - 120_000),
        claimedBy: 'a-worker-that-died',
        availableAt: new Date(Date.now() - 60_000),
        attempts: 1,
      },
    });

    for (let i = 0; i < 5; i += 1) {
      if ((await g.broadcastWorker.drain()) === 0) break;
    }

    const rows = await prisma.broadcastRecipient.findMany({ where: { broadcastId: b.id } });
    // Reclaimed and delivered. Nothing was lost to the crash.
    expect(rows.every((r) => r.status === BroadcastRecipientStatus.SENT)).toBe(true);
  });

  it('a cancelled broadcast stops being claimed', async () => {
    const b = await g.broadcasts.create(s.managerId, compose([{ kind: AudienceKind.ALL_FAMILIES }]));
    await g.broadcasts.queue(b.id, s.managerId);
    await g.broadcasts.cancel(b.id, s.managerId, 'sent by mistake');

    expect(await g.broadcastWorker.drain()).toBe(0);
    expect((await g.broadcasts.status(b.id, s.managerId)).state).toBe(BroadcastState.CANCELLED);
  });

  it('cancelling never un-sends what was already delivered', async () => {
    const b = await g.broadcasts.create(
      s.managerId,
      compose([{ kind: AudienceKind.FAMILY, refId: s.familyId }]),
    );
    await deliver(b.id);
    // Already completed, so cancelling is refused outright.
    await expect(g.broadcasts.cancel(b.id, s.managerId, 'too late')).rejects.toMatchObject({
      code: CommErrorCode.BROADCAST_INVALID_STATE,
    });
  });

  it('cancelling requires a reason', async () => {
    const b = await g.broadcasts.create(s.managerId, compose([{ kind: AudienceKind.ALL_FAMILIES }]));
    await expect(g.broadcasts.cancel(b.id, s.managerId, '')).rejects.toMatchObject({
      code: CommErrorCode.APPROVAL_REASON_REQUIRED,
    });
  });
});

describe('delivery tracking', () => {
  it('SENT is not DELIVERED -- an insert is never promoted to an acknowledgement', async () => {
    const b = await g.broadcasts.create(
      s.managerId,
      compose([{ kind: AudienceKind.FAMILY, refId: s.familyId }]),
    );
    await deliver(b.id);

    const status = await g.broadcasts.status(b.id, s.managerId);
    expect(status.sentCount).toBe(2);
    // Nothing has acknowledged anything yet.
    expect(status.deliveredCount).toBe(0);
  });

  it('only a real acknowledgement moves a recipient to DELIVERED', async () => {
    const b = await g.broadcasts.create(
      s.managerId,
      compose([{ kind: AudienceKind.FAMILY, refId: s.familyId }]),
    );
    await deliver(b.id);

    await g.broadcastWorker.markDelivered(b.id, s.parentId);

    const status = await g.broadcasts.status(b.id, s.managerId);
    expect(status.deliveredCount).toBe(1);
    // A delivered recipient was also sent to, so the sent count does not FALL
    // as confirmations arrive -- which would read as messages being un-sent.
    expect(status.sentCount).toBe(2);
  });

  it('a caller cannot acknowledge on somebody else’s behalf', async () => {
    const b = await g.broadcasts.create(
      s.managerId,
      compose([{ kind: AudienceKind.FAMILY, refId: s.familyId }]),
    );
    await deliver(b.id);

    await g.broadcastWorker.markDelivered(b.id, randomUUID());
    expect((await g.broadcasts.status(b.id, s.managerId)).deliveredCount).toBe(0);
  });

  it('status reports the full picture for an operator', async () => {
    const b = await g.broadcasts.create(
      s.managerId,
      compose([{ kind: AudienceKind.FAMILY, refId: s.familyId }]),
    );
    const before = await g.broadcasts.status(b.id, s.managerId);
    expect(before.pendingCount).toBe(2);

    await deliver(b.id);

    const after = await g.broadcasts.status(b.id, s.managerId);
    expect(after.pendingCount).toBe(0);
    expect(after.recipientCount).toBe(2);
    expect(after.completedAt).not.toBeNull();
    expect(after.audiences).toHaveLength(1);
  });
});
