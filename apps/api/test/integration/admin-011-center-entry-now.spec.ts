/**
 * ADMIN-011 (P2): a producer not yet on the PD-34 pipeline (payments, stories,
 * PD-30 notices, cover and onboarding notices...) writes only a delivery row
 * through NotificationService.schedule. The Center used to adopt that row only
 * once its push was SENT or finally FAILED -- for a parent with no device
 * token, after five retries, about 15 minutes late. In production every
 * parent lacks a token until the APNs key exists.
 *
 * Now the entry is written when the row is scheduled for now, independent of
 * push, and exactly once whatever the push does after. A row scheduled for
 * later (a reminder) still waits until it is due, since it may yet be
 * cancelled; and a row whose push has failed is adopted at once, however far
 * the retry moved it. Synthetic people only.
 */
import { randomUUID } from 'node:crypto';
import { NotificationPipeline } from '@communication/notifications/notification-pipeline.service';
import { NotificationService } from '@communication/notifications/notification.service';
import type { PushProvider } from '@communication/notifications/push.provider';
import { buildGraph, seed, truncate, Scenario } from './harness';

jest.setTimeout(60_000);

const g = buildGraph();
const silent = { toThread: async () => undefined, toUsers: async () => undefined };
const MIN = 60_000;
let s: Scenario;

/** A NotificationService on its own push provider, with the pipeline listening to it as production wires it. */
function wired(push: PushProvider) {
  const notifications = new NotificationService(g.prisma, g.templates, g.quietHours, g.config, push);
  const pipeline = new NotificationPipeline(g.prisma, notifications, g.quietHours, g.config, g.identity, silent as never);
  return { notifications, pipeline };
}

const ok: PushProvider = { send: async () => ({ ok: true }) } as PushProvider;
const rejecting: PushProvider = { send: async () => ({ ok: false }) } as PushProvider;

/** What payment-ledger.service.ts schedules when a payment is recorded. */
const paymentReceived = (notifications: NotificationService, at = new Date()) =>
  notifications.schedule({
    dedupeKey: `payment_received:${randomUUID()}:${s.parentId}`,
    templateKey: 'payment_received',
    eventType: 'payment_received',
    recipientId: s.parentId,
    locale: 'en',
    priority: 'normal',
    familyId: s.familyId,
    variables: { amount: '100.00', currency: 'EGP', invoice_number: 'JW-TEST-1' },
    scheduledAt: at,
  });

const entries = () => g.prisma.notificationItem.findMany({ where: { recipientId: s.parentId } });
const delivery = (id: string) => g.prisma.notification.findUniqueOrThrow({ where: { id } });
async function addToken() {
  const [{ org }] = await g.prisma.$queryRawUnsafe<Array<{ org: string }>>(`select chat.default_organization_id()::text as org`);
  await g.prisma.deviceToken.create({ data: { organizationId: org, actorId: s.parentId, token: `admin011-${randomUUID()}`, platform: 'ios' } });
}

/** Runs the dispatcher until the row leaves SCHEDULED (each retry is due "later": move the clock past it). */
async function drain(notifications: NotificationService, id: string) {
  for (let i = 0; i < 10; i++) {
    const row = await delivery(id);
    if (row.status !== 'scheduled') return row;
    await notifications.dispatchDue(new Date(row.scheduledAt.getTime() + 1000));
  }
  throw new Error('the delivery never left scheduled');
}

beforeAll(async () => {
  await g.prisma.$connect();
});
afterAll(async () => {
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`truncate chat.notification_item cascade`);
  await g.prisma.$disconnect();
});
beforeEach(async () => {
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`truncate chat.notification_item cascade`);
  s = await seed(g.prisma);
});

describe('ADMIN-011: the Center entry is written at once, independent of push', () => {
  it('no device token: the entry is there at once, linked; the retries add nothing', async () => {
    const { notifications, pipeline } = wired(ok);
    const id = (await paymentReceived(notifications))!;

    const now = await entries();
    expect(now).toHaveLength(1);
    expect(now[0]).toMatchObject({ dedupeKey: (await delivery(id)).dedupeKey, category: 'payment', cancelledAt: null });
    expect(now[0]!.visibleAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect((await delivery(id)).itemId).toBe(now[0]!.id);

    const done = await drain(notifications, id);
    expect(done).toMatchObject({ status: 'failed', failureCode: 'NO_DEVICE_TOKEN' });
    expect(await pipeline.adoptLegacy(new Date(Date.now() + 60 * MIN))).toBe(0);
    expect(await entries()).toHaveLength(1);
  });

  it('a token and a failing push: the entry at once, and exactly one after every retry', async () => {
    const { notifications, pipeline } = wired(rejecting);
    await addToken();
    const id = (await paymentReceived(notifications))!;
    expect(await entries()).toHaveLength(1);

    const done = await drain(notifications, id);
    expect(done).toMatchObject({ status: 'failed', failureCode: 'PUSH_REJECTED' });
    expect(await pipeline.adoptLegacy(new Date(Date.now() + 60 * MIN))).toBe(0);
    expect(await entries()).toHaveLength(1);
  });

  it('push success: one entry, before and after the push', async () => {
    const { notifications, pipeline } = wired(ok);
    await addToken();
    const id = (await paymentReceived(notifications))!;
    expect(await entries()).toHaveLength(1);

    expect((await drain(notifications, id)).status).toBe('sent');
    expect(await pipeline.adoptLegacy()).toBe(0);
    expect(await entries()).toHaveLength(1);
  });

  it('scheduling the same delivery again (a replayed producer) adds no second entry', async () => {
    const { notifications } = wired(ok);
    const key = `payment_received:${randomUUID()}:${s.parentId}`;
    const input = {
      dedupeKey: key, templateKey: 'payment_received', eventType: 'payment_received', recipientId: s.parentId,
      locale: 'en', familyId: s.familyId, variables: { amount: '1', currency: 'EGP', invoice_number: 'X' }, scheduledAt: new Date(),
    };
    const a = await notifications.schedule(input);
    const b = await notifications.schedule(input);
    expect(b).toBe(a);
    expect(await entries()).toHaveLength(1);
  });

  it('a row scheduled for later is not shown before it is due -- it may yet be cancelled', async () => {
    const { notifications, pipeline } = wired(ok);
    const id = (await paymentReceived(notifications, new Date(Date.now() + 60 * MIN)))!;
    expect(await entries()).toHaveLength(0);
    expect(await pipeline.adoptLegacy()).toBe(0);
    expect((await delivery(id)).itemId).toBeNull();
  });

  it('the sweep backstop: a row whose push failed is adopted at once, however far its retry moved it', async () => {
    // Written past the listener (a producer in a process without the pipeline), then failed once.
    const row = await g.prisma.notification.create({
      data: {
        dedupeKey: `payment_received:${randomUUID()}:${s.parentId}`, templateKey: 'payment_received', eventType: 'payment_received',
        recipientId: s.parentId, locale: 'en', status: 'scheduled', attempts: 1, failureCode: 'NO_DEVICE_TOKEN',
        scheduledAt: new Date(Date.now() + 4 * MIN),
      },
    });
    const { pipeline } = wired(ok);
    expect(await pipeline.adoptLegacy()).toBe(1);
    const [entry] = await entries();
    expect(entry!.visibleAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect((await delivery(row.id)).itemId).toBe(entry!.id);
    expect(await pipeline.adoptLegacy()).toBe(0);
  });

  it('RECIPIENT_INACTIVE: the entry is written at once and withdrawn when dispatch cancels the push (RT-032)', async () => {
    const { notifications } = wired(ok);
    const account = await g.prisma.account.create({ data: { subject: `p-${randomUUID()}@admin011.test`, kind: 'family', status: 'suspended', isActive: false } });
    await g.prisma.contact.update({ where: { id: s.parentId }, data: { accountId: account.id } });
    const id = (await paymentReceived(notifications))!;
    expect(await entries()).toHaveLength(1);

    expect(await drain(notifications, id)).toMatchObject({ status: 'cancelled', failureCode: 'RECIPIENT_INACTIVE' });
    const [entry] = await entries();
    expect(entry).toMatchObject({ cancelReason: 'RECIPIENT_INACTIVE' });
    expect(entry!.cancelledAt).not.toBeNull();
  });

  it('the race: the worker cancels the delivery between the read and the link -- the entry is withdrawn, never left visible', async () => {
    const { pipeline } = wired(ok);
    const row = await g.prisma.notification.create({
      data: {
        dedupeKey: `payment_received:${randomUUID()}:${s.parentId}`, templateKey: 'payment_received', eventType: 'payment_received',
        recipientId: s.parentId, locale: 'en', status: 'scheduled', scheduledAt: new Date(),
      },
    });
    // The entry is created; the cancel lands right after, before the link.
    const create = g.prisma.notificationItem.create.bind(g.prisma.notificationItem);
    const spy = jest.spyOn(g.prisma.notificationItem, 'create').mockImplementation(((args: never) =>
      create(args).then(async (item) => {
        await g.prisma.notification.update({ where: { id: row.id }, data: { status: 'cancelled', failureCode: 'RECIPIENT_INACTIVE' } });
        return item;
      })) as never);
    try {
      await pipeline.scheduled(row.id, new Date(Date.now() - 1000));
    } finally {
      spy.mockRestore();
    }
    expect((await delivery(row.id)).itemId).toBeNull();
    const [entry] = await entries();
    expect(entry!.cancelledAt).not.toBeNull();
    expect(entry!.cancelReason).toBe('RECIPIENT_INACTIVE');
    expect(await pipeline.adoptLegacy()).toBe(0);
  });

  it('a listener that throws never fails the producer: the delivery is scheduled and its id returned', async () => {
    const { notifications } = wired(ok);
    notifications.onScheduled({ scheduled: async () => { throw new Error('listener down'); } });
    const id = await paymentReceived(notifications);
    expect(id).toEqual(expect.any(String));
    expect((await delivery(id!)).status).toBe('scheduled');
    expect(await entries()).toHaveLength(0);
  });

  it('the immediate path and the sweep at once: one entry, linked, whichever wins', async () => {
    const row = await g.prisma.notification.create({
      data: {
        dedupeKey: `payment_received:${randomUUID()}:${s.parentId}`, templateKey: 'payment_received', eventType: 'payment_received',
        recipientId: s.parentId, locale: 'en', status: 'scheduled', attempts: 1, failureCode: 'NO_DEVICE_TOKEN',
        scheduledAt: new Date(Date.now() + 4 * MIN),
      },
    });
    const { pipeline } = wired(ok);
    const [, adopted] = await Promise.all([pipeline.scheduled(row.id, new Date(Date.now() - 1000)), pipeline.adoptLegacy()]);
    const all = await entries();
    expect(all).toHaveLength(1);
    expect((await delivery(row.id)).itemId).toBe(all[0]!.id);
    expect(adopted).toBeLessThanOrEqual(1);
    expect(await pipeline.adoptLegacy()).toBe(0);
  });
});
