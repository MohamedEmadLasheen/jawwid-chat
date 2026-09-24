/**
 * D-2 regression — an outbox event may only become `published` if it was
 * actually delivered somewhere.
 *
 * The defect: RealtimeGateway.toThread() emits with `this.server?.to(...)`.
 * The standalone worker (createApplicationContext) has no Socket.IO server, so
 * `server` was undefined and the optional chain made every emit a silent no-op.
 * OutboxWorker.drain() claims the row as `published` up front and only reverts
 * it when publish() THROWS -- and a no-op does not throw. Every realtime event
 * was recorded as delivered and delivered to nobody.
 *
 * Requires Redis (REDIS_URL) and the migrated database (DATABASE_URL).
 */
import Redis from 'ioredis';
import { PrismaService } from '@platform/prisma.service';
import { OutboxWorker } from '@communication/outbox/outbox.worker';
import { RelayRealtimePublisher } from '../../src/infra/realtime/relay.publisher';
import { realtimeChannel, decodeEnvelope } from '../../src/infra/realtime/realtime-channel';
import type { RealtimeGateway } from '@communication/realtime/realtime.gateway';

const REDIS_URL = process.env.REALTIME_TEST_REDIS_URL ?? 'redis://localhost:6410';

/**
 * A channel nobody else can be listening on. Redis pub/sub is global to the
 * SERVER -- selecting another database does not isolate it -- so without this a
 * locally running API would be subscribed to the real channel and the "nobody
 * is listening" test would pass for the wrong reason. It did, before this.
 */
process.env.QUEUE_PREFIX = `jest-${process.pid}-${Date.now()}`;

/** A gateway with no Socket.IO server attached — exactly the worker's situation. */
const serverlessGateway = { server: undefined } as unknown as RealtimeGateway;

describe('D-2 · realtime delivery from a process with no Socket.IO server', () => {
  let subscriber: Redis;

  beforeAll(() => {
    subscriber = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
  });

  afterAll(async () => {
    await subscriber.quit().catch(() => undefined);
  });

  it('THROWS when no API instance is subscribed — the event must not be marked published', async () => {
    process.env.REDIS_URL = REDIS_URL;
    const publisher = new RelayRealtimePublisher(serverlessGateway);
    await expect(
      publisher.toThread('conv-1', 'message.created' as never, {} as never),
    ).rejects.toThrow(/reached no API instance/);
    await publisher.onModuleDestroy();
  });

  it('resolves when an API instance is relaying, and delivers the envelope intact', async () => {
    process.env.REDIS_URL = REDIS_URL;
    const received: string[] = [];
    await subscriber.subscribe(realtimeChannel());
    subscriber.on('message', (_c, raw) => received.push(raw));
    // Redis registers the subscription asynchronously.
    await new Promise((r) => setTimeout(r, 200));

    const publisher = new RelayRealtimePublisher(serverlessGateway);
    await expect(
      publisher.toThread('conv-42', 'message.created' as never, { id: 'm1' } as never),
    ).resolves.toBeUndefined();

    await new Promise((r) => setTimeout(r, 300));
    const envelope = received.map(decodeEnvelope).find((e) => e?.ids.includes('conv-42'));
    expect(envelope).toBeDefined();
    expect(envelope?.target).toBe('room');
    expect(envelope?.event).toBe('message.created');

    await subscriber.unsubscribe(realtimeChannel());
    await publisher.onModuleDestroy();
  });

  it('delegates to the gateway, and does NOT use Redis, when this process owns the server', async () => {
    const emitted: string[] = [];
    const withServer = {
      server: {},
      toThread: async (id: string, event: string) => {
        emitted.push(`${event}->${id}`);
      },
      toUsers: async () => undefined,
    } as unknown as RealtimeGateway;

    const publisher = new RelayRealtimePublisher(withServer);
    // No subscriber is attached. If this took the Redis path it would throw.
    await expect(
      publisher.toThread('conv-local', 'message.created' as never, {} as never),
    ).resolves.toBeUndefined();
    expect(emitted).toEqual(['message.created->conv-local']);
    await publisher.onModuleDestroy();
  });
});

describe('D-2 · a failed publish returns the event to the outbox', () => {
  const prisma = new PrismaService();

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('leaves the row pending with the error recorded, never published', async () => {
    const conversationId = await prisma.conversation
      .findFirst({ select: { id: true } })
      .then((c) => c?.id);
    if (!conversationId) throw new Error('no conversation in the test database');

    const event = await prisma.outboxEvent.create({
      data: {
        type: 'message.created',
        payload: { conversationId, messageId: '00000000-0000-0000-0000-000000000001' },
        status: 'pending',
      },
      select: { id: true },
    });

    const alwaysFails = {
      toThread: async () => {
        throw new Error('reached no API instance (0 subscribers)');
      },
      toUsers: async () => {
        throw new Error('reached no API instance (0 subscribers)');
      },
    };
    const notifications = { schedule: async () => ({ notificationId: '', created: false }) } as never;
    const identity = { resolveActor: async () => null } as never;
    const recipients = { forConversation: async () => [] } as never;
    // Presence is Redis-backed; the worker must not depend on it to publish.
    const presence = { isViewing: async () => false } as never;

    // The schedule service is unreachable on this path: the event under test is
    // a realtime publish, not a class event.
    const schedule = {} as never;
    const worker = new OutboxWorker(
      prisma, notifications, recipients, presence, alwaysFails as never, identity, schedule,
    );
    await worker.drain(50);

    const after = await prisma.outboxEvent.findUnique({ where: { id: event.id } });
    // The whole point of D-2.
    expect(after?.status).not.toBe('published');
    expect(after?.publishedAt).toBeNull();
    expect(after?.status).toBe('pending');
    expect(after?.attempts).toBeGreaterThan(0);
    expect(after?.lastError ?? '').toMatch(/reached no API instance/);

    await prisma.outboxEvent.delete({ where: { id: event.id } });
  });
});
