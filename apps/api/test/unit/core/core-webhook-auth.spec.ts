/**
 * THE CORE BOUNDARY'S AUTHENTICATION.
 *
 * This is the only door into Jawwid Chat that an unauthenticated caller can
 * knock on, and everything behind it -- class sessions, attendance, and the
 * notifications a parent receives about their child -- is Core-authoritative
 * fact that no client session may assert. So the door is tested the way a door
 * is tested: by trying to get through it.
 *
 * Pure, and deliberately so. No HTTP server, no database: every one of these
 * is a property of the verification itself, and a test that needed a server to
 * express it would be testing the server.
 */
import { createHmac } from 'node:crypto';
import {
  loadCoreWebhookConfig,
  DEFAULT_TOLERANCE_SECONDS,
  MAX_BODY_BYTES,
} from '@communication/core/core-webhook.config';
import {
  expectedSignature,
  verifyDelivery,
  WebhookRejection,
} from '@communication/core/core-webhook.verifier';

const SECRET = 'a-shared-secret-from-the-core-team';
const KEY_ID = 'core-2026-09';
const NOW = new Date('2026-09-24T12:00:00Z');

const config = loadCoreWebhookConfig({ CORE_WEBHOOK_SECRETS: `${KEY_ID}:${SECRET}` } as never)!;

/** The exact bytes a sender would put on the wire. */
const body = (value: unknown): Buffer => Buffer.from(JSON.stringify(value), 'utf8');

const unixSeconds = (at: Date): string => String(Math.floor(at.getTime() / 1000));

/** A delivery that should be accepted, so each test can break exactly one thing. */
function goodDelivery(overrides: Partial<{ raw: Buffer; timestamp: string; keyId: string }> = {}) {
  const raw = overrides.raw ?? body({ event_id: 'e1', event_type: 'class_session.upserted' });
  const timestamp = overrides.timestamp ?? unixSeconds(NOW);
  return {
    raw,
    headers: {
      keyId: overrides.keyId ?? KEY_ID,
      timestamp,
      signature: expectedSignature(SECRET, timestamp, raw),
    },
  };
}

describe('a valid delivery', () => {
  it('is accepted, and names the key that signed it', () => {
    const { raw, headers } = goodDelivery();
    expect(verifyDelivery(config, headers, raw, NOW)).toEqual({ ok: true, keyId: KEY_ID });
  });

  it('is accepted at the edge of the tolerance window, either side', () => {
    for (const offset of [-DEFAULT_TOLERANCE_SECONDS, DEFAULT_TOLERANCE_SECONDS]) {
      const timestamp = String(Number(unixSeconds(NOW)) + offset);
      const { raw, headers } = goodDelivery({ timestamp });
      expect(verifyDelivery(config, headers, raw, NOW).ok).toBe(true);
    }
  });
});

describe('the signature', () => {
  it('refuses a wrong one', () => {
    const { raw, headers } = goodDelivery();
    const wrong = { ...headers, signature: expectedSignature('not-the-secret', headers.timestamp, raw) };
    expect(verifyDelivery(config, wrong, raw, NOW)).toEqual({
      ok: false,
      reason: WebhookRejection.INVALID_SIGNATURE,
    });
  });

  it('refuses a body changed by ONE byte', () => {
    const { raw, headers } = goodDelivery();
    const tampered = Buffer.from(raw.toString('utf8').replace('e1', 'e2'), 'utf8');
    expect(verifyDelivery(config, headers, tampered, NOW).ok).toBe(false);
  });

  it('refuses a changed timestamp, because the timestamp is INSIDE the signature',
    () => {
      const { raw, headers } = goodDelivery();
      // A captured request cannot be replayed with a fresh clock: moving the
      // timestamp into the window invalidates the digest that covers it.
      const replayed = { ...headers, timestamp: String(Number(headers.timestamp) + 1) };
      expect(verifyDelivery(config, replayed, raw, NOW)).toEqual({
        ok: false,
        reason: WebhookRejection.INVALID_SIGNATURE,
      });
    });

  it('is sensitive to JSON key order', () => {
    // The same object, serialised with its keys the other way round. A boundary
    // that re-serialised before verifying would call these identical; this one
    // signs the bytes that arrived.
    const a = Buffer.from('{"event_id":"e1","event_type":"class_session.upserted"}', 'utf8');
    const b = Buffer.from('{"event_type":"class_session.upserted","event_id":"e1"}', 'utf8');
    const timestamp = unixSeconds(NOW);
    const headers = { keyId: KEY_ID, timestamp, signature: expectedSignature(SECRET, timestamp, a) };

    expect(verifyDelivery(config, headers, a, NOW).ok).toBe(true);
    expect(verifyDelivery(config, headers, b, NOW).ok).toBe(false);
  });

  it('is sensitive to whitespace', () => {
    const compact = Buffer.from('{"event_id":"e1"}', 'utf8');
    const spaced = Buffer.from('{ "event_id": "e1" }', 'utf8');
    const timestamp = unixSeconds(NOW);
    const headers = {
      keyId: KEY_ID,
      timestamp,
      signature: expectedSignature(SECRET, timestamp, compact),
    };

    expect(verifyDelivery(config, headers, compact, NOW).ok).toBe(true);
    expect(verifyDelivery(config, headers, spaced, NOW).ok).toBe(false);
  });

  it('refuses an UPPERCASE hex digest', () => {
    const { raw, headers } = goodDelivery();
    const shouted = { ...headers, signature: headers.signature.toUpperCase() };
    // Not "the same signature in a different case". The comparison is
    // byte-exact on purpose: accepting a form the sender was never told to
    // produce widens the set of accepted inputs for no reason.
    expect(verifyDelivery(config, shouted, raw, NOW).ok).toBe(false);
  });

  it('refuses a missing `sha256=` prefix', () => {
    const { raw, headers } = goodDelivery();
    const bare = { ...headers, signature: headers.signature.replace('sha256=', '') };
    expect(verifyDelivery(config, bare, raw, NOW).ok).toBe(false);
  });

  it('refuses a wrong prefix', () => {
    const { raw, headers } = goodDelivery();
    const wrong = { ...headers, signature: headers.signature.replace('sha256=', 'sha512=') };
    expect(verifyDelivery(config, wrong, raw, NOW).ok).toBe(false);
  });

  it('is HMAC-SHA256 over `{timestamp}.{rawBody}` with the secret as UTF-8 bytes', () => {
    // The construction, spelled out independently of the implementation. If
    // someone later base64-decodes the secret or drops the dot, this fails.
    const raw = body({ event_id: 'e1' });
    const timestamp = unixSeconds(NOW);
    const byHand = createHmac('sha256', Buffer.from(SECRET, 'utf8'))
      .update(Buffer.concat([Buffer.from(`${timestamp}.`, 'utf8'), raw]))
      .digest('hex');

    expect(expectedSignature(SECRET, timestamp, raw)).toBe(`sha256=${byHand}`);
    expect(byHand).toBe(byHand.toLowerCase());
  });
});

describe('the headers', () => {
  it.each([
    ['signature', { signature: undefined }],
    ['key id', { keyId: undefined }],
    ['timestamp', { timestamp: undefined }],
  ])('refuses a delivery with no %s', (_name, missing) => {
    const { raw, headers } = goodDelivery();
    expect(verifyDelivery(config, { ...headers, ...missing }, raw, NOW)).toEqual({
      ok: false,
      reason: WebhookRejection.MISSING_HEADERS,
    });
  });

  it('refuses an unknown key id', () => {
    const { raw, headers } = goodDelivery();
    expect(verifyDelivery(config, { ...headers, keyId: 'core-2099-01' }, raw, NOW)).toEqual({
      ok: false,
      reason: WebhookRejection.UNKNOWN_KEY,
    });
  });
});

describe('replay protection', () => {
  it('refuses a stale delivery', () => {
    const timestamp = String(Number(unixSeconds(NOW)) - DEFAULT_TOLERANCE_SECONDS - 1);
    const { raw, headers } = goodDelivery({ timestamp });
    expect(verifyDelivery(config, headers, raw, NOW)).toEqual({
      ok: false,
      reason: WebhookRejection.STALE_TIMESTAMP,
    });
  });

  it('refuses one from the future, beyond tolerance', () => {
    // A clock ahead of ours is as suspect as one behind: the window is ±.
    const timestamp = String(Number(unixSeconds(NOW)) + DEFAULT_TOLERANCE_SECONDS + 1);
    const { raw, headers } = goodDelivery({ timestamp });
    expect(verifyDelivery(config, headers, raw, NOW).ok).toBe(false);
  });

  it('refuses a timestamp that is not a number', () => {
    const { raw } = goodDelivery();
    const headers = { keyId: KEY_ID, timestamp: 'yesterday', signature: 'sha256=abc' };
    expect(verifyDelivery(config, headers, raw, NOW)).toEqual({
      ok: false,
      reason: WebhookRejection.STALE_TIMESTAMP,
    });
  });
});

describe('configuration', () => {
  it('an unconfigured boundary refuses everything', () => {
    const { raw, headers } = goodDelivery();
    // The whole point: no secret means no boundary, not an open one.
    expect(verifyDelivery(null, headers, raw, NOW)).toEqual({
      ok: false,
      reason: WebhookRejection.NOT_CONFIGURED,
    });
    expect(loadCoreWebhookConfig({} as never)).toBeNull();
    expect(loadCoreWebhookConfig({ CORE_WEBHOOK_SECRETS: '' } as never)).toBeNull();
  });

  it('two secrets is how a rotation lands', () => {
    const rotating = loadCoreWebhookConfig({
      CORE_WEBHOOK_SECRETS: `core-2026-09:${SECRET},core-2026-12:next-secret`,
    } as never)!;

    for (const [keyId, secret] of [
      ['core-2026-09', SECRET],
      ['core-2026-12', 'next-secret'],
    ]) {
      const raw = body({ event_id: 'e1' });
      const timestamp = unixSeconds(NOW);
      const headers = { keyId, timestamp, signature: expectedSignature(secret, timestamp, raw) };
      expect(verifyDelivery(rotating, headers, raw, NOW)).toEqual({ ok: true, keyId });
    }
  });

  it('the secret is used as raw UTF-8, not decoded', () => {
    // A secret that LOOKS like base64 or hex is still just those characters.
    const looksEncoded = 'YWJjZGVm';
    const cfg = loadCoreWebhookConfig({
      CORE_WEBHOOK_SECRETS: `k:${looksEncoded}`,
    } as never)!;
    const raw = body({ event_id: 'e1' });
    const timestamp = unixSeconds(NOW);

    const asUtf8 = expectedSignature(looksEncoded, timestamp, raw);
    expect(verifyDelivery(cfg, { keyId: 'k', timestamp, signature: asUtf8 }, raw, NOW).ok).toBe(true);

    // And the decoded interpretation is NOT accepted.
    const asDecoded = createHmac('sha256', Buffer.from(looksEncoded, 'base64'))
      .update(`${timestamp}.`, 'utf8')
      .update(raw)
      .digest('hex');
    expect(
      verifyDelivery(cfg, { keyId: 'k', timestamp, signature: `sha256=${asDecoded}` }, raw, NOW).ok,
    ).toBe(false);
  });

  it('a secret containing a colon survives, because only the first splits', () => {
    const withColon = 'part-one:part-two';
    const cfg = loadCoreWebhookConfig({ CORE_WEBHOOK_SECRETS: `k:${withColon}` } as never)!;
    expect(cfg.keys).toEqual([{ keyId: 'k', secret: withColon }]);
  });

  it.each([
    ['no colon', 'justasecret'],
    ['empty key id', ':secret'],
    ['empty secret', 'keyid:'],
  ])('drops a malformed entry (%s) rather than guessing', (_name, entry) => {
    expect(loadCoreWebhookConfig({ CORE_WEBHOOK_SECRETS: entry } as never)).toBeNull();
  });

  it('a duplicate key id does not shadow the first', () => {
    const cfg = loadCoreWebhookConfig({
      CORE_WEBHOOK_SECRETS: 'k:first,k:second',
    } as never)!;
    expect(cfg.keys).toHaveLength(1);
    expect(cfg.keys[0].secret).toBe('first');
  });

  it('the tolerance is configurable, and a bad value does not disable it', () => {
    expect(
      loadCoreWebhookConfig({
        CORE_WEBHOOK_SECRETS: 'k:s',
        CORE_WEBHOOK_TOLERANCE_SECONDS: '60',
      } as never)!.toleranceSeconds,
    ).toBe(60);

    // A typo must never be a way to turn replay protection off.
    for (const bad of ['', 'soon', '0', '-1']) {
      expect(
        loadCoreWebhookConfig({
          CORE_WEBHOOK_SECRETS: 'k:s',
          CORE_WEBHOOK_TOLERANCE_SECONDS: bad,
        } as never)!.toleranceSeconds,
      ).toBe(DEFAULT_TOLERANCE_SECONDS);
    }
  });
});

describe('the body ceiling', () => {
  it('refuses a body over 1 MiB before anything else looks at it', () => {
    const huge = Buffer.alloc(MAX_BODY_BYTES + 1, 0x61);
    const timestamp = unixSeconds(NOW);
    const headers = {
      keyId: KEY_ID,
      timestamp,
      // Correctly signed, and still refused: size is checked first, so an
      // authenticated sender cannot exhaust memory either.
      signature: expectedSignature(SECRET, timestamp, huge),
    };
    expect(verifyDelivery(config, headers, huge, NOW)).toEqual({
      ok: false,
      reason: WebhookRejection.BODY_TOO_LARGE,
    });
  });

  it('accepts a body exactly at the limit', () => {
    const atLimit = Buffer.alloc(MAX_BODY_BYTES, 0x61);
    const timestamp = unixSeconds(NOW);
    const headers = {
      keyId: KEY_ID,
      timestamp,
      signature: expectedSignature(SECRET, timestamp, atLimit),
    };
    expect(verifyDelivery(config, headers, atLimit, NOW).ok).toBe(true);
  });
});

describe('what a rejection reveals', () => {
  it('is a short stable reason and nothing else', () => {
    const { raw, headers } = goodDelivery();
    const result = verifyDelivery(config, { ...headers, signature: 'sha256=00' }, raw, NOW);

    expect(result).toEqual({ ok: false, reason: WebhookRejection.INVALID_SIGNATURE });
    // No secret, no expected digest, no body. A reason an operator can act on
    // and a prober cannot learn from.
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain(SECRET);
    expect(serialised).not.toContain(headers.signature);
    expect(serialised).not.toContain('event_id');
  });
});
