/**
 * A notification's delivery and open are reported by ITS RECIPIENT only.
 * `POST /notifications/:id/delivered` used to take the id alone, so any
 * authenticated caller could rewrite another person's delivery state (found by
 * the parallel branch's scoped-read work, ported here). Synthetic people only.
 */
import { randomUUID } from 'node:crypto';
import { buildGraph, seed, truncate, Scenario } from './harness';

jest.setTimeout(60_000);

const g = buildGraph();
let s: Scenario;

beforeAll(async () => {
  await g.prisma.$connect();
});
afterAll(async () => {
  await truncate(g.prisma);
  await g.prisma.$disconnect();
});
beforeEach(async () => {
  await truncate(g.prisma);
  s = await seed(g.prisma);
});

async function sentTo(recipientId: string): Promise<string> {
  const n = await g.prisma.notification.create({
    data: {
      dedupeKey: `test-${randomUUID()}`,
      templateKey: 'new_message',
      eventType: 'message.created',
      recipientId,
      scheduledAt: new Date(),
      sentAt: new Date(),
      status: 'sent',
    },
  });
  return n.id;
}
const statusOf = async (id: string) => (await g.prisma.notification.findUniqueOrThrow({ where: { id } })).status;

it("another person cannot mark a parent's notification delivered or opened", async () => {
  const id = await sentTo(s.parentId);
  await g.notifications.markDelivered(id, s.otherParentId);
  await g.notifications.markOpened(id, s.teacherId);
  expect(await statusOf(id)).toBe('sent');
});

it('the recipient can, in order', async () => {
  const id = await sentTo(s.parentId);
  await g.notifications.markDelivered(id, s.parentId);
  expect(await statusOf(id)).toBe('delivered');
  await g.notifications.markOpened(id, s.parentId);
  expect(await statusOf(id)).toBe('opened');
});

it('a malformed id changes nothing and does not error', async () => {
  await expect(g.notifications.markDelivered('not-a-uuid', s.parentId)).resolves.toBeUndefined();
  await expect(g.notifications.markOpened('not-a-uuid', s.parentId)).resolves.toBeUndefined();
});
