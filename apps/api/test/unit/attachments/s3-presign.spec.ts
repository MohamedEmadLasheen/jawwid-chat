/**
 * The S3/MinIO presigner.
 *
 * Phase 2's storage item (`docs/architecture/JAWUID-CHAT-ARCHITECTURE.md` §2.5:
 * "replaces the local signer with the S3/MinIO implementation behind the same
 * `ObjectStorage` interface"). Until it landed, `STORAGE_ENDPOINT` pointed at
 * MinIO in every environment while the URLs were signed for a path this API
 * serves, so an authorized upload could not actually be uploaded.
 *
 * These are UNIT tests of the signature's SHAPE. Whether MinIO accepts it is a
 * different question and a stronger one; `scripts/qa/phase2-smoke/storage.mjs`
 * answers it against a real bucket by uploading bytes and reading them back.
 * Both are needed: this one runs everywhere and localises a break to a rule,
 * that one proves the rules add up to a working URL.
 */
import { S3ObjectStorage } from '@communication/attachments/s3-object-storage';

const ENV = {
  STORAGE_ENDPOINT: 'http://storage.test:9000',
  STORAGE_BUCKET: 'jawwid-chat-attachments',
  STORAGE_ACCESS_KEY: 'test-access-key',
  STORAGE_SECRET_KEY: 'test-secret-key',
  STORAGE_REGION: 'us-east-1',
  STORAGE_SIGNED_URL_TTL_SECONDS: '300',
};

const original = { ...process.env };

function withEnv(overrides: Record<string, string | undefined> = {}): S3ObjectStorage {
  Object.assign(process.env, ENV, overrides);
  return new S3ObjectStorage();
}

beforeEach(() => {
  process.env = { ...original };
});
afterAll(() => {
  process.env = original;
});

describe('configuration', () => {
  it('reports itself configured only when every variable is present', () => {
    process.env = { ...original, ...ENV };
    expect(S3ObjectStorage.isConfigured()).toBe(true);

    for (const key of [
      'STORAGE_ENDPOINT',
      'STORAGE_BUCKET',
      'STORAGE_ACCESS_KEY',
      'STORAGE_SECRET_KEY',
    ]) {
      process.env = { ...original, ...ENV };
      delete process.env[key];
      expect(S3ObjectStorage.isConfigured()).toBe(false);
    }
  });

  it('refuses to construct without credentials rather than defaulting', () => {
    process.env = { ...original, ...ENV };
    delete process.env.STORAGE_SECRET_KEY;
    // A default credential is a credential in the repository, and a default
    // endpoint is an environment somebody uploads to by accident.
    expect(() => new S3ObjectStorage()).toThrow(/STORAGE_/);
  });

  it('refuses a TTL outside what SigV4 admits', () => {
    // A misconfigured 0 would otherwise mint URLs every backend rejects as
    // malformed, which reads as "attachments are broken" rather than as "that
    // variable is wrong".
    for (const ttl of ['0', '-1', '604801', 'not-a-number']) {
      expect(() => withEnv({ STORAGE_SIGNED_URL_TTL_SECONDS: ttl })).toThrow(/604800/);
    }
  });
});

describe('presigned URLs', () => {
  it('addresses the bucket path-style, under the endpoint', async () => {
    const storage = withEnv();
    const url = new URL(await storage.signedReadUrl('conversations/c1/obj', 300));

    expect(url.origin).toBe('http://storage.test:9000');
    expect(url.pathname).toBe('/jawwid-chat-attachments/conversations/c1/obj');
  });

  it('carries every SigV4 query parameter, and a signature', async () => {
    const storage = withEnv();
    const url = new URL(await storage.signedReadUrl('conversations/c1/obj', 300));

    expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('host');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(url.searchParams.get('X-Amz-Credential')).toMatch(
      /^test-access-key\/\d{8}\/us-east-1\/s3\/aws4_request$/,
    );
    expect(url.searchParams.get('X-Amz-Date')).toMatch(/^\d{8}T\d{6}Z$/);
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('signs GET and PUT differently — a read URL is not an upload URL', async () => {
    const storage = withEnv();
    const read = new URL(await storage.signedReadUrl('conversations/c1/obj', 300));
    const upload = new URL(
      (await storage.authorizeUpload({
        prefix: 'conversations/c1',
        mimeType: 'image/png',
        byteSize: 10,
      })).uploadUrl,
    );

    // Different keys, so compare the one thing that must differ for the same
    // key: sign a read of the upload's own key and check the signatures differ.
    const readOfUpload = new URL(
      await storage.signedReadUrl(upload.pathname.split('/').slice(2).join('/'), 300),
    );
    expect(readOfUpload.searchParams.get('X-Amz-Signature')).not.toBe(
      upload.searchParams.get('X-Amz-Signature'),
    );
  });

  it('mints a server-generated key under the conversation prefix', async () => {
    const storage = withEnv();
    const auth = await storage.authorizeUpload({
      prefix: 'conversations/c1',
      mimeType: 'image/png',
      byteSize: 10,
    });

    // A client-supplied name would let one caller overwrite another's object,
    // and would put user text into a storage path.
    expect(auth.objectKey).toMatch(
      /^conversations\/c1\/[0-9a-f-]{36}$/,
    );
    expect(auth.method).toBe('PUT');
    expect(auth.headers['content-type']).toBe('image/png');
    expect(new Date(auth.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('encodes to RFC 3986, not to encodeURIComponent', async () => {
    const storage = withEnv();
    // encodeURIComponent leaves ! ' ( ) * alone; SigV4 requires them encoded,
    // and a key containing one would otherwise verify locally and be rejected
    // by storage.
    const url = await storage.signedReadUrl("conversations/c1/it's (a) test*", 300);

    expect(url).toContain('%27');
    expect(url).toContain('%28');
    expect(url).toContain('%29');
    expect(url).toContain('%2A');
    expect(url).not.toMatch(/[!'()*]/);
  });

  it('keeps the slashes in an object key as path separators', async () => {
    const storage = withEnv();
    const url = new URL(await storage.signedReadUrl('a/b/c/d', 300));
    // Encoding them would address one object literally named "a/b/c/d".
    expect(url.pathname).toBe('/jawwid-chat-attachments/a/b/c/d');
  });

  it('produces a different signature for a different key', async () => {
    const storage = withEnv();
    const one = new URL(await storage.signedReadUrl('conversations/c1/a', 300));
    const two = new URL(await storage.signedReadUrl('conversations/c1/b', 300));

    expect(one.searchParams.get('X-Amz-Signature')).not.toBe(
      two.searchParams.get('X-Amz-Signature'),
    );
  });

  it('produces a different signature under a different secret', async () => {
    const a = withEnv();
    const urlA = new URL(await a.signedReadUrl('conversations/c1/obj', 300));

    process.env = { ...original };
    const b = withEnv({ STORAGE_SECRET_KEY: 'a-different-secret' });
    const urlB = new URL(await b.signedReadUrl('conversations/c1/obj', 300));

    expect(urlA.searchParams.get('X-Amz-Signature')).not.toBe(
      urlB.searchParams.get('X-Amz-Signature'),
    );
  });

  it('never puts the secret key in the URL', async () => {
    const storage = withEnv();
    const url = await storage.signedReadUrl('conversations/c1/obj', 300);

    expect(url).not.toContain('test-secret-key');
    // The ACCESS key is public by design and appears in X-Amz-Credential.
    expect(url).toContain('test-access-key');
  });
});
