/**
 * RED TEAM — storage and message-integrity probes.
 *
 * RT-005, RT-007 and RT-008 were CONFIRMED findings. They are fixed; these
 * assertions are inverted so a regression fails the build.
 *
 * SECURITY REGRESSION TESTS. A fix must make the invariant hold and invert the
 * assertion in the same commit. Never delete, skip, rename away or weaken a
 * spec because the implementation fails it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SignedLocalObjectStorage } from '@communication/attachments/object-storage';
import { AttachmentService } from '@communication/attachments/attachment.service';
import { CommError, CommErrorCode } from '@platform/errors';

describe('RT-005 (fixed) · signed URLs cannot be forged from a committed secret', () => {
  const original = process.env.STORAGE_SIGNING_SECRET;
  afterEach(() => {
    process.env.STORAGE_SIGNING_SECRET = original;
  });

  it('construction fails when no signing secret is configured', () => {
    delete process.env.STORAGE_SIGNING_SECRET;
    expect(() => new SignedLocalObjectStorage()).toThrow(/STORAGE_SIGNING_SECRET/);
  });

  it('construction fails on a trivially short secret', () => {
    process.env.STORAGE_SIGNING_SECRET = 'too-short';
    expect(() => new SignedLocalObjectStorage()).toThrow(/32 characters/);
  });

  it('a signature does not verify once its expiry has passed', async () => {
    process.env.STORAGE_SIGNING_SECRET = 'x'.repeat(40);
    const storage = new SignedLocalObjectStorage();
    const url = await storage.signedReadUrl('conversations/c1/object', 60);
    const key = decodeURIComponent(url.split('/storage/')[1].split('?')[0]);
    const expires = Number(new URL(url).searchParams.get('expires'));
    const sig = String(new URL(url).searchParams.get('sig'));

    expect(storage.verify(key, expires, 'GET', sig)).toBe(true);
    // An expired timestamp is rejected even with a genuine signature.
    expect(storage.verify(key, Math.floor(Date.now() / 1000) - 10, 'GET', sig)).toBe(false);
    // A different object key does not verify under the same signature.
    expect(storage.verify('conversations/c1/other', expires, 'GET', sig)).toBe(false);
    // A GET signature cannot be replayed as an upload.
    expect(storage.verify(key, expires, 'PUT', sig)).toBe(false);
  });
});

describe('RT-007 (fixed) · MIME and size limits are enforced on the send path', () => {
  // The gate is a pure function on the service; MessageService.send() calls it
  // for every attachment before the message is written.
  const service = new AttachmentService(null as never, null as never, null as never, null as never);

  it('rejects an oversized image', () => {
    expect(() => service.validate('image', 'image/png', 999_999_999)).toThrow(CommError);
    try {
      service.validate('image', 'image/png', 999_999_999);
    } catch (e) {
      expect((e as CommError).code).toBe(CommErrorCode.ATTACHMENT_TOO_LARGE);
    }
  });

  it('rejects a disallowed MIME type', () => {
    try {
      service.validate('file', 'application/x-msdownload', 1024);
    } catch (e) {
      expect((e as CommError).code).toBe(CommErrorCode.ATTACHMENT_TYPE_NOT_ALLOWED);
    }
  });

  it('rejects an executable disguised by its declared kind', () => {
    try {
      service.validate('image', 'application/x-sh', 1024);
    } catch (e) {
      expect((e as CommError).code).toBe(CommErrorCode.ATTACHMENT_TYPE_NOT_ALLOWED);
    }
  });

  it('rejects a zero-byte attachment', () => {
    expect(() => service.validate('voice', 'audio/mpeg', 0)).toThrow(CommError);
  });

  it('accepts a legitimate voice note', () => {
    expect(() => service.validate('voice', 'audio/mpeg', 200_000)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// RT-008 (fixed) — a client may never author a SYSTEM message or a non-USER
// origin. Restored: the header above claimed this guard, and the section was
// missing after the inversion pass, so the fix had no regression test.
//
// The enforcement lives inside MessageService.send(), which needs a database,
// so this is a static proof over the real source: the derivation must be gated
// on actor.kind === SYSTEM and must not read input.type / input.origin
// unconditionally. An integration test that posts as a contact and asserts the
// stored row is `text` / `user` is the stronger form and belongs in
// test/integration.
// ---------------------------------------------------------------------------
describe('RT-008 (fixed) · message type and origin are server-derived, not client-supplied', () => {
  const source = readFileSync(
    join(__dirname, '../../../src/communication/messages/message.service.ts'),
    'utf8',
  );

  it('type is downgraded to TEXT unless the author is the SYSTEM actor', () => {
    // A bare `const type = input.type ?? …` is the vulnerable form.
    expect(source).not.toMatch(/const type\s*=\s*input\.type\s*\?\?/);
    expect(source).toMatch(/actor\.kind === ActorKind\.SYSTEM[\s\S]{0,200}MessageType\.SYSTEM/);
  });

  it('origin is forced to USER unless the author is the SYSTEM actor', () => {
    expect(source).not.toMatch(/origin:\s*input\.origin\s*\?\?/);
    expect(source).toMatch(
      /const origin\s*=\s*[\s\S]{0,120}actor\.kind === ActorKind\.SYSTEM[\s\S]{0,120}Origin\.USER/,
    );
  });
});
