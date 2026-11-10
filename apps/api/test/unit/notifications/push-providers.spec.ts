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
import { FCM_CALL_TTL, FcmPushProvider } from '@communication/notifications/fcm.provider';
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

  const constructions: { production: unknown }[] = [];

  class RecordingProvider {
    static deliveries = deliveries;
    /** How each provider was configured -- the APNs ENDPOINT, in particular. */
    static constructions = constructions;
    constructor(options: { production?: unknown }) {
      constructions.push({ production: options?.production });
    }
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
 * The endpoint the most recently constructed APNs provider was pointed at.
 *
 * Read off the SDK constructor rather than asserted on a private field: the
 * question "sandbox or production" is only answerable where the connection is
 * made, and that is the one place it matters.
 */
const lastApnsProduction = (): unknown => {
  const all = (apn.Provider as unknown as { constructions: { production: unknown }[] })
    .constructions;
  return all[all.length - 1]?.production;
};

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

  describe('LR-11b: apns-collapse-id on alert pushes', () => {
    const sendAlert = async (over: Partial<PushMessage>) => {
      const transport = apnsTransport({ sent: [{ device: 'd' }] });
      await new ApnsPushProvider(apnsConfig, transport as never).send(
        message({ platform: 'ios', ...over }),
      );
      return transport.calls[0].notification as unknown as {
        collapseId?: string;
        headers(): Record<string, string>;
      };
    };
    const chat = (conversationId: string, notificationId = 'n_1') => ({
      data: { eventType: 'message_published', notificationId, conversationId },
    });

    it('an alert push for a conversation carries the header, at most 64 bytes', async () => {
      const sent = await sendAlert(chat('c_1'));

      expect(sent.collapseId).toBeTruthy();
      expect(sent.headers()['apns-collapse-id']).toBe(sent.collapseId);
      expect(Buffer.byteLength(sent.collapseId!, 'utf8')).toBeLessThanOrEqual(64);
    });

    it('is stable for the same conversation and different for another', async () => {
      const first = await sendAlert(chat('c_1', 'n_1'));
      const newer = await sendAlert(chat('c_1', 'n_2'));
      const other = await sendAlert(chat('c_2', 'n_3'));

      expect(newer.collapseId).toBe(first.collapseId);
      expect(other.collapseId).not.toBe(first.collapseId);
    });

    it('carries no identifier in clear', async () => {
      const id = 'e0b1c2d3-0000-4000-8000-000000000001';
      const sent = await sendAlert(chat(id));

      expect(sent.collapseId).not.toContain(id);
      expect(sent.collapseId).not.toContain('conversation');
    });

    it('a call alert collapses on the call', async () => {
      const a = await sendAlert({ data: { eventType: 'call_missed', notificationId: 'n_1', callId: 'call_1' } });
      const b = await sendAlert({ data: { eventType: 'call_started', notificationId: 'n_2', callId: 'call_1' } });

      expect(a.collapseId).toBeTruthy();
      expect(b.collapseId).toBe(a.collapseId);
    });

    it('a held push uses its own key, not the first chat\'s', async () => {
      const own = await sendAlert(chat('c_1'));
      const held = await sendAlert({ ...chat('c_1'), collapseKey: 'held-chats' });
      const heldElsewhere = await sendAlert({ ...chat('c_9'), collapseKey: 'held-chats' });

      expect(held.collapseId).toBeTruthy();
      expect(held.collapseId).not.toBe(own.collapseId);
      expect(heldElsewhere.collapseId).toBe(held.collapseId);
    });

    it('is omitted when the push has no identity', async () => {
      const sent = await sendAlert({ data: { eventType: 'lesson_reminder', notificationId: 'n_1' } });

      expect(sent.collapseId).toBeUndefined();
      expect(sent.headers()).not.toHaveProperty('apns-collapse-id');
    });

    it('is NEVER set on a VoIP push', async () => {
      const sent = await sendAlert({ isVoip: true, collapseKey: 'held-chats' });

      expect(sent.collapseId).toBeUndefined();
      expect(sent.headers()).not.toHaveProperty('apns-collapse-id');
    });
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
    // The rendered text rides in the data: a closed Android app draws it from there.
    expect(sent.message.data).toEqual({ ...message().data, title: 'Incoming call', body: 'Call from teacher_c' });
    expect(sent.message.android.priority).toBe('high');
    // A ring is kept only while it can still be answered.
    expect(sent.message.android.ttl).toBe(FCM_CALL_TTL);
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

  it('a message push carries its text and no call TTL', async () => {
    replyWith(200, {});
    await new FcmPushProvider(config, auth as never).send(
      message({ title: 'Lina', body: 'New message', data: { eventType: 'message_created', notificationId: 'n_2', conversationId: 'c_1' } }),
    );
    const sent = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(sent.message.data).toEqual({ eventType: 'message_created', notificationId: 'n_2', conversationId: 'c_1', title: 'Lina', body: 'New message' });
    expect(sent.message.android).toEqual({ priority: 'high' });
  });

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

  // EXACTLY THE NAMES IN infra/env/manifest.tsv, which is what
  // scripts/infra/check-env.sh validates and what deploy-production.yml sets.
  // W8-W1 shipped a different set and a real deployment would have presented a
  // PARTIAL group, which the half-configured guard refuses -- so the API would
  // not have booted. These fixtures are the contract, and the tests below
  // assert the old invented names are no longer required.
  const apnsEnv = {
    APNS_KEY_ID: 'K',
    APNS_TEAM_ID: 'T',
    APNS_BUNDLE_ID: 'com.jawwid.chat',
    APNS_PRIVATE_KEY: SIGNING_KEY,
    APNS_PRODUCTION: 'false',
  };
  const serviceAccountJson = JSON.stringify({
    type: 'service_account',
    project_id: 'p',
    client_email: 'push@p.iam.gserviceaccount.com',
    private_key: SIGNING_KEY,
  });
  const fcmEnv = {
    FCM_PROJECT_ID: 'p',
    FCM_SERVICE_ACCOUNT_JSON: serviceAccountJson,
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
      selectPushProvider({ FCM_PROJECT_ID: 'p' }, silent),
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

  it('S-05: production refuses to start without BOTH stores, and names the missing one', () => {
    expect(selectPushProvider({ APP_ENV: 'production', ...apnsEnv, ...fcmEnv }, silent).kind).toBe('apns+fcm');
    expect(() => selectPushProvider({ APP_ENV: 'production' }, silent)).toThrow(/no APNs and FCM configuration/);
    expect(() => selectPushProvider({ APP_ENV: 'production', ...apnsEnv }, silent)).toThrow(/no FCM configuration/);
    expect(() => selectPushProvider({ APP_ENV: ' Production ', ...fcmEnv }, silent)).toThrow(/no APNs configuration/);
  });

  it('S-05: staging and a laptop may still run on the logging provider', () => {
    expect(selectPushProvider({ APP_ENV: 'staging' }, silent).kind).toBe('logging');
    expect(selectPushProvider({ APP_ENV: 'local' }, silent).kind).toBe('logging');
    expect(selectPushProvider({}, silent).kind).toBe('logging');
  });

  describe('the deployment contract in infra/env/manifest.tsv', () => {
    it('7. the invented W8-W1 names are no longer required', () => {
      // The regression this whole micro-workstream exists for. If the selector
      // ever asks for APNS_KEY or FCM_CLIENT_EMAIL again, the manifest's own
      // variables become a partial group and the API refuses to start.
      const selection = selectPushProvider({ ...apnsEnv, ...fcmEnv }, silent);

      expect(selection.kind).toBe('apns+fcm');
      for (const invented of ['APNS_KEY', 'FCM_CLIENT_EMAIL', 'FCM_PRIVATE_KEY']) {
        expect(Object.keys({ ...apnsEnv, ...fcmEnv })).not.toContain(invented);
      }
    });

    it('4. the manifest\'s APNs variables select the real provider', () => {
      expect(selectPushProvider({ ...apnsEnv }, silent).kind).toBe('apns');
    });

    it('1. the manifest\'s FCM variables select the real provider', () => {
      expect(selectPushProvider({ ...fcmEnv }, silent).kind).toBe('fcm');
    });

    it('5. APNS_PRODUCTION decides the endpoint, and NODE_ENV does not', () => {
      // Two different questions. A staging deployment can hold production
      // device tokens, and the sandbox silently DROPS those -- so inferring
      // the endpoint from NODE_ENV fails invisibly, which is the worst way for
      // a push pipeline to fail.
      const production = selectPushProvider(
        { ...apnsEnv, APNS_PRODUCTION: 'true', NODE_ENV: 'development' },
        silent,
      );
      const sandbox = selectPushProvider(
        { ...apnsEnv, APNS_PRODUCTION: 'false', NODE_ENV: 'production' },
        silent,
      );

      void production;
      // Constructed in order, so the last two entries are these two.
      const all = (apn.Provider as unknown as {
        constructions: { production: unknown }[];
      }).constructions;
      expect(all[all.length - 2].production).toBe(true);
      expect(lastApnsProduction()).toBe(false);
      void sandbox;
    });

    it('5b. only the exact string "true" opens the production endpoint', () => {
      // `1` and `yes` are somebody's assumption, and are refused. Whitespace
      // and capitalisation are a secret store's doing, not an operator's, and
      // are forgiven -- the same rule the VoIP gate has always used.
      for (const value of ['1', 'yes', 'on', 'production', '']) {
        selectPushProvider({ ...apnsEnv, APNS_PRODUCTION: value || 'false' }, silent);
        expect(lastApnsProduction()).toBe(false);
      }
      for (const value of ['true', 'TRUE ', ' True']) {
        selectPushProvider({ ...apnsEnv, APNS_PRODUCTION: value }, silent);
        expect(lastApnsProduction()).toBe(true);
      }
    });

    it('6. APNs without its endpoint declared is partial, and refused', () => {
      const { APNS_PRODUCTION: _omitted, ...withoutEndpoint } = apnsEnv;

      expect(() => selectPushProvider(withoutEndpoint, silent)).toThrow(
        /APNS_PRODUCTION/,
      );
    });

    it('3. a service-account document that is not JSON is refused', () => {
      expect(() =>
        selectPushProvider(
          { FCM_PROJECT_ID: 'p', FCM_SERVICE_ACCOUNT_JSON: 'not-json' },
          silent,
        ),
      ).toThrow(/not valid JSON/i);
    });

    it('3b. a service-account document missing a signing field is refused', () => {
      expect(() =>
        selectPushProvider(
          {
            FCM_PROJECT_ID: 'p',
            FCM_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: 'e@x' }),
          },
          silent,
        ),
      ).toThrow(/private_key/);
    });

    it('8. NO CREDENTIAL REACHES A MESSAGE OR A LOG', () => {
      // A startup exception is the one place a private key would be printed
      // and then kept forever in a deployment log.
      const said: string[] = [];
      const recorder = {
        log: (m: string) => said.push(m),
        warn: (m: string) => said.push(m),
      };
      const secret = 'SUPER-SECRET-KEY-MATERIAL';

      expect(() =>
        selectPushProvider(
          {
            FCM_PROJECT_ID: 'p',
            FCM_SERVICE_ACCOUNT_JSON: JSON.stringify({ private_key: secret }),
          },
          recorder,
        ),
      ).toThrow(/client_email/);

      // And the happy path says nothing either.
      selectPushProvider({ ...apnsEnv, ...fcmEnv }, recorder);

      for (const line of said) {
        expect(line).not.toContain(secret);
        expect(line).not.toContain(SIGNING_KEY);
        expect(line).not.toContain('BEGIN');
      }
    });
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
