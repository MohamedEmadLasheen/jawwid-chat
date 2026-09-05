/**
 * RED TEAM (AI #9) — attacks on attachment storage and message integrity.
 * See the header of authz-attacks.spec.ts for the convention used here.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MessageType } from '@prisma/client';
import { SignedLocalObjectStorage } from '@communication/attachments/object-storage';
import { AttachmentService } from '@communication/attachments/attachment.service';
import { MessageService } from '@communication/messages/message.service';

// ---------------------------------------------------------------------------
// RT-004 — the storage signer falls back to a hardcoded secret
// ---------------------------------------------------------------------------
describe('RT-004 · signed storage URLs are forgeable when STORAGE_SIGNING_SECRET is unset', () => {
  const saved = process.env.STORAGE_SIGNING_SECRET;
  afterAll(() => {
    if (saved === undefined) delete process.env.STORAGE_SIGNING_SECRET;
    else process.env.STORAGE_SIGNING_SECRET = saved;
  });

  it('CONFIRMED: with the env var unset the signer uses a value committed to git', async () => {
    delete process.env.STORAGE_SIGNING_SECRET;
    const victim = new SignedLocalObjectStorage();

    // The attacker knows the fallback because it is a string literal in
    // object-storage.ts, and .env.example never mentions the variable, so an
    // operator following the documented setup never sets it.
    const attackerSigner = new SignedLocalObjectStorage();
    const targetKey = 'threads/some-other-familys-thread/00000000-0000-0000-0000-000000000000';
    const forged = await attackerSigner.signedReadUrl(targetKey, 3600);

    const expires = Number(new URL(forged).searchParams.get('expires'));
    const sig = new URL(forged).searchParams.get('sig') as string;

    // SECURE BEHAVIOUR: startup fails when the signing secret is absent.
    expect(victim.verify(targetKey, expires, 'GET', sig)).toBe(true);
  });

  it('CONFIRMED: signedReadUrl signs any object key, with no ownership check', async () => {
    const storage = new SignedLocalObjectStorage();
    // No thread, no actor, no attachment row is consulted. The signature is a
    // bearer capability over a caller-chosen key.
    const url = await storage.signedReadUrl('threads/../../etc/anything', 60);
    expect(url).toContain('sig=');
  });
});

// ---------------------------------------------------------------------------
// RT-005 — the send path never validates attachment metadata
// ---------------------------------------------------------------------------
describe('RT-005 · MIME and size limits are enforced on upload authorization only', () => {
  const attachments = new AttachmentService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  it('the upload-authorization gate itself is correct', () => {
    expect(() => attachments.validate(MessageType.IMAGE, 'text/html', 1024)).toThrow();
    expect(() => attachments.validate(MessageType.IMAGE, 'image/svg+xml', 1024)).toThrow();
    expect(() => attachments.validate(MessageType.IMAGE, 'image/png', 999_999_999)).toThrow();
    expect(() => attachments.validate(MessageType.IMAGE, 'image/png', 1024)).not.toThrow();
  });

  it('CONFIRMED: MessageService never calls that gate', () => {
    // Static proof over the real source file: the only validation
    // MessageService performs on an inbound attachment is "is the array
    // non-empty" (validateContent). kind, mimeType, byteSize and objectKey are
    // persisted verbatim from the request body, and mimeType is what every
    // client renders the attachment as.
    const source = readFileSync(
      join(__dirname, '../../../src/communication/messages/message.service.ts'),
      'utf8',
    );
    expect(source).toMatch(/objectKey: a\.objectKey/); // persisted verbatim
    expect(source).not.toMatch(/AttachmentService/);
    expect(source).not.toMatch(/\.validate\(/);
    // MessageService is imported here only to keep this test honest about which
    // class is under attack.
    expect(typeof MessageService).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// RT-006 — a parent can forge a SYSTEM / AUTOMATION message
// ---------------------------------------------------------------------------
describe('RT-006 · message type and origin are client-controlled', () => {
  const validateContent = (
    MessageService.prototype as unknown as {
      validateContent(type: MessageType, input: unknown): void;
    }
  ).validateContent;

  it('CONFIRMED: type=SYSTEM bypasses both the body and the attachment requirement', () => {
    // A CONTACT (parent) passes authorization for a CUSTOMER-visibility message
    // in their own family thread. Nothing downstream constrains `type` or
    // `origin` by actor kind, and validateContent exempts SYSTEM from every
    // content requirement — so the row is written with
    // authorType=CONTACT, type=SYSTEM, origin=AUTOMATION and rendered by every
    // client as an official Jawwid notice.
    expect(() =>
      validateContent.call(null, MessageType.SYSTEM, { body: null, attachments: [] }),
    ).not.toThrow();

    // Control: the same emptiness is rejected for every other type.
    expect(() =>
      validateContent.call(null, MessageType.TEXT, { body: '   ', attachments: [] }),
    ).toThrow();
    expect(() =>
      validateContent.call(null, MessageType.IMAGE, { body: null, attachments: [] }),
    ).toThrow();
  });
});
