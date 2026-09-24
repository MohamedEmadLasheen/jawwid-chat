import {
  assertSafeObjectKey,
  buildObjectKey,
} from '@communication/attachments/s3-object-storage';
import {
  readS3Config,
  selectObjectStorage,
  S3_STORAGE_VARS,
} from '@communication/attachments/storage.provider';
import { SignedLocalObjectStorage } from '@communication/attachments/object-storage';

/**
 * Which storage a process runs, and which object keys it will accept.
 *
 * Unit tests: no network, no bucket, no credentials. The S3 round trip itself
 * is `test/integration/s3-object-storage.spec.ts`, against MinIO — the same
 * S3-compatible server `docker-compose.yml` already runs for local development.
 */
const silent = { log: () => {}, warn: () => {} };

/** A complete, syntactically valid S3 configuration. Values are fictitious. */
function s3Env(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    STORAGE_ENDPOINT: 'http://storage.invalid:9000',
    STORAGE_REGION: 'auto',
    STORAGE_BUCKET: 'test-bucket',
    STORAGE_ACCESS_KEY: 'test-access-key',
    STORAGE_SECRET_KEY: 'test-secret-key',
    ...overrides,
  };
}

describe('choosing a storage implementation', () => {
  it('uses S3 when the whole configuration is present', () => {
    const { kind } = selectObjectStorage(s3Env(), silent);
    expect(kind).toBe('s3');
  });

  it('falls back to the local reference implementation when none of it is set', () => {
    const previous = process.env.STORAGE_SIGNING_SECRET;
    process.env.STORAGE_SIGNING_SECRET = 'x'.repeat(32);
    try {
      const { kind, storage } = selectObjectStorage({}, silent);
      expect(kind).toBe('local');
      expect(storage).toBeInstanceOf(SignedLocalObjectStorage);
    } finally {
      if (previous === undefined) delete process.env.STORAGE_SIGNING_SECRET;
      else process.env.STORAGE_SIGNING_SECRET = previous;
    }
  });

  it('warns that local storage is replica-local and lost on redeploy', () => {
    const previous = process.env.STORAGE_SIGNING_SECRET;
    process.env.STORAGE_SIGNING_SECRET = 'x'.repeat(32);
    const warnings: string[] = [];
    try {
      selectObjectStorage({}, { log: () => {}, warn: (m: string) => warnings.push(m) });
    } finally {
      if (previous === undefined) delete process.env.STORAGE_SIGNING_SECRET;
      else process.env.STORAGE_SIGNING_SECRET = previous;
    }
    expect(warnings.join(' ')).toMatch(/not shared between replicas/);
    expect(warnings.join(' ')).toMatch(/lost on redeploy/);
  });

  describe('a half-configured bucket is a startup failure, never a fallback', () => {
    // The dangerous state. Falling back to local storage here produces a
    // deployment that boots, accepts uploads, and writes them to a filesystem
    // the next deploy deletes — while the configuration says "bucket".
    for (const omitted of S3_STORAGE_VARS) {
      it(`refuses to start when only ${omitted} is missing`, () => {
        const env = s3Env();
        delete env[omitted];
        expect(() => selectObjectStorage(env, silent)).toThrow(/partially configured/);
        expect(() => selectObjectStorage(env, silent)).toThrow(new RegExp(omitted));
      });
    }

    it('names every missing variable, not just the first', () => {
      const env = s3Env();
      delete env.STORAGE_ACCESS_KEY;
      delete env.STORAGE_SECRET_KEY;
      expect(() => selectObjectStorage(env, silent)).toThrow(/STORAGE_ACCESS_KEY/);
      expect(() => selectObjectStorage(env, silent)).toThrow(/STORAGE_SECRET_KEY/);
    });
  });

  describe('signed URL lifetime', () => {
    it('defaults to the ADR-005 value when unset', () => {
      expect(readS3Config(s3Env()).signedUrlTtlSeconds).toBe(300);
    });

    it('refuses a lifetime beyond an hour', () => {
      // A signed URL is a bearer credential for one object. A long one outlives
      // the screen it was rendered on and ends up in logs and pasted tickets.
      expect(() =>
        readS3Config(s3Env({ STORAGE_SIGNED_URL_TTL_SECONDS: '86400' })),
      ).toThrow(/must not exceed 3600/);
    });

    it('refuses a non-positive lifetime', () => {
      for (const bad of ['0', '-1', 'soon']) {
        expect(() =>
          readS3Config(s3Env({ STORAGE_SIGNED_URL_TTL_SECONDS: bad })),
        ).toThrow(/positive number of seconds/);
      }
    });
  });

  it('refuses an endpoint that is not an absolute http(s) URL', () => {
    for (const bad of ['storage.invalid', '/bucket', 'ftp://storage.invalid']) {
      expect(() => readS3Config(s3Env({ STORAGE_ENDPOINT: bad }))).toThrow(/absolute http/);
    }
  });

  it('never returns credentials from the config reader as part of a URL', () => {
    // Belt to the braces in S3ObjectStorage: the key pair is read here and is
    // not echoed into anything a caller could hand to a client.
    const config = readS3Config(s3Env());
    expect(config.accessKeyId).toBe('test-access-key');
    expect(JSON.stringify({ endpoint: config.endpoint, bucket: config.bucket })).not.toMatch(
      /test-secret-key/,
    );
  });
});

describe('object keys cannot leave their conversation', () => {
  it('builds a key inside the authorized prefix', () => {
    const key = buildObjectKey('conversations/abc');
    expect(key.startsWith('conversations/abc/')).toBe(true);
  });

  it('builds a unique key each time', () => {
    const a = buildObjectKey('conversations/abc');
    const b = buildObjectKey('conversations/abc');
    expect(a).not.toBe(b);
  });

  describe('rejects a key that escapes or confuses the namespace', () => {
    const hostile: Array<[string, string]> = [
      ['parent traversal', 'conversations/a/../b/obj'],
      ['leading traversal', '../etc/passwd'],
      ['current-dir segment', 'conversations/./obj'],
      ['absolute key', '/conversations/a/obj'],
      ['backslash', 'conversations\\a\\obj'],
      ['empty segment', 'conversations//obj'],
      ['NUL byte', 'conversations/a/obj\u0000.png'],
      ['control character', 'conversations/a/obj\u0007'],
      ['empty key', ''],
    ];

    for (const [name, key] of hostile) {
      it(name, () => {
        expect(() => assertSafeObjectKey(key)).toThrow();
      });
    }

    it('an over-long key', () => {
      expect(() => assertSafeObjectKey('a'.repeat(1025))).toThrow(/1024/);
    });
  });

  it('rejects a hostile prefix before a key is built from it', () => {
    for (const prefix of ['conversations/../other', '/conversations/a', 'conversations/a/']) {
      expect(() => buildObjectKey(prefix)).toThrow();
    }
  });

  it('accepts the shape AttachmentService actually passes', () => {
    // `conversations/<uuid>` — the authorization boundary itself.
    expect(() =>
      buildObjectKey('conversations/0b9a3a5e-3f1e-4a47-9a2a-2b0e7c1d1f11'),
    ).not.toThrow();
  });
});
