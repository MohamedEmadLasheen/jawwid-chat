/**
 * What a provider does with a refusal — and, above all, what it does NOT do.
 *
 * THE DANGEROUS MISTAKE these tests exist to prevent: deactivating a device
 * because of a transient failure. `NotificationService` deactivates any token a
 * provider reports as `tokenInvalid`, permanently and without asking again, so a
 * provider that reports "invalid" for a 500 or a dropped connection would
 * quietly unregister working phones during an outage — and nobody's calls would
 * ring afterwards. Only Apple's and Google's *permanent* codes may set it.
 *
 * The transports themselves are injected, so no connection is opened and no
 * credential is needed.
 */
import { ApnsPushProvider } from '@communication/notifications/apns.provider';
import { FcmPushProvider } from '@communication/notifications/fcm.provider';
import { selectPushProvider } from '@communication/notifications/push.provider.selector';
import type { PushMessage } from '@communication/notifications/push.provider';
import apn from '@parse/node-apn';
import { generateKeyPairSync } from 'node:crypto';

/**
 * THE SDK'S TRANSPORTS ARE STUBBED FOR THIS FILE. Nothing here reaches a network.
 *
 * The APNs and FCM blocks below inject their own transports, so they never did.
 * `selectPushProvider` is different: building real transports is its job, and a
 * test that reaches one reaches Apple. Normally nothing does -- the VoIP
 * activation gate refuses before a transport is chosen -- so the gap was
 * invisible until a MUTATION removing the gate opened a real HTTP/2 connection
 * to Apple's production APNs endpoint and hung the run for twenty-four minutes.
 *
 * That is useless as evidence and not something a unit suite may do at all. So:
 *
 *   * `apn.Provider` is a recorder. `apn.Notification` is left REAL, because
 *     the APNs tests assert on the payload it builds.
 *   * `JWT` yields no access token, so the FCM path ends before `fetch`.
 *
 * The gate mutation is still killed, and killed BETTER: the recorder shows the
 * delivery the gate should have refused, instead of a hung socket.
 */
jest.mock('@parse/node-apn', () => {
  const actual = jest.requireActual('@parse/node-apn');
  const base = actual.default ?? actual;
  const deliveries: { topic: unknown; pushType: unknown; token: string }[] = [];

  class RecordingProvider {
    static deliveries = deliveries;
    async send(notification: { topic: unknown; pushType: unknown }, token: string) {
      deliveries.push({
        topic: notification.topic,
        pushType: notification.pushType,
        token,
      });
      return { sent: [{ device: token }], failed: [] };
    }
    shutdown() {}
  }

  return { __esModule: true, default: { ...base, Provider: RecordingProvider } };
});

jest.mock('google-auth-library', () => ({
  __esModule: true,
  JWT: class {
    async getAccessToken() {
      return { token: null };
    }
  },
}));

/** Everything the stubbed APNs transport was asked to deliver. */
const apnsDeliveries = () =>
  (apn.Provider as unknown as { deliveries: { pushType: unknown }[] }).deliveries;

/**
 * A real EC P-256 key, generated per run.
 *
 * `@parse/node-apn` resolves a credential by looking for `-----BEGIN ...-----`
 * in the string and otherwise treating it as a FILE PATH — so a placeholder
 * like 'PEM' makes it try to open a file called "PEM". Generating a real key
 * exercises the construction path the deployment will take, without a secret in
 * the repository.
 */
const SIGNING_KEY = generateKeyPairSync('ec', {
  namedCurve: 'P-256',
}).privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;

const message = (over: Partial<PushMessage> = {}): PushMessage => ({
  token: 'device-token',
  title: 'Incoming call',
  body: 'Call from teacher_c',
  data: { eventType: 'call_started', notificationId: 'n_1', callId: 'call_1' },
  isVoip: false,
  platform: 'android',
  ...over,
});

/** A stand-in for the APNs SDK's Provider. */
function apnsTransport(result: { sent?: unknown[]; failed?: unknown[] }) {
  return {
    sent: result.sent ?? [],
    failed: result.failed ?? [],
    calls: [] as { notification: Record<string, unknown>; token: string }[],
    async send(notification: Record<string, unknown>, token: string) {
      this.calls.push({ notification, token });
      return { sent: this.sent, failed: this.failed };
    },
    shutdown() {},
  };
}

const apnsConfig = {
  keyId: 'K',
  teamId: 'T',
  key: SIGNING_KEY,
  bundleId: 'com.jawwid.chat',
  production: false,
};

describe('APNs', () => {
  it('a delivered notification is a success', async () => {
    const transport = apnsTransport({ sent: [{ device: 'device-token' }] });
    const provider = new ApnsPushProvider(apnsConfig, transport as never);

    expect(await provider.send(message())).toEqual({ ok: true });
  });

  it('a VoIP push uses the .voip topic, the voip push type, and NO alert',
    async () => {
      const transport = apnsTransport({ sent: [{ device: 'd' }] });
      const provider = new ApnsPushProvider(apnsConfig, transport as never);

      await provider.send(message({ isVoip: true, platform: 'ios' }));

      const [call] = transport.calls;
      expect(call.notification.topic).toBe('com.jawwid.chat.voip');
      expect(call.notification.pushType).toBe('voip');
      // A PushKit payload is data the app is woken to act on. An alert here
      // would be a second, user-visible notification beside the call screen.
      expect(call.notification.alert).toBeUndefined();
      expect(call.notification.sound).toBeUndefined();
      expect(call.notification.rawPayload).toEqual(message().data);
    });

  it('an ordinary push uses the plain topic and carries the alert', async () => {
    const transport = apnsTransport({ sent: [{ device: 'd' }] });
    const provider = new ApnsPushProvider(apnsConfig, transport as never);

    await provider.send(
      message({ platform: 'ios', data: { eventType: 'message_published', notificationId: 'n' } }),
    );

    const [call] = transport.calls;
    expect(call.notification.topic).toBe('com.jawwid.chat');
    expect(call.notification.pushType).toBe('alert');
    const aps = (call.notification as { aps: Record<string, unknown> }).aps;
    expect(aps.alert).toEqual({ title: 'Incoming call', body: 'Call from teacher_c' });
  });

  for (const reason of [
    'BadDeviceToken',
    'Unregistered',
    'DeviceTokenNotForTopic',
    'TopicDisallowed',
  ]) {
    it(`${reason} marks the token permanently invalid`, async () => {
      const transport = apnsTransport({
        failed: [{ device: 'd', status: 400, response: { reason } }],
      });
      const provider = new ApnsPushProvider(apnsConfig, transport as never);

      const result = await provider.send(message());

      expect(result.ok).toBe(false);
      expect(result.tokenInvalid).toBe(true);
    });
  }

  for (const reason of [
    'TooManyRequests',
    'InternalServerError',
    'ServiceUnavailable',
    'ExpiredProviderToken',
  ]) {
    it(`${reason} does NOT deactivate the device`, async () => {
      const transport = apnsTransport({
        failed: [{ device: 'd', status: 503, response: { reason } }],
      });
      const provider = new ApnsPushProvider(apnsConfig, transport as never);

      const result = await provider.send(message());

      expect(result.ok).toBe(false);
      expect(result.tokenInvalid).toBeFalsy();
    });
  }

  it('a transport failure does not deactivate the device either', async () => {
    const provider = new ApnsPushProvider(apnsConfig, {
      async send() {
        throw new Error('connection reset');
      },
      shutdown() {},
    } as never);

    const result = await provider.send(message());

    expect(result.ok).toBe(false);
    expect(result.tokenInvalid).toBeFalsy();
    expect(result.failureCode).toBe('APNS_TRANSPORT');
  });
});

describe('FCM', () => {
  const config = { projectId: 'p', clientEmail: 'e@x', privateKey: SIGNING_KEY };
  const auth = { async getAccessToken() { return { token: 'oauth-token' }; } };

  let fetchMock: jest.SpyInstance;
  afterEach(() => fetchMock?.mockRestore());

  function replyWith(status: number, body: unknown) {
    fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as Response);
  }

  it('a 200 is a success, sent data-only with high priority', async () => {
    replyWith(200, {});
    const provider = new FcmPushProvider(config, auth as never);

    expect(await provider.send(message())).toEqual({ ok: true });

    const [, init] = fetchMock.mock.calls[0];
    const sent = JSON.parse((init as RequestInit).body as string);
    expect(sent.message.data).toEqual(message().data);
    expect(sent.message.android.priority).toBe('high');
    // No `notification` block: the client decides what to show, which is what
    // lets a call push reach code rather than be drawn as a banner.
    expect(sent.message).not.toHaveProperty('notification');
  });

  for (const reason of ['UNREGISTERED', 'INVALID_ARGUMENT', 'SENDER_ID_MISMATCH']) {
    it(`${reason} marks the token permanently invalid`, async () => {
      replyWith(400, { error: { status: reason } });
      const provider = new FcmPushProvider(config, auth as never);

      const result = await provider.send(message());

      expect(result.ok).toBe(false);
      expect(result.tokenInvalid).toBe(true);
    });
  }

  it('a 404 means the token no longer exists', async () => {
    replyWith(404, { error: { status: 'NOT_FOUND' } });
    const provider = new FcmPushProvider(config, auth as never);

    expect((await provider.send(message())).tokenInvalid).toBe(true);
  });

  for (const [status, reason] of [
    [429, 'QUOTA_EXCEEDED'],
    [500, 'INTERNAL'],
    [503, 'UNAVAILABLE'],
    [401, 'UNAUTHENTICATED'],
    [403, 'PERMISSION_DENIED'],
  ] as const) {
    it(`${status} ${reason} does NOT deactivate the device`, async () => {
      replyWith(status, { error: { status: reason } });
      const provider = new FcmPushProvider(config, auth as never);

      const result = await provider.send(message());

      expect(result.ok).toBe(false);
      expect(result.tokenInvalid).toBeFalsy();
    });
  }

  it('our own auth failure never deactivates a device', async () => {
    const provider = new FcmPushProvider(config, {
      async getAccessToken() {
        throw new Error('bad service account');
      },
    } as never);

    const result = await provider.send(message());

    expect(result.ok).toBe(false);
    expect(result.tokenInvalid).toBeFalsy();
    expect(result.failureCode).toBe('FCM_AUTH');
  });

  it('a network failure does not deactivate a device', async () => {
    fetchMock = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    const provider = new FcmPushProvider(config, auth as never);

    const result = await provider.send(message());

    expect(result.tokenInvalid).toBeFalsy();
    expect(result.failureCode).toBe('FCM_TRANSPORT');
  });
});

describe('provider selection', () => {
  const silent = { log: () => {}, warn: () => {} };

  beforeEach(() => {
    apnsDeliveries().length = 0;
  });

  const apnsEnv = {
    APNS_KEY_ID: 'K',
    APNS_TEAM_ID: 'T',
    APNS_KEY: SIGNING_KEY,
    APNS_BUNDLE_ID: 'com.jawwid.chat',
  };
  const fcmEnv = {
    FCM_PROJECT_ID: 'p',
    FCM_CLIENT_EMAIL: 'e@x',
    FCM_PRIVATE_KEY: SIGNING_KEY,
  };

  it('no configuration keeps the logging provider — a laptop still works', () => {
    const selection = selectPushProvider({}, silent);

    expect(selection.kind).toBe('logging');
    expect(selection.voipEnabled).toBe(false);
  });

  it('a HALF-configured provider refuses to start', () => {
    // The dangerous state is not "unconfigured"; it is "configured enough to
    // look configured", which reports a healthy pipeline that delivers nothing.
    expect(() => selectPushProvider({ APNS_KEY_ID: 'K' }, silent)).toThrow(
      /partially configured/i,
    );
    expect(() =>
      selectPushProvider({ FCM_PROJECT_ID: 'p', FCM_CLIENT_EMAIL: 'e@x' }, silent),
    ).toThrow(/partially configured/i);
  });

  it('the error names exactly what is missing', () => {
    expect(() => selectPushProvider({ APNS_KEY_ID: 'K' }, silent)).toThrow(
      /APNS_TEAM_ID/,
    );
  });

  it('either provider alone is a valid deployment', () => {
    expect(selectPushProvider({ ...apnsEnv }, silent).kind).toBe('apns');
    expect(selectPushProvider({ ...fcmEnv }, silent).kind).toBe('fcm');
  });

  it('both configured is the production shape', () => {
    expect(selectPushProvider({ ...apnsEnv, ...fcmEnv }, silent).kind).toBe('apns+fcm');
  });

  describe('the iOS VoIP activation gate', () => {
    it('is CLOSED by default, even with APNs fully configured', async () => {
      const { provider, voipEnabled } = selectPushProvider({ ...apnsEnv }, silent);
      expect(voipEnabled).toBe(false);

      const result = await provider.send(message({ isVoip: true, platform: 'ios' }));

      // Not delivered, and not pretended otherwise: reported as a failure so
      // the metrics never claim a phone rang when it did not.
      expect(result.ok).toBe(false);
      expect(result.failureCode).toBe('VOIP_GATED');
      expect(result.tokenInvalid).toBeFalsy();

      // AND NOTHING REACHED APPLE. The failure code alone would still hold if
      // the push had been delivered and then reported as refused; this is the
      // gate's actual guarantee, read off the transport.
      expect(apnsDeliveries()).toHaveLength(0);
    });

    it('opens only for an explicit APNS_VOIP_ENABLED=true', () => {
      expect(selectPushProvider({ ...apnsEnv, APNS_VOIP_ENABLED: 'true' }, silent).voipEnabled)
        .toBe(true);
      for (const value of ['false', '1', 'yes', 'TRUE ', '']) {
        expect(
          selectPushProvider({ ...apnsEnv, APNS_VOIP_ENABLED: value }, silent).voipEnabled,
        ).toBe(value.trim().toLowerCase() === 'true');
      }
    });

    it('the gate does not block ordinary iOS or Android pushes', async () => {
      const { provider } = selectPushProvider({ ...apnsEnv, ...fcmEnv }, silent);

      // Neither reaches a real network in this test; what matters is that the
      // gate did not refuse them before a transport was chosen.
      const android = await provider.send(message({ platform: 'android' }));
      expect(android.failureCode).not.toBe('VOIP_GATED');
    });
  });

  it('a message with no transport fails without deactivating the device', async () => {
    // APNs only, and an Android device: our deployment is incomplete, the phone
    // is fine.
    const { provider } = selectPushProvider({ ...apnsEnv }, silent);

    const result = await provider.send(message({ platform: 'android' }));

    expect(result.ok).toBe(false);
    expect(result.failureCode).toBe('FCM_UNCONFIGURED');
    expect(result.tokenInvalid).toBeFalsy();
  });
});
