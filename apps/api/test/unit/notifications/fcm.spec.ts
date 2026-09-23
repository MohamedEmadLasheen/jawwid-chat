import { generateKeyPairSync } from 'node:crypto';
import {
  FcmPushProvider,
  fcmConfigFromEnvironment,
  HttpPost,
} from '@communication/notifications/fcm.provider';
import type { PushMessage } from '@communication/notifications/push.provider';

/**
 * The push transport.
 *
 * The behaviour under test is not "does it send" -- it is which failures are
 * allowed to kill a device token. Getting that wrong is the outage that
 * deactivates every device in the academy because a service account expired,
 * and it cannot be undone: only a reinstall brings a token back.
 */
describe('FcmPushProvider', () => {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });

  const config = {
    projectId: 'jawwid-test',
    clientEmail: 'push@jawwid-test.iam.gserviceaccount.com',
    privateKey,
  };

  const message: PushMessage = {
    token: 'device-token',
    title: 'Jawwid',
    body: '',
    data: { notificationId: 'n1', conversationId: 'c1' },
    isVoip: false,
  };

  /** Records every call and replies from a script. */
  function transport(sendReplies: Array<{ status: number; body: string }>) {
    const calls: Array<{ url: string; body: string; headers: Record<string, string> }> = [];
    let sendIndex = 0;

    const post: HttpPost = async (url, init) => {
      calls.push({ url, body: init.body, headers: init.headers });
      if (url.includes('oauth2')) {
        return {
          status: 200,
          body: JSON.stringify({ access_token: 'at-1', expires_in: 3600 }),
        };
      }
      return sendReplies[Math.min(sendIndex++, sendReplies.length - 1)];
    };

    return { post, calls };
  }

  const ok = { status: 200, body: '{"name":"projects/x/messages/1"}' };

  describe('configuration', () => {
    const original = { ...process.env };
    afterEach(() => {
      process.env = { ...original };
    });

    const serviceAccount = (extra: Record<string, unknown> = {}) =>
      JSON.stringify({
        project_id: 'jawwid-test',
        client_email: 'push@jawwid-test.iam.gserviceaccount.com',
        private_key: '-----BEGIN-----\\nline\\n-----END-----',
        ...extra,
      });

    it('is absent unless both values are present', () => {
      delete process.env.FCM_PROJECT_ID;
      delete process.env.FCM_SERVICE_ACCOUNT_JSON;
      expect(fcmConfigFromEnvironment()).toBeNull();

      process.env.FCM_PROJECT_ID = 'jawwid-test';
      // Half-configured is not configured: a deployment that looks wired and
      // silently is not is worse than one that obviously is not.
      expect(fcmConfigFromEnvironment()).toBeNull();
    });

    it('un-escapes a PEM that came through an environment variable', () => {
      process.env.FCM_PROJECT_ID = 'jawwid-test';
      process.env.FCM_SERVICE_ACCOUNT_JSON = serviceAccount();

      // Almost every deployment pipeline escapes the newlines. Accepting only
      // the literal form is the difference between push working and a silent
      // authorization failure on every send.
      expect(fcmConfigFromEnvironment()?.privateKey).toBe(
        '-----BEGIN-----\nline\n-----END-----',
      );
    });

    it('refuses a secret that was pasted wrong rather than falling back', () => {
      process.env.FCM_PROJECT_ID = 'jawwid-test';
      process.env.FCM_SERVICE_ACCOUNT_JSON = '{not json';

      // Falling back to "log and do not send" here is the exact failure this
      // provider exists to prevent: it would look configured and deliver
      // nothing.
      expect(() => fcmConfigFromEnvironment()).toThrow(/not valid JSON/);
    });

    it('refuses a service account missing its key material', () => {
      process.env.FCM_PROJECT_ID = 'jawwid-test';
      process.env.FCM_SERVICE_ACCOUNT_JSON = JSON.stringify({ project_id: 'jawwid-test' });
      expect(() => fcmConfigFromEnvironment()).toThrow(/client_email or private_key/);
    });

    it('refuses two sources of truth that disagree', () => {
      process.env.FCM_PROJECT_ID = 'some-other-project';
      process.env.FCM_SERVICE_ACCOUNT_JSON = serviceAccount();

      // Sending to whichever one this file happened to prefer is not something
      // to guess at.
      expect(() => fcmConfigFromEnvironment()).toThrow(/does not match/);
    });
  });

  describe('which failures kill a token', () => {
    it.each([
      ['UNREGISTERED', 404],
      ['INVALID_ARGUMENT', 400],
      ['SENDER_ID_MISMATCH', 403],
    ])('%s means this device is gone', async (code, status) => {
      const { post } = transport([
        { status, body: JSON.stringify({ error: { status: code } }) },
      ]);
      const result = await new FcmPushProvider(config, post).send(message);

      expect(result.ok).toBe(false);
      expect(result.tokenInvalid).toBe(true);
      expect(result.failureCode).toBe(code);
    });

    it.each([
      ['expired credentials', 401, 'UNAUTHENTICATED'],
      ['a revoked service account', 403, 'PERMISSION_DENIED'],
      ['quota exhaustion', 429, 'RESOURCE_EXHAUSTED'],
      ['an FCM outage', 503, 'UNAVAILABLE'],
      ['an FCM internal error', 500, 'INTERNAL'],
    ])('%s never does', async (_label, status, code) => {
      const { post } = transport([
        { status, body: JSON.stringify({ error: { status: code } }) },
      ]);
      const result = await new FcmPushProvider(config, post).send(message);

      expect(result.ok).toBe(false);
      // THE test. None of these says anything about the device, so none of them
      // may deactivate it.
      expect(result.tokenInvalid).toBeFalsy();
    });

    it('a failure to authorize at all never does either', async () => {
      const post: HttpPost = async (url) =>
        url.includes('oauth2')
          ? { status: 400, body: '{"error":"invalid_grant"}' }
          : { status: 200, body: '{}' };

      const result = await new FcmPushProvider(config, post).send(message);

      expect(result.ok).toBe(false);
      expect(result.failureCode).toBe('FCM_AUTH_FAILED');
      expect(result.tokenInvalid).toBeFalsy();
    });

    it('an unparseable error body does not throw', async () => {
      const { post } = transport([{ status: 400, body: '<html>bad gateway</html>' }]);
      const result = await new FcmPushProvider(config, post).send(message);

      // Losing the send is recoverable; throwing would lose the diagnosis too.
      expect(result.ok).toBe(false);
      expect(result.tokenInvalid).toBeFalsy();
    });

    it('reads the nested errorCode FCM actually sends', async () => {
      const { post } = transport([
        {
          status: 404,
          body: JSON.stringify({
            error: {
              status: 'NOT_FOUND',
              details: [
                { '@type': 'type.googleapis.com/google.rpc.ErrorInfo', errorCode: 'UNREGISTERED' },
              ],
            },
          }),
        },
      ]);
      const result = await new FcmPushProvider(config, post).send(message);
      expect(result.tokenInvalid).toBe(true);
    });
  });

  describe('the payload', () => {
    it('carries the routing ids and no message content', async () => {
      const { post, calls } = transport([ok]);
      await new FcmPushProvider(config, post).send(message);

      const send = calls.find((c) => c.url.includes('messages:send'))!;
      const body = JSON.parse(send.body) as { message: Record<string, unknown> };

      expect(body.message.token).toBe('device-token');
      expect(body.message.data).toEqual({ notificationId: 'n1', conversationId: 'c1' });
      // DeliveryService already decided what may reach a lock screen; nothing is
      // added here that the caller did not pass.
      expect(JSON.stringify(body.message)).not.toContain('SECRET');
    });

    it('sends a VoIP push down the path that can actually ring', async () => {
      const { post, calls } = transport([ok]);
      await new FcmPushProvider(config, post).send({ ...message, isVoip: true });

      const send = calls.find((c) => c.url.includes('messages:send'))!;
      const body = JSON.parse(send.body) as {
        message: {
          android: { priority: string };
          apns: { headers: Record<string, string> };
        };
      };

      // A call that arrives at normal priority on a sleeping phone does not ring.
      expect(body.message.android.priority).toBe('high');
      expect(body.message.apns.headers['apns-priority']).toBe('10');
      expect(body.message.apns.headers['apns-push-type']).toBe('voip');
    });

    it('sends an ordinary notification at ordinary priority', async () => {
      const { post, calls } = transport([ok]);
      await new FcmPushProvider(config, post).send(message);

      const send = calls.find((c) => c.url.includes('messages:send'))!;
      const body = JSON.parse(send.body) as {
        message: { android: { priority: string }; apns: { headers: Record<string, string> } };
      };

      // Not everything is urgent. High priority on every message is how an app
      // ends up throttled by the platform.
      expect(body.message.android.priority).toBe('normal');
      expect(body.message.apns.headers['apns-push-type']).toBeUndefined();
    });

    it('omits the notification block entirely when there is no text', async () => {
      const { post, calls } = transport([ok]);
      await new FcmPushProvider(config, post).send({ ...message, title: '', body: '' });

      const send = calls.find((c) => c.url.includes('messages:send'))!;
      const body = JSON.parse(send.body) as { message: Record<string, unknown> };
      // A notification block with empty strings renders as a blank banner.
      expect(body.message.notification).toBeUndefined();
    });
  });

  describe('the access token', () => {
    it('is exchanged once and reused', async () => {
      const { post, calls } = transport([ok, ok, ok]);
      const provider = new FcmPushProvider(config, post);

      await provider.send(message);
      await provider.send(message);
      await provider.send(message);

      // An academy-wide announcement is tens of thousands of sends; one token
      // exchange each would be slow and would get us rate-limited.
      expect(calls.filter((c) => c.url.includes('oauth2'))).toHaveLength(1);
      expect(calls.filter((c) => c.url.includes('messages:send'))).toHaveLength(3);
    });

    it('is exchanged again before it expires', async () => {
      const { post, calls } = transport([ok, ok]);
      let clock = 1_000_000;
      const provider = new FcmPushProvider(config, post, () => clock);

      await provider.send(message);
      // 59 minutes later: inside the hour, but within the 60-second safety
      // margin, so it must not be sent with a token about to expire mid-flight.
      clock += 59 * 60_000 + 30_000;
      await provider.send(message);

      expect(calls.filter((c) => c.url.includes('oauth2'))).toHaveLength(2);
    });

    it('signs a real RS256 assertion', async () => {
      const { post, calls } = transport([ok]);
      await new FcmPushProvider(config, post).send(message);

      const exchange = calls.find((c) => c.url.includes('oauth2'))!;
      const assertion = new URLSearchParams(exchange.body).get('assertion')!;
      const [header, claims, signature] = assertion.split('.');

      expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({
        alg: 'RS256',
        typ: 'JWT',
      });
      const parsed = JSON.parse(Buffer.from(claims, 'base64url').toString()) as {
        iss: string;
        scope: string;
      };
      expect(parsed.iss).toBe(config.clientEmail);
      expect(parsed.scope).toBe('https://www.googleapis.com/auth/firebase.messaging');
      expect(signature.length).toBeGreaterThan(0);
    });
  });
});
