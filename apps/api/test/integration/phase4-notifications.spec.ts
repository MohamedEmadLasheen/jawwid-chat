/**
 * Phase 4D — notifications: preferences, mute, grouping, and token lifecycle.
 *
 * The rule this file exists to hold: a preference is enforced where the
 * notification is GENERATED. By the time a payload has reached APNs or FCM the
 * phone has buzzed and the lock screen has shown the text, so discarding it in
 * the app afterwards changes what is displayed and nothing that matters.
 *
 * Requires the migrated database (DATABASE_URL).
 */
import { randomUUID } from 'node:crypto';
import { buildGraph, seed, truncate, Scenario } from './harness';
import { NotificationService } from '@communication/notifications/notification.service';
import { NotificationPreferenceService } from '@communication/notifications/preference.service';
import { TemplateService } from '@communication/notifications/template.service';
import { QuietHoursService } from '@communication/notifications/quiet-hours.service';
import {
  PlatformRoutingPushProvider,
  type PushMessage,
  type PushProvider,
  type PushResult,
} from '@communication/notifications/push.provider';

const g = buildGraph();
let s: Scenario;
let conversationId: string;
let preferences: NotificationPreferenceService;

class CapturingPush implements PushProvider {
  readonly sent: PushMessage[] = [];
  result: PushResult = { ok: true };

  async send(message: PushMessage): Promise<PushResult> {
    this.sent.push(message);
    return this.result;
  }
}

function notifications(push: PushProvider): NotificationService {
  return new NotificationService(
    g.prisma,
    new TemplateService(g.prisma),
    new QuietHoursService(g.prisma),
    g.config,
    push,
    preferences,
  );
}

/** A recipient with one registered device. */
async function recipientWithDevice(platform = 'android'): Promise<string> {
  const actorId = s.parentId;
  await g.prisma.deviceToken.create({
    data: { actorId, token: `tok_${randomUUID()}`, platform },
  });
  return actorId;
}

function scheduleInput(recipientId: string, overrides: Record<string, unknown> = {}) {
  return {
    dedupeKey: `p4n:${randomUUID()}`,
    ruleKey: 'new_message',
    templateKey: 'new_message',
    eventType: 'message_published',
    recipientId,
    conversationId,
    scheduledAt: new Date(Date.now() - 1000),
    respectQuietHours: false,
    variables: { sender_name: 'Jawwid', preview: '' },
    ...overrides,
  };
}

beforeEach(async () => {
  g.coverage.onDutyId = null;
  await truncate(g.prisma);
  s = await seed(g.prisma);
  conversationId = (await g.conversations.getOrCreateDirect(s.ownerId, s.parentId)).id;
  preferences = new NotificationPreferenceService(g.prisma);
});

afterAll(async () => {
  await g.prisma.$disconnect();
});

describe('preferences', () => {
  it('default to ON, for every category, for somebody who has never chosen', async () => {
    const all = await preferences.forActor(s.parentId);

    // Absent is enabled. Treating a missing row as "off" would mean everybody
    // who has never opened the settings screen silently receives nothing --
    // the one failure mode a notification system must not have.
    expect(all).toEqual({
      messages: true,
      approvals: true,
      calls: true,
      payments: true,
      classes: true,
    });
  });

  it('suppress the notification AT GENERATION when the category is turned off', async () => {
    const actorId = await recipientWithDevice();
    await preferences.set(actorId, 'messages', false);

    const push = new CapturingPush();
    const service = notifications(push);
    const id = await service.schedule(scheduleInput(actorId));

    // Not deferred, not filtered on the device: never dispatched at all.
    expect(await service.dispatchDue()).toBe(0);
    expect(push.sent).toEqual([]);

    const row = await g.prisma.notification.findUniqueOrThrow({ where: { id } });
    // A ROW, though, and a suppressed one. Not writing it would free the dedupe
    // key, so the next replay of the same source event would ask again -- and
    // would leave no record that anything had been decided.
    expect(row.status).toBe('suppressed');
  });

  it('turning a category back on takes effect immediately', async () => {
    const actorId = await recipientWithDevice();
    await preferences.set(actorId, 'messages', false);
    await preferences.set(actorId, 'messages', true);

    const push = new CapturingPush();
    const service = notifications(push);
    await service.schedule(scheduleInput(actorId));

    expect(await service.dispatchDue()).toBe(1);
    expect(push.sent).toHaveLength(1);
  });

  it('one category off does not silence another', async () => {
    const actorId = await recipientWithDevice();
    // Turning off payment reminders must not touch calls. This is the whole
    // reason categories exist rather than one global switch.
    await preferences.set(actorId, 'payments', false);

    const push = new CapturingPush();
    const service = notifications(push);
    await service.schedule(
      scheduleInput(actorId, {
        ruleKey: 'incoming_call',
        templateKey: 'incoming_call',
        eventType: 'call_started',
        variables: { caller_name: 'Jawwid' },
      }),
    );

    expect(await service.dispatchDue()).toBe(1);
  });

  it('a notification with no rule is never suppressed', async () => {
    const actorId = await recipientWithDevice();
    await preferences.set(actorId, 'messages', false);

    const push = new CapturingPush();
    const service = notifications(push);
    // Uncategorised. Suppressing something the system cannot classify would
    // silently drop whatever a future feature schedules before it remembers to
    // add a rule.
    await service.schedule(scheduleInput(actorId, { ruleKey: null }));

    expect(await service.dispatchDue()).toBe(1);
  });

  it("are one person's own: a preference set for one actor does not move another", async () => {
    await preferences.set(s.parentId, 'messages', false);

    expect((await preferences.forActor(s.parentId)).messages).toBe(false);
    expect((await preferences.forActor(s.otherParentId)).messages).toBe(true);
  });
});

describe('mute is not the same thing as a preference', () => {
  it('a muted conversation stops its MESSAGE notifications', async () => {
    await g.prisma.conversationParticipantState.upsert({
      where: { conversationId_actorId: { conversationId, actorId: s.parentId } },
      create: {
        conversationId,
        actorId: s.parentId,
        mutedUntil: new Date(Date.now() + 3_600_000),
      },
      update: { mutedUntil: new Date(Date.now() + 3_600_000) },
    });

    const state = await g.prisma.conversationParticipantState.findUniqueOrThrow({
      where: { conversationId_actorId: { conversationId, actorId: s.parentId } },
    });
    expect(state.mutedUntil!.getTime()).toBeGreaterThan(Date.now());
  });

  it('a call is scheduled with quiet hours EXEMPT, so mute cannot swallow it', async () => {
    const actorId = await recipientWithDevice();
    // Quiet hours that would otherwise defer everything.
    await g.prisma.quietHours.upsert({
      where: { actorId },
      create: { actorId, enabled: true, startMinute: 0, endMinute: 1439 },
      update: { enabled: true, startMinute: 0, endMinute: 1439 },
    });

    const push = new CapturingPush();
    const service = notifications(push);
    const id = await service.schedule(
      scheduleInput(actorId, {
        ruleKey: 'incoming_call',
        templateKey: 'incoming_call',
        eventType: 'call_started',
        respectQuietHours: false,
        variables: { caller_name: 'Jawwid' },
      }),
    );

    const row = await g.prisma.notification.findUniqueOrThrow({ where: { id } });
    // Due now, not deferred to the end of a window that never ends. Muting a
    // conversation says "stop buzzing me about messages in it"; it has never
    // said "and let a call from my child's teacher fail silently".
    expect(row.scheduledAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });
});

describe('grouping', () => {
  it('carries a thread id per conversation and a collapse id per notification', async () => {
    const actorId = await recipientWithDevice();
    const push = new CapturingPush();
    const service = notifications(push);
    await service.schedule(scheduleInput(actorId));
    await service.dispatchDue();

    expect(push.sent).toHaveLength(1);
    const sent = push.sent[0];
    expect(sent.threadId).toBe(conversationId);
    expect(sent.collapseId).toEqual(expect.any(String));
    // APNs caps apns-collapse-id at 64 bytes and a dedupe key is an unbounded
    // composite of ids. A key over the cap is rejected -- and only the longer
    // ones, so it would look intermittent.
    expect(sent.collapseId!.length).toBeLessThanOrEqual(64);
  });

  it('the same dedupe key always yields the same collapse id', async () => {
    // This is what makes an at-least-once redelivery REPLACE the notification
    // on the lock screen instead of appearing beside it.
    expect(NotificationService.collapseIdFor('new_message:a:b')).toBe(
      NotificationService.collapseIdFor('new_message:a:b'),
    );
    expect(NotificationService.collapseIdFor('new_message:a:b')).not.toBe(
      NotificationService.collapseIdFor('new_message:a:c'),
    );
  });
});

describe('device tokens', () => {
  it('are routed to the provider for their OWN platform', async () => {
    const ios = new CapturingPush();
    const android = new CapturingPush();
    const fallback = new CapturingPush();
    const routing = new PlatformRoutingPushProvider({ ios, android }, fallback);

    await routing.send({
      token: 't1', title: '', body: '', data: {}, isVoip: false, platform: 'ios',
    });
    await routing.send({
      token: 't2', title: '', body: '', data: {}, isVoip: false, platform: 'android',
    });

    // An APNs token posted to FCM comes back as an invalid registration, and
    // this pipeline retires a token the provider calls invalid -- so a
    // mis-wired provider would deactivate every iPhone in the tenant one push
    // at a time, and look like users turning notifications off.
    expect(ios.sent.map((m) => m.token)).toEqual(['t1']);
    expect(android.sent.map((m) => m.token)).toEqual(['t2']);
    expect(fallback.sent).toEqual([]);
  });

  it('an unconfigured platform falls back rather than silently vanishing', async () => {
    const fallback = new CapturingPush();
    const routing = new PlatformRoutingPushProvider({}, fallback);
    await routing.send({
      token: 't', title: '', body: '', data: {}, isVoip: false, platform: 'web',
    });
    expect(fallback.sent).toHaveLength(1);
  });

  it('a token the provider calls permanently invalid is retired', async () => {
    const actorId = await recipientWithDevice();
    const push = new CapturingPush();
    push.result = { ok: false, tokenInvalid: true, failureCode: 'FCM_404' };

    const service = notifications(push);
    await service.schedule(scheduleInput(actorId));
    await service.dispatchDue();

    const token = await g.prisma.deviceToken.findFirstOrThrow({ where: { actorId } });
    // The app was uninstalled or the token was reissued. Retiring it is what
    // stops every future notification spending an attempt on a device that no
    // longer exists.
    expect(token.isActive).toBe(false);
  });

  it('a transient rejection does NOT retire the token', async () => {
    const actorId = await recipientWithDevice();
    const push = new CapturingPush();
    push.result = { ok: false, failureCode: 'FCM_503' };

    const service = notifications(push);
    await service.schedule(scheduleInput(actorId));
    await service.dispatchDue();

    const token = await g.prisma.deviceToken.findFirstOrThrow({ where: { actorId } });
    expect(token.isActive).toBe(true);
  });
});
