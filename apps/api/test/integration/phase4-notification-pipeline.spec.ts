/**
 * Phase 4D — the notification pipeline, end to end, and the production path
 * that runs it.
 *
 * ## Why this file exists (F-1)
 *
 * The Phase 4 closure audit found that at Phase 4 HEAD `src/worker.ts` ran
 * exactly one loop — `outbox.drain()` — and NOTHING called
 * `NotificationService.dispatchDue()`. Notifications were scheduled into
 * `chat.notification` with status `scheduled` and never dispatched: no push
 * would have been sent even with FCM and APNs fully credentialed. Every unit of
 * the pipeline was tested and the pipeline was not connected.
 *
 * The dispatch loop is now in the worker, added by the Phase 5 broadcast
 * commit, and it is deliberately NOT reimplemented here — duplicating it would
 * give the system two loops claiming the same rows. What Phase 4 owes instead
 * is coverage that (a) the whole path produces a push, and (b) the production
 * entrypoint actually invokes it, so the behaviour cannot quietly disappear in
 * a later refactor of a file this phase does not own.
 *
 * Requires the migrated database (DATABASE_URL).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ts from 'typescript';
import { buildGraph, seed, truncate, Scenario } from './harness';
import { OutboxWorker } from '@communication/outbox/outbox.worker';
import { NotificationService } from '@communication/notifications/notification.service';
import { NotificationPreferenceService } from '@communication/notifications/preference.service';
import { TemplateService } from '@communication/notifications/template.service';
import { QuietHoursService } from '@communication/notifications/quiet-hours.service';
import type {
  PushMessage,
  PushProvider,
  PushResult,
} from '@communication/notifications/push.provider';
import type { RealtimePublisher } from '@communication/realtime/realtime.publisher';

const g = buildGraph();
let s: Scenario;
let conversationId: string;

class SilentPublisher implements RealtimePublisher {
  async toThread(): Promise<void> {}
  async toUsers(): Promise<void> {}
}

class CapturingPush implements PushProvider {
  readonly sent: PushMessage[] = [];
  async send(message: PushMessage): Promise<PushResult> {
    this.sent.push(message);
    return { ok: true };
  }
}

let push: CapturingPush;
let notifications: NotificationService;
let preferences: NotificationPreferenceService;
let worker: OutboxWorker;

beforeEach(async () => {
  await truncate(g.prisma);
  s = await seed(g.prisma);
  // The family's owner is on duty, so the send is authorized by the ordinary
  // rule rather than by an assist or an escalation. This suite is about what
  // happens AFTER a message is accepted.
  g.coverage.onDutyId = s.ownerId;
  conversationId = (await g.conversations.getOrCreateDirect(s.ownerId, s.parentId)).id;

  push = new CapturingPush();
  preferences = new NotificationPreferenceService(g.prisma);
  notifications = new NotificationService(
    g.prisma,
    new TemplateService(g.prisma),
    new QuietHoursService(g.prisma),
    g.config,
    push,
    preferences,
  );
  // The same two units the production worker drives, in the same order.
  worker = new OutboxWorker(
    g.prisma,
    notifications,
    new SilentPublisher(),
    g.identity,
    g.config,
  );

  await g.prisma.deviceToken.create({
    data: { actorId: s.parentId, token: `tok_${Date.now()}`, platform: 'android' },
  });
});

afterAll(async () => {
  await g.prisma.$disconnect();
});

/** Everything the worker process does in one tick, in production order. */
async function workerTick(): Promise<void> {
  await worker.drain();
  await notifications.dispatchDue();
}

describe('the whole path: a message becomes a push', () => {
  it('event → outbox → schedule → dispatch → preference → provider', async () => {
    await g.messages.send({
      conversationId,
      senderId: s.ownerId,
      body: 'your class starts at six',
      clientMessageId: 'pipeline-1',
    });

    // Before the worker runs, nothing has been pushed. The message is
    // committed; the notification is not yet a row.
    expect(push.sent).toEqual([]);

    await workerTick();

    // One push, to the recipient — never to the author.
    expect(push.sent).toHaveLength(1);
    const sent = push.sent[0];
    expect(sent.platform).toBe('android');
    // Grouped by conversation and collapsible, so a redelivery replaces rather
    // than stacks.
    expect(sent.threadId).toBe(conversationId);
    expect(sent.collapseId).toEqual(expect.any(String));
    // Routing data only. The body of the message is NOT in the payload.
    expect(sent.data.conversationId).toBe(conversationId);
    expect(JSON.stringify(sent.data)).not.toContain('your class starts at six');
  });

  it('a recipient who turned messages off gets no push from the same path', async () => {
    await preferences.set(s.parentId, 'messages', false);

    await g.messages.send({
      conversationId,
      senderId: s.ownerId,
      body: 'hello',
      clientMessageId: 'pipeline-2',
    });
    await workerTick();

    // Suppressed where the notification was GENERATED, so nothing ever reached
    // a provider — not filtered on the device after the phone had buzzed.
    expect(push.sent).toEqual([]);
    const row = await g.prisma.notification.findFirst({
      where: { recipientId: s.parentId },
    });
    expect(row?.status).toBe('suppressed');
  });

  it('a muted conversation produces no notification row at all', async () => {
    await g.prisma.conversationParticipantState.upsert({
      where: { conversationId_actorId: { conversationId, actorId: s.parentId } },
      create: {
        conversationId,
        actorId: s.parentId,
        mutedUntil: new Date(Date.now() + 3_600_000),
      },
      update: { mutedUntil: new Date(Date.now() + 3_600_000) },
    });

    await g.messages.send({
      conversationId,
      senderId: s.ownerId,
      body: 'hello',
      clientMessageId: 'pipeline-3',
    });
    await workerTick();

    expect(push.sent).toEqual([]);
    // Mute is applied earlier than a preference: the outbox worker never
    // schedules the notification, so there is no row rather than a suppressed
    // one.
    expect(
      await g.prisma.notification.count({ where: { recipientId: s.parentId } }),
    ).toBe(0);
  });

  it('a second tick does not push the same message again', async () => {
    await g.messages.send({
      conversationId,
      senderId: s.ownerId,
      body: 'hello',
      clientMessageId: 'pipeline-4',
    });

    await workerTick();
    await workerTick();

    // The outbox row is published and the notification is sent; neither is due
    // again. This is the dedupe key and the lease doing their jobs together.
    expect(push.sent).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// The production path
// ---------------------------------------------------------------------------

describe('the worker process actually runs the dispatch', () => {
  /**
   * Asserted against the SOURCE of `src/worker.ts`, parsed rather than grepped.
   *
   * WHY NOT EXECUTE IT. `worker.ts` is an entrypoint: it calls `bootstrap()` at
   * module load, builds a Nest application context and enters an unbounded
   * polling loop. Importing it from a test would start a real worker against
   * the test database and never return. Making it importable would mean
   * changing a file this phase does not own, for the benefit of a test.
   *
   * WHY NOT A REGEX. A comment mentioning `dispatchDue` would satisfy one. The
   * TypeScript compiler is already a dependency, so this looks for an actual
   * call expression and cannot be satisfied by prose.
   *
   * WHAT IT PROTECTS. F-1 was invisible precisely because every unit was tested
   * and nothing tested the wiring. If a later refactor drops the dispatch call,
   * this fails and names why.
   */
  function callsInWorker(): Set<string> {
    const path = join(__dirname, '../../src/worker.ts');
    const source = ts.createSourceFile(
      path,
      readFileSync(path, 'utf8'),
      ts.ScriptTarget.ES2022,
      true,
    );

    const called = new Set<string>();
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        called.add(node.expression.name.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    return called;
  }

  it('invokes NotificationService.dispatchDue()', () => {
    expect([...callsInWorker()]).toContain('dispatchDue');
  });

  it('invokes OutboxWorker.drain()', () => {
    expect([...callsInWorker()]).toContain('drain');
  });

  it('the guard discriminates — it is not satisfied by any name at all', () => {
    // A guard that always passes protects nothing. This proves the walker
    // reports the calls that are there and only those, so removing
    // `dispatchDue` really does turn the test above red.
    expect([...callsInWorker()]).not.toContain('dispatchNotificationsSomehow');
  });

  it('resolves NotificationService from the application context', () => {
    const source = readFileSync(join(__dirname, '../../src/worker.ts'), 'utf8');
    // Resolving it is what makes the call above reach the same instance the
    // rest of the process uses, rather than a second one with its own state.
    expect(source).toMatch(/app\.get\(\s*NotificationService\s*\)/);
  });
});
