/**
 * WHICH DEVICE A CALL ACTUALLY REACHES — the whole pipeline, against the
 * database.
 *
 * THE DEFECT THIS SUITE EXISTS FOR. `NotificationService.deliver` sent every
 * notification to EVERY active token of the recipient. So a parent with an
 * iPhone held two tokens — a standard APNs one and a PushKit one — and a new
 * message was delivered to both. On iOS a PushKit delivery that does not
 * immediately report a call to CallKit does not merely fail: the system
 * terminates the app, and repeat offences revoke the VoIP entitlement. A chatty
 * conversation was therefore a self-inflicted crash loop and an App Review
 * rejection waiting to happen.
 *
 * WHAT IS REAL HERE: the database, the real outbox worker, the real (frozen)
 * call producers, the real notification engine, the real routing rule. Only the
 * transport is recorded instead of sent — this suite proves WHO a push is
 * addressed to, never that Apple or Google delivered it. Real provider delivery
 * is W8-W4's and is claimed nowhere in this file.
 */
import { OutboxWorker } from "@communication/outbox/outbox.worker";
import { NotificationService } from "@communication/notifications/notification.service";
import { NoopRealtimePublisher } from "@communication/realtime/realtime.publisher";
import type {
  PushMessage,
  PushProvider,
  PushResult,
} from "@communication/notifications/push.provider";
import { Scenario, buildGraph, seed, truncate } from "./harness";

jest.setTimeout(60_000);

const g = buildGraph();
let s: Scenario;

class RecordingPush implements PushProvider {
  readonly sent: PushMessage[] = [];
  rejectAs: "invalid" | "error" | null = null;

  async send(message: PushMessage): Promise<PushResult> {
    this.sent.push(message);
    if (this.rejectAs === "invalid") return { ok: false, tokenInvalid: true };
    if (this.rejectAs === "error") return { ok: false, failureCode: "TRANSIENT" };
    return { ok: true };
  }

  reset(): void {
    this.sent.length = 0;
    this.rejectAs = null;
  }
}

const push = new RecordingPush();
let notifications: NotificationService;
let worker: OutboxWorker;

const drainOutbox = () => worker.drain(100);

beforeAll(async () => {
  await g.prisma.$connect();
  notifications = new NotificationService(
    g.prisma,
    g.templates,
    g.quietHours,
    g.config,
    push,
  );
  worker = new OutboxWorker(
    g.prisma,
    notifications,
    new NoopRealtimePublisher(),
    g.identity,
  );
});
afterAll(async () => {
  await g.prisma.outboxEvent.deleteMany({});
  await g.prisma.notification.deleteMany({});
  await g.prisma.$disconnect();
});
beforeEach(async () => {
  await truncate(g.prisma);
  s = await seed(g.prisma);
  g.coverage.onDutyId = s.ownerId;
  push.reset();
});

/** Register one device for an actor. */
const device = (
  actorId: string,
  token: string,
  platform: string,
  isVoip: boolean,
) => notifications.registerDevice({ actorId, token, platform, isVoip });

/** A teacher -> parent call, which schedules `incoming_call` for the parent. */
async function directCall() {
  const conv = await g.conversations.getOrCreateDirect(s.parentId, s.teacherId);
  const { callId } = await g.calls.start(conv.id, s.teacherId);
  return { conversationId: conv.id, callId };
}

/** A group call in the Student Group, which schedules `group_call_started`. */
async function groupCall() {
  const group = await g.conversations.ensureStudentGroup(s.learnerId);
  const { callId } = await g.calls.start(group.id, s.ownerId);
  return { conversationId: group.id, callId };
}

/** A message from the teacher, which schedules `new_message` for the parent. */
async function message() {
  const conv = await g.conversations.getOrCreateDirect(s.parentId, s.teacherId);
  await g.messages.send({
    conversationId: conv.id,
    senderId: s.teacherId,
    body: "hello",
    clientMessageId: `client-${Date.now()}`,
  });
}

const tokensSent = () => push.sent.map((m) => m.token).sort();

// =========================================================================
describe("1/2. a VoIP token takes calls, and nothing else", () => {
  it("1. an incoming call reaches the VoIP token", async () => {
    await device(s.parentId, "ios-voip", "ios", true);

    await directCall();
    await drainOutbox();
    await notifications.dispatchDue();

    expect(tokensSent()).toEqual(["ios-voip"]);
    expect(push.sent[0].isVoip).toBe(true);
    expect(push.sent[0].platform).toBe("ios");
  });

  it("2. A NEW MESSAGE NEVER REACHES THE VoIP TOKEN — the guarantee", async () => {
    await device(s.parentId, "ios-voip", "ios", true);
    await device(s.parentId, "ios-alert", "ios", false);

    await message();
    await drainOutbox();
    await notifications.dispatchDue();

    expect(tokensSent()).toEqual(["ios-alert"]);
    expect(push.sent.every((m) => !m.isVoip)).toBe(true);
  });

  it("2b. an iPhone with both tokens gets the CALL on VoIP only", async () => {
    // Otherwise the phone rings AND shows a banner for the same call.
    await device(s.parentId, "ios-voip", "ios", true);
    await device(s.parentId, "ios-alert", "ios", false);

    await directCall();
    await drainOutbox();
    await notifications.dispatchDue();

    expect(tokensSent()).toEqual(["ios-voip"]);
  });

  it("2c. Android receives calls, because FCM has no VoIP channel", async () => {
    // The naive rule `isVoip === isCall` would silently stop every Android
    // phone from ever being told about a call.
    await device(s.parentId, "android-1", "android", false);

    await directCall();
    await drainOutbox();
    await notifications.dispatchDue();

    expect(tokensSent()).toEqual(["android-1"]);
    expect(push.sent[0].platform).toBe("android");
  });

  it("2d. a mixed household: each device gets what it should", async () => {
    await device(s.parentId, "ios-voip", "ios", true);
    await device(s.parentId, "ios-alert", "ios", false);
    await device(s.parentId, "android-1", "android", false);

    await directCall();
    await drainOutbox();
    await notifications.dispatchDue();
    expect(tokensSent()).toEqual(["android-1", "ios-voip"]);

    push.reset();
    await message();
    await drainOutbox();
    await notifications.dispatchDue();
    expect(tokensSent()).toEqual(["android-1", "ios-alert"]);
  });

  it("2e. an iPhone with no VoIP token yet is not sent a call at all", async () => {
    // An incoming-call banner with no CallKit screen behind it is the degraded
    // experience the platform rules exist to prevent. The notification records
    // why nothing was delivered.
    await device(s.parentId, "ios-alert", "ios", false);

    await directCall();
    await drainOutbox();
    await notifications.dispatchDue();

    expect(push.sent).toHaveLength(0);
    const [n] = await g.prisma.notification.findMany({
      where: { recipientId: s.parentId },
    });
    expect(n.failureCode).toBe("NO_DEVICE_TOKEN");
  });
});

// =========================================================================
describe("3/4/5. the call id in the payload", () => {
  it("3. incoming_call carries the callId of THAT call", async () => {
    await device(s.parentId, "ios-voip", "ios", true);

    const { callId, conversationId } = await directCall();
    await drainOutbox();
    await notifications.dispatchDue();

    expect(push.sent[0].data).toEqual({
      eventType: "call_started",
      notificationId: expect.any(String),
      conversationId,
      callId,
    });
  });

  it("4. group_call_started carries it too", async () => {
    await device(s.parentId, "ios-voip", "ios", true);

    const { callId } = await groupCall();
    await drainOutbox();
    await notifications.dispatchDue();

    const call = push.sent.find((m) => m.data.eventType === "group_call_started");
    expect(call?.data.callId).toBe(callId);
  });

  it("5. a new message carries NO callId", async () => {
    await device(s.parentId, "android-1", "android", false);

    await message();
    await drainOutbox();
    await notifications.dispatchDue();

    expect(push.sent[0].data).not.toHaveProperty("callId");
    expect(push.sent[0].data.eventType).toBe("message_published");
  });

  it("5b. a MISSED call carries no callId, and is not a VoIP push", async () => {
    // There is nothing to report to CallKit for a call that already ended.
    await device(s.parentId, "ios-voip", "ios", true);
    await device(s.parentId, "ios-alert", "ios", false);
    const { callId } = await directCall();
    await drainOutbox();
    push.reset();

    await g.prisma.$executeRawUnsafe(
      `update chat.call set started_at = now() - interval '1 hour' where id = '${callId}'::uuid`,
    );
    await g.calls.expireRingingCalls();
    await drainOutbox();
    await notifications.dispatchDue();

    const missed = push.sent.filter((m) => m.data.eventType === "call_missed");
    expect(missed).toHaveLength(1);
    expect(missed[0].token).toBe("ios-alert");
    expect(missed[0].data).not.toHaveProperty("callId");
  });
});

// =========================================================================
describe("6/7/8. who is notified — unchanged by W8-W1", () => {
  it("6. the caller is not notified of their own call", async () => {
    await device(s.teacherId, "teacher-voip", "ios", true);
    await device(s.parentId, "parent-voip", "ios", true);

    await directCall();
    await drainOutbox();
    await notifications.dispatchDue();

    expect(tokensSent()).toEqual(["parent-voip"]);
  });

  it("7. an unrelated actor's device is never addressed", async () => {
    await device(s.parentId, "parent-voip", "ios", true);
    await device(s.otherParentId, "other-voip", "ios", true);

    await directCall();
    await drainOutbox();
    await notifications.dispatchDue();

    expect(tokensSent()).toEqual(["parent-voip"]);
  });

  it("8. a replayed outbox row delivers once", async () => {
    await device(s.parentId, "parent-voip", "ios", true);

    await directCall();
    await drainOutbox();
    await drainOutbox();
    await notifications.dispatchDue();
    await notifications.dispatchDue();

    expect(push.sent).toHaveLength(1);
  });
});

// =========================================================================
describe("11/12. failure handling", () => {
  it("11. a TRANSIENT failure leaves the device active", async () => {
    // The dangerous mistake: deactivating a working phone during an outage.
    await device(s.parentId, "parent-voip", "ios", true);
    push.rejectAs = "error";

    await directCall();
    await drainOutbox();
    await notifications.dispatchDue();

    const [token] = await g.prisma.deviceToken.findMany({
      where: { actorId: s.parentId },
    });
    expect(token.isActive).toBe(true);
  });

  it("a permanently invalid token is deactivated", async () => {
    await device(s.parentId, "parent-voip", "ios", true);
    push.rejectAs = "invalid";

    await directCall();
    await drainOutbox();
    await notifications.dispatchDue();

    const [token] = await g.prisma.deviceToken.findMany({
      where: { actorId: s.parentId },
    });
    expect(token.isActive).toBe(false);
  });

  it("12. a failed delivery is rescheduled, not lost", async () => {
    await device(s.parentId, "parent-voip", "ios", true);
    push.rejectAs = "error";

    await directCall();
    await drainOutbox();
    await notifications.dispatchDue();

    const [n] = await g.prisma.notification.findMany({
      where: { recipientId: s.parentId },
    });
    expect(n.status).toBe("scheduled");
    expect(n.attempts).toBeGreaterThan(0);
    expect(n.scheduledAt.getTime()).toBeGreaterThan(Date.now());
  });
});

// =========================================================================
describe("13. re-registration keeps the device's kind honest", () => {
  it("13. re-registering updates platform and isVoip", async () => {
    // Before W8-W1 the update branch set neither, so a token re-registered with
    // a different kind kept the kind it was first seen with -- which is now the
    // difference between a phone that rings and one that does not.
    await device(s.parentId, "token-1", "android", false);
    await device(s.parentId, "token-1", "ios", true);

    const [token] = await g.prisma.deviceToken.findMany({
      where: { token: "token-1" },
    });
    expect(token.platform).toBe("ios");
    expect(token.isVoip).toBe(true);

    // And the change takes effect: the call now routes to it.
    await directCall();
    await drainOutbox();
    await notifications.dispatchDue();
    expect(tokensSent()).toEqual(["token-1"]);
  });

  it("re-registering does not duplicate the row", async () => {
    await device(s.parentId, "token-1", "ios", true);
    await device(s.parentId, "token-1", "ios", true);

    expect(
      await g.prisma.deviceToken.count({ where: { token: "token-1" } }),
    ).toBe(1);
  });
});

// =========================================================================
describe("15. nothing secret travels", () => {
  it("15. no media credential, room name or contact channel in any payload",
    async () => {
      await device(s.parentId, "parent-voip", "ios", true);

      await directCall();
      await drainOutbox();
      await notifications.dispatchDue();

      const carried = JSON.stringify(
        push.sent.map((m) => ({ data: m.data, title: m.title, body: m.body })),
      );
      expect(carried).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/); // any JWT
      expect(carried).not.toMatch(/jawwid-[0-9a-f-]{8}/); // a room name
      expect(carried).not.toMatch(/roomName|livekit|apiSecret|accessToken/i);
      expect(carried).not.toMatch(/@|\+\d{6,}/); // BR-2
    });

  it("the payload is four keys at most", async () => {
    await device(s.parentId, "parent-voip", "ios", true);

    await directCall();
    await drainOutbox();
    await notifications.dispatchDue();

    expect(Object.keys(push.sent[0].data).sort()).toEqual([
      "callId",
      "conversationId",
      "eventType",
      "notificationId",
    ]);
  });
});
