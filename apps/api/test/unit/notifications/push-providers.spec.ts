/**
 * The FCM and APNs clients: what they put on the wire, and how they read the
 * answer.
 *
 * WHAT THESE TESTS CAN AND CANNOT ESTABLISH. They cannot establish that a
 * notification arrives on a phone -- that needs a Firebase project, an Apple
 * signing key and a device, none of which exist in CI, and pretending otherwise
 * would be the kind of green test that makes an outage a surprise.
 *
 * What they DO establish is everything that is decided in this repository: the
 * payload shape each platform requires, the headers APNs will reject a push
 * without, which failures mean "this device is gone" versus "try again later",
 * and that a provider token is reused rather than minted per push. Every one of
 * those has a specific, known way of going wrong in production, and each is
 * silent -- a misrouted push is not an error, it is a notification that never
 * arrives.
 */
import { ApnsPushProvider } from '@communication/notifications/apns.provider';
import { FcmPushProvider } from '@communication/notifications/fcm.provider';
import type { PushMessage } from '@communication/notifications/push.provider';
import { generateKeyPairSync } from 'node:crypto';

/** A throwaway EC key, so the ES256 signing path is exercised for real. */
const ec = generateKeyPairSync('ec', {
  namedCurve: 'P-256',
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

/** A throwaway RSA key, for the FCM service-account assertion. */
const rsa = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

interface Captured {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

function recorder(responses: Array<{ status: number; body: string }>) {
  const calls: Captured[] = [];
  let next = 0;
  const send = async (url: string, init: Captured extends never ? never : {
    method: string;
    headers: Record<string, string>;
    body: string;
  }) => {
    calls.push({ url, ...init });
    const response = responses[Math.min(next, responses.length - 1)];
    next += 1;
    return { status: response.status, text: async () => response.body };
  };
  return { calls, send };
}

const message: PushMessage = {
  token: 'device-token-1',
  title: 'Jawwid',
  body: 'A new message',
  data: { eventType: 'message_published', conversationId: 'conv-1', notificationId: 'n-1' },
  isVoip: false,
  platform: 'ios',
  threadId: 'conv-1',
  collapseId: 'abc123',
  priority: 'normal',
};

// ---------------------------------------------------------------------------
// FCM
// ---------------------------------------------------------------------------

describe('FCM', () => {
  const account = JSON.stringify({
    project_id: 'jawwid-test',
    client_email: 'push@jawwid-test.iam.gserviceaccount.com',
    private_key: rsa.privateKey,
    token_uri: 'https://oauth2.example/token',
  });

  const originalEnv = process.env.FCM_SERVICE_ACCOUNT_JSON;
  beforeEach(() => {
    process.env.FCM_SERVICE_ACCOUNT_JSON = account;
  });
  afterAll(() => {
    process.env.FCM_SERVICE_ACCOUNT_JSON = originalEnv;
  });

  function provider(responses: Array<{ status: number; body: string }>) {
    const { calls, send } = recorder([
      { status: 200, body: JSON.stringify({ access_token: 'at-1', expires_in: 3600 }) },
      ...responses,
    ]);
    return { calls, fcm: new FcmPushProvider(send as never) };
  }

  it('refuses to construct without a service account', () => {
    delete process.env.FCM_SERVICE_ACCOUNT_JSON;
    // No default and no fallback: a committed service account is a credential
    // in the repository.
    expect(() => new FcmPushProvider()).toThrow(/FCM_SERVICE_ACCOUNT_JSON/);
  });

  it('sends both a notification block and a data block', async () => {
    const { calls, fcm } = provider([{ status: 200, body: '{}' }]);
    await fcm.send(message);

    const push = JSON.parse(calls[1].body).message;
    // The notification block is what Android's system tray renders when the app
    // is NOT running -- which is exactly when a notification matters. Data
    // alone would display nothing.
    expect(push.notification).toEqual({ title: 'Jawwid', body: 'A new message' });
    // And the data block is what the app reads to route the tap.
    expect(push.data.conversationId).toBe('conv-1');
  });

  it('stringifies every data value', async () => {
    const { calls, fcm } = provider([{ status: 200, body: '{}' }]);
    await fcm.send({ ...message, data: { count: 3 as unknown as string } });

    // FCM rejects a data map with non-string values, with a 400 that does not
    // say which key.
    expect(JSON.parse(calls[1].body).message.data.count).toBe('3');
  });

  it('groups by tag and supersedes by collapse key', async () => {
    const { calls, fcm } = provider([{ status: 200, body: '{}' }]);
    await fcm.send(message);

    const android = JSON.parse(calls[1].body).message.android;
    expect(android.notification.tag).toBe('conv-1');
    expect(android.collapse_key).toBe('abc123');
  });

  it('raises priority only for urgent notifications', async () => {
    const { calls, fcm } = provider([{ status: 200, body: '{}' }]);
    await fcm.send({ ...message, priority: 'critical' });
    expect(JSON.parse(calls[1].body).message.android.priority).toBe('high');
  });

  it('reads a 404 as a dead token, and a 503 as worth retrying', async () => {
    const dead = provider([{ status: 404, body: '{}' }]);
    expect(await dead.fcm.send(message)).toMatchObject({ ok: false, tokenInvalid: true });

    const busy = provider([{ status: 503, body: '{}' }]);
    const result = await busy.fcm.send(message);
    expect(result.ok).toBe(false);
    // NOT tokenInvalid. Retiring a token because Google had a bad minute would
    // silence that device permanently.
    expect(result.tokenInvalid).toBe(false);
  });

  it('reuses the access token across pushes', async () => {
    const { calls, fcm } = provider([
      { status: 200, body: '{}' },
      { status: 200, body: '{}' },
    ]);
    await fcm.send(message);
    await fcm.send(message);

    // One token exchange, two pushes. Minting per push would triple the
    // latency of every notification and hit Google's rate limits on a batch.
    const exchanges = calls.filter((c) => c.url.includes('token'));
    expect(exchanges).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// APNs
// ---------------------------------------------------------------------------

describe('APNs', () => {
  const env = {
    APNS_KEY_ID: 'KEY123',
    APNS_TEAM_ID: 'TEAM456',
    APNS_PRIVATE_KEY: ec.privateKey,
    APNS_BUNDLE_ID: 'com.jawwid.chat',
    APNS_ENVIRONMENT: 'sandbox',
  };

  beforeEach(() => Object.assign(process.env, env));
  afterAll(() => {
    for (const key of Object.keys(env)) delete process.env[key];
  });

  function provider(responses: Array<{ status: number; body: string }>) {
    const { calls, send } = recorder(responses);
    return { calls, apns: new ApnsPushProvider(send as never) };
  }

  it('refuses an environment it does not recognise', () => {
    process.env.APNS_ENVIRONMENT = 'staging';
    // A token registered against sandbox is rejected by production and the
    // other way round. That is the most common way a working push pipeline
    // appears broken after a release, so it is a startup failure and not a
    // guess.
    expect(() => new ApnsPushProvider()).toThrow(/APNS_ENVIRONMENT/);
  });

  it('addresses the sandbox gateway when configured for sandbox', async () => {
    const { calls, apns } = provider([{ status: 200, body: '' }]);
    await apns.send(message);
    expect(calls[0].url).toBe('https://api.sandbox.push.apple.com/3/device/device-token-1');
  });

  it('sends an alert push on the app topic, grouped and collapsible', async () => {
    const { calls, apns } = provider([{ status: 200, body: '' }]);
    await apns.send(message);

    expect(calls[0].headers['apns-topic']).toBe('com.jawwid.chat');
    expect(calls[0].headers['apns-push-type']).toBe('alert');
    expect(calls[0].headers['apns-collapse-id']).toBe('abc123');

    const payload = JSON.parse(calls[0].body);
    expect(payload.aps.alert).toEqual({ title: 'Jawwid', body: 'A new message' });
    expect(payload.aps['thread-id']).toBe('conv-1');
    expect(payload.conversationId).toBe('conv-1');
  });

  it('sends a VoIP push on the voip topic, with no alert and no collapse', async () => {
    const { calls, apns } = provider([{ status: 200, body: '' }]);
    await apns.send({ ...message, isVoip: true });

    // Sending a VoIP payload on the alert topic silently fails to raise
    // CallKit, and iOS terminates an app that takes a VoIP push and does not
    // report a call.
    expect(calls[0].headers['apns-topic']).toBe('com.jawwid.chat.voip');
    expect(calls[0].headers['apns-push-type']).toBe('voip');
    // Each incoming call is its own event: collapsing one into another would
    // drop a call.
    expect(calls[0].headers['apns-collapse-id']).toBeUndefined();
    expect(JSON.parse(calls[0].body).aps).toBeUndefined();
  });

  it('reads 410 and BadDeviceToken as a dead token', async () => {
    const gone = provider([{ status: 410, body: JSON.stringify({ reason: 'Unregistered' }) }]);
    expect(await gone.apns.send(message)).toMatchObject({ ok: false, tokenInvalid: true });

    const wrongEnv = provider([
      { status: 400, body: JSON.stringify({ reason: 'BadDeviceToken' }) },
    ]);
    expect(await wrongEnv.apns.send(message)).toMatchObject({ tokenInvalid: true });
  });

  it('does NOT retire a token over a server error', async () => {
    const { apns } = provider([
      { status: 503, body: JSON.stringify({ reason: 'ServiceUnavailable' }) },
    ]);
    const result = await apns.send(message);
    expect(result.ok).toBe(false);
    expect(result.tokenInvalid).toBe(false);
  });

  it('reuses the provider token rather than minting one per push', async () => {
    const { calls, apns } = provider([{ status: 200, body: '' }]);
    await apns.send(message);
    await apns.send(message);

    // Apple rate-limits providers that mint a token per request
    // (TooManyProviderTokenUpdates), which on a busy send looks like APNs
    // randomly refusing valid pushes.
    expect(calls[0].headers.authorization).toBe(calls[1].headers.authorization);
  });

  it('signs with the raw r||s form APNs requires, not DER', async () => {
    const { calls, apns } = provider([{ status: 200, body: '' }]);
    await apns.send(message);

    const signature = calls[0].headers.authorization.split('.')[2];
    // ES256 raw is exactly 64 bytes; DER is variable and longer. A DER
    // signature is well-formed, verifies nowhere, and comes back as
    // InvalidProviderToken -- which reads as a wrong key rather than a wrong
    // encoding.
    expect(Buffer.from(signature, 'base64url')).toHaveLength(64);
  });
});
