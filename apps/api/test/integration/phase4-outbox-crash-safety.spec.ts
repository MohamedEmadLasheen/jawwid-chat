/**
 * Phase 4B — the outbox cannot lose an event, and a worker crash is not a
 * special case.
 *
 * THE DEFECT THESE TESTS EXIST FOR. Both drains used to claim a row by writing
 * its TERMINAL state and only then do the work:
 *
 *     update ... set status = 'published'   -- "claim"
 *     await this.publish(...)               -- the work
 *
 * That is a correct mutual exclusion, which is what it was written for, and an
 * incorrect claim. A worker killed between the two statements left a row saying
 * `published` that had been published to nobody -- terminal status, stamped
 * `published_at`, and nothing anywhere with a reason to look at it again. The
 * event was not delayed. It was gone.
 *
 * The old D-2 test (realtime-delivery.spec.ts) covers the case where publish
 * THROWS. That path always worked. What no test covered, and what this file
 * covers, is the case where publish neither throws nor returns -- because the
 * process stopped existing.
 *
 * HOW A CRASH IS SIMULATED. A crash is precisely "no further writes reach the
 * database from this worker". Every test below produces that by making the
 * post-claim write fail at the connection, which leaves the row in exactly the
 * state a SIGKILL leaves it in -- rather than by hand-crafting that state, which
 * would test the fixture instead of the code.
 *
 * Requires the migrated database (DATABASE_URL).
 */
import { randomUUID } from 'node:crypto';
import { PrismaService } from '@platform/prisma.service';
import { AppConfigService } from '@platform/app-config.service';
import { OutboxWorker } from '@communication/outbox/outbox.worker';
import { NotificationService } from '@communication/notifications/notification.service';
import { TemplateService } from '@communication/notifications/template.service';
import { QuietHoursService } from '@communication/notifications/quiet-hours.service';
import { LoggingPushProvider } from '@communication/notifications/push.provider';
import type { PushProvider, PushMessage, PushResult } from '@communication/notifications/push.provider';
// Imported for its environment defaults (DATABASE_URL, signing secrets), which
// every integration suite needs and which this one used to assume the shell had
// exported.
import '../integration/harness';

const prisma = new PrismaService();
const config = new AppConfigService(prisma);

/** Every publish the worker actually performed. */
class RecordingPublisher {
  readonly threads: Array<{ conversationId: string; event: string }> = [];
  shouldThrow: string | null = null;

  async toThread(conversationId: string, event: string): Promise<void> {
    if (this.shouldThrow) throw new Error(this.shouldThrow);
    this.threads.push({ conversationId, event });
  }

  async toUsers(): Promise<void> {}
}

function buildWorker(publisher: unknown, client: PrismaService = prisma): OutboxWorker {
  const notifications = new NotificationService(
    client,
    new TemplateService(client),
    new QuietHoursService(client),
    config,
    new LoggingPushProvider(),
  );
  return new OutboxWorker(
    client,
    notifications,
    publisher as never,
    { resolveActor: async () => null } as never,
    config,
  );
}

/**
 * A client that behaves normally until the worker tries to record the OUTCOME of
 * a claim, at which point every write fails as it would if the process had
 * lost its connection -- or stopped running.
 *
 * This is the crash. The claim has committed; nothing after it ever will.
 */
function clientThatDiesAfterClaiming(): PrismaService {
  let claimed = false;
  return new Proxy(prisma, {
    get(target, property) {
      if (property === '$queryRaw') {
        return async (...args: unknown[]) => {
          const rows = await (target.$queryRaw as (...a: unknown[]) => Promise<unknown>)(...args);
          claimed = true;
          return rows;
        };
      }
      if (property === 'outboxEvent') {
        return {
          ...target.outboxEvent,
          updateMany: async (...args: unknown[]) => {
            if (claimed) throw new Error('simulated worker death: connection lost');
            return (target.outboxEvent.updateMany as (...a: unknown[]) => Promise<unknown>)(...args);
          },
        };
      }
      const value = Reflect.get(target, property) as unknown;
      return typeof value === 'function' ? (value as () => unknown).bind(target) : value;
    },
  }) as PrismaService;
}

async function seedConversation(): Promise<string> {
  const suffix = randomUUID();
  const account = await prisma.account.create({
    data: { subject: `p4outbox_${suffix}`, kind: 'staff', status: 'active' },
  });
  const staff = await prisma.staff.create({
    data: { accountId: account.id, name: 'p4_outbox_admin', role: 'admin' },
  });
  const family = await prisma.family.create({
    data: { displayName: `p4_outbox_family_${suffix}`, ownerId: staff.id },
  });
  const conversation = await prisma.conversation.create({
    data: {
      type: 'direct',
      familyId: family.id,
      directKey: `p4outbox:${suffix}`,
      title: 'Jawwid',
    },
  });
  return conversation.id;
}

async function enqueue(conversationId: string): Promise<string> {
  const row = await prisma.outboxEvent.create({
    data: {
      type: 'message.created',
      payload: {
        conversationId,
        messageId: randomUUID(),
        visibility: 'external',
        authorId: null,
      },
      status: 'pending',
    },
    select: { id: true },
  });
  return row.id;
}

/** Fast-forward a lease, without sleeping through it. */
async function expireLease(id: string): Promise<void> {
  await prisma.outboxEvent.update({
    where: { id },
    data: { availableAt: new Date(Date.now() - 1000) },
  });
}

const read = (id: string) => prisma.outboxEvent.findUniqueOrThrow({ where: { id } });

let conversationId: string;

beforeAll(async () => {
  conversationId = await seedConversation();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('a worker that dies between claiming and publishing', () => {
  it('leaves the event RECOVERABLE, never marked published', async () => {
    const id = await enqueue(conversationId);

    const dying = new RecordingPublisher();
    dying.shouldThrow = 'network partition';
    // publish() throws, so the worker tries to RELEASE the row -- and that write
    // is where the process dies.
    await expect(buildWorker(dying, clientThatDiesAfterClaiming()).drain(10)).rejects.toThrow(
      /simulated worker death/,
    );

    const after = await read(id);

    // The heart of it. Under the old code this row would read
    // status='published', published_at=<a timestamp>, and no human or process
    // would ever have had a reason to look at it again.
    expect(after.status).toBe('processing');
    expect(after.publishedAt).toBeNull();
    expect(after.claimedAt).not.toBeNull();
    expect(after.attempts).toBe(1);

    // And it is genuinely held, not merely un-terminal: while the lease runs, a
    // second worker must not take it, or "at-least-once" would be "as often as
    // there are workers".
    const other = new RecordingPublisher();
    expect(await buildWorker(other).drain(10)).toBe(0);
    expect(other.threads).toHaveLength(0);

    // When the lease expires the row is due again, and the event is delivered.
    await expireLease(id);
    const recovered = new RecordingPublisher();
    expect(await buildWorker(recovered).drain(10)).toBe(1);
    expect(recovered.threads).toEqual([
      { conversationId, event: 'message.created' },
    ]);

    const final = await read(id);
    expect(final.status).toBe('published');
    expect(final.publishedAt).not.toBeNull();
    expect(final.claimedAt).toBeNull();
    expect(final.attempts).toBe(2);
  });

  it('does not mark an event published when the publisher was never reached', async () => {
    const id = await enqueue(conversationId);

    const never = new RecordingPublisher();
    never.shouldThrow = 'reached no API instance (0 subscribers)';
    await buildWorker(never).drain(10);

    const after = await read(id);
    // D-2, restated against the new lifecycle: a publish that failed returns the
    // row to the queue with the reason recorded.
    expect(after.status).toBe('pending');
    expect(after.publishedAt).toBeNull();
    expect(after.claimedAt).toBeNull();
    expect(after.lastError).toMatch(/reached no API instance/);
    expect(after.attempts).toBe(1);
    // Backed off, so the retry is not an immediate hot loop.
    expect(after.availableAt.getTime()).toBeGreaterThan(Date.now());
  });
});

describe('the claim', () => {
  it('is exclusive: two workers draining at once split the batch', async () => {
    const ids = [
      await enqueue(conversationId),
      await enqueue(conversationId),
      await enqueue(conversationId),
      await enqueue(conversationId),
    ];

    const a = new RecordingPublisher();
    const b = new RecordingPublisher();
    const [publishedByA, publishedByB] = await Promise.all([
      buildWorker(a).drain(10),
      buildWorker(b).drain(10),
    ]);

    // Every row published exactly once across both workers. `for update skip
    // locked` is what makes this true rather than the two workers serialising
    // on the same head row -- or worse, both taking it.
    expect(publishedByA + publishedByB).toBe(4);
    expect(a.threads.length + b.threads.length).toBe(4);

    for (const id of ids) {
      const row = await read(id);
      expect(row.status).toBe('published');
      expect(row.attempts).toBe(1);
    }
  });

  it('reports the POST-increment attempt count, so backoff grows with reality', async () => {
    const id = await enqueue(conversationId);
    const failing = new RecordingPublisher();
    failing.shouldThrow = 'still down';

    await buildWorker(failing).drain(10);
    const first = await read(id);
    expect(first.attempts).toBe(1);
    const firstDelay = first.availableAt.getTime() - Date.now();

    await expireLease(id);
    await buildWorker(failing).drain(10);
    const second = await read(id);
    expect(second.attempts).toBe(2);
    const secondDelay = second.availableAt.getTime() - Date.now();

    // The old code read `attempts` BEFORE incrementing it and computed the
    // backoff from that, so the second failure backed off exactly as far as the
    // first. This asserts the curve actually rises.
    expect(secondDelay).toBeGreaterThan(firstDelay);
  });

  it('parks an event as failed once its attempts are exhausted, rather than retrying forever', async () => {
    const id = await enqueue(conversationId);
    const failing = new RecordingPublisher();
    failing.shouldThrow = 'permanently broken';
    const maxAttempts = (await config.get('outbox.max_attempts' as never)) as number;

    for (let i = 0; i < maxAttempts; i += 1) {
      await expireLease(id);
      await buildWorker(failing).drain(10);
    }

    const after = await read(id);
    expect(after.status).toBe('failed');
    expect(after.attempts).toBe(maxAttempts);

    // A parked row is not picked up again: an operator decides what happens to
    // it. An infinite tight retry loop is what §13 forbids.
    await expireLease(id);
    const quiet = new RecordingPublisher();
    expect(await buildWorker(quiet).drain(10)).toBe(0);
  });
});

describe('operational visibility', () => {
  it('reports what is stuck, in counts and an age, and never a payload', async () => {
    const report = await buildWorker(new RecordingPublisher()).stuckReport();

    expect(report).toEqual({
      pending: expect.any(Number),
      processing: expect.any(Number),
      failed: expect.any(Number),
      oldestUnpublishedSeconds: report.oldestUnpublishedSeconds,
    });
    // The failed row parked by the test above is visible to an operator.
    expect(report.failed).toBeGreaterThan(0);
    expect(JSON.stringify(report)).not.toMatch(/conversationId|messageId/);
  });
});

describe('notification dispatch', () => {
  /** Counts pushes, and can fail like a provider outage. */
  class CountingPush implements PushProvider {
    sent: PushMessage[] = [];
    fail = false;
    async send(message: PushMessage): Promise<PushResult> {
      if (this.fail) return { ok: false, failureCode: 'PROVIDER_DOWN' };
      this.sent.push(message);
      return { ok: true };
    }
  }

  function notificationsWith(push: PushProvider, client: PrismaService = prisma) {
    return new NotificationService(
      client,
      new TemplateService(client),
      new QuietHoursService(client),
      config,
      push,
    );
  }

  async function scheduleOne(push: PushProvider): Promise<{ id: string; actorId: string }> {
    const actorId = randomUUID();
    await prisma.deviceToken.create({
      data: { actorId, token: `tok_${randomUUID()}`, platform: 'android' },
    });
    const id = await notificationsWith(push).schedule({
      dedupeKey: `p4:${randomUUID()}`,
      templateKey: 'new_message',
      eventType: 'message_published',
      recipientId: actorId,
      conversationId,
      scheduledAt: new Date(Date.now() - 1000),
      // Quiet hours would move the due time and make this test about the clock.
      respectQuietHours: false,
    });
    return { id, actorId };
  }

  it('a claim is a lease: the row stays reclaimable until a provider accepted it', async () => {
    const push = new CountingPush();
    const { id } = await scheduleOne(push);

    // A client that dies the moment the worker records the outcome.
    let claimed = false;
    const dying = new Proxy(prisma, {
      get(target, property) {
        if (property === '$queryRaw') {
          return async (...args: unknown[]) => {
            const rows = await (target.$queryRaw as (...a: unknown[]) => Promise<unknown>)(...args);
            claimed = true;
            return rows;
          };
        }
        if (property === 'notification') {
          return {
            ...target.notification,
            findUnique: target.notification.findUnique.bind(target.notification),
            updateMany: async (...args: unknown[]) => {
              if (claimed) throw new Error('simulated worker death');
              return (target.notification.updateMany as (...a: unknown[]) => Promise<unknown>)(
                ...args,
              );
            },
            // A crash is "no further write reaches the database from this
            // worker". Both write paths -- the success one and the failure one
            // -- must therefore fail, or dispatchDue's own error handling would
            // absorb the crash and quietly reschedule the row, which is a
            // DIFFERENT (and already-working) code path.
            update: async () => {
              if (claimed) throw new Error('simulated worker death');
              throw new Error('unreachable');
            },
          };
        }
        const value = Reflect.get(target, property) as unknown;
        return typeof value === 'function' ? (value as () => unknown).bind(target) : value;
      },
    }) as PrismaService;

    await expect(notificationsWith(push, dying).dispatchDue()).rejects.toThrow(
      /simulated worker death/,
    );

    const after = await prisma.notification.findUniqueOrThrow({ where: { id } });
    // NOT 'sent'. Under the old code this row would say sent, with a sent_at,
    // for a notification the provider may or may not have taken.
    expect(after.status).toBe('scheduled');
    expect(after.sentAt).toBeNull();
    expect(after.claimedAt).not.toBeNull();
    // Held: due in the future for the duration of the lease.
    expect(after.scheduledAt.getTime()).toBeGreaterThan(Date.now());

    // Not redispatched while the lease runs.
    const other = new CountingPush();
    expect(await notificationsWith(other).dispatchDue()).toBe(0);

    // When it expires, it is delivered -- once, and marked sent only then.
    await prisma.notification.update({
      where: { id },
      data: { scheduledAt: new Date(Date.now() - 1000) },
    });
    const recovered = new CountingPush();
    expect(await notificationsWith(recovered).dispatchDue()).toBe(1);
    expect(recovered.sent).toHaveLength(1);

    const final = await prisma.notification.findUniqueOrThrow({ where: { id } });
    expect(final.status).toBe('sent');
    expect(final.sentAt).not.toBeNull();
    expect(final.claimedAt).toBeNull();
  });

  it('the dedupe key makes a replayed source event one notification, not two', async () => {
    const push = new CountingPush();
    const actorId = randomUUID();
    const dedupeKey = `p4dedupe:${randomUUID()}`;
    const input = {
      dedupeKey,
      templateKey: 'new_message',
      eventType: 'message_published',
      recipientId: actorId,
      conversationId,
      scheduledAt: new Date(Date.now() - 1000),
      respectQuietHours: false,
    };

    const first = await notificationsWith(push).schedule(input);
    // The same outbox event, republished after a lease expired. This is the
    // exact duplicate at-least-once produces, and it must converge.
    const second = await notificationsWith(push).schedule(input);

    expect(second).toBe(first);
    expect(
      await prisma.notification.count({ where: { dedupeKey } }),
    ).toBe(1);
  });
});
