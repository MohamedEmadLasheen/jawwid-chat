import {
  LOCAL_PUBLIC_BASE_URL_DEFAULT,
  LOCAL_PUBLIC_BASE_URL_VAR,
  resolveLocalPublicBaseUrl,
} from '@communication/attachments/storage-config';
import { selectObjectStorage } from '@communication/attachments/storage.provider';
import { SignedLocalObjectStorage } from '@communication/attachments/object-storage';

/**
 * The local reference storage's public base URL.
 *
 * WHY THIS FILE EXISTS. `SignedLocalObjectStorage` used to read
 * `STORAGE_ENDPOINT` as its public base URL. That variable is also one of the
 * five whose presence SELECTS the S3 backend, so a QA deployment that set it to
 * reach the local `/storage` route did not get reachable URLs -- it got an API
 * that refused to boot with "object storage is partially configured". The fix is
 * a separate variable, and the property worth pinning is the SEPARATION: neither
 * variable may stand in for the other, in either direction.
 */
const silent = { log: () => {}, warn: () => {} };

/** The local implementation refuses to construct without a signing secret. */
function withSecret<T>(run: () => T): T {
  const previous = process.env.STORAGE_SIGNING_SECRET;
  process.env.STORAGE_SIGNING_SECRET = 'x'.repeat(32);
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env.STORAGE_SIGNING_SECRET;
    else process.env.STORAGE_SIGNING_SECRET = previous;
  }
}

describe('resolving the local public base URL', () => {
  it('defaults to this API on localhost, under its global prefix', () => {
    const resolved = resolveLocalPublicBaseUrl({});
    expect(resolved.value).toBe(LOCAL_PUBLIC_BASE_URL_DEFAULT);
    expect(resolved.configured).toBe(false);
    // The regression the old default had: main.ts applies `api/v1` to every
    // route but `health*`, so a base URL without it 404s.
    expect(resolved.value).toContain('/api/v1/storage');
  });

  it('uses the configured value and reports it as configured', () => {
    const resolved = resolveLocalPublicBaseUrl({
      [LOCAL_PUBLIC_BASE_URL_VAR]: 'http://192.168.1.61:3399/api/v1/storage',
    });
    expect(resolved.value).toBe('http://192.168.1.61:3399/api/v1/storage');
    expect(resolved.configured).toBe(true);
  });

  it('normalises a trailing slash, because callers join with one', () => {
    const resolved = resolveLocalPublicBaseUrl({
      [LOCAL_PUBLIC_BASE_URL_VAR]: 'https://api.example/api/v1/storage/',
    });
    expect(resolved.value).toBe('https://api.example/api/v1/storage');
  });

  it('refuses a value that is not an absolute http(s) URL', () => {
    expect(() =>
      resolveLocalPublicBaseUrl({ [LOCAL_PUBLIC_BASE_URL_VAR]: '/api/v1/storage' }),
    ).toThrow(/absolute http\(s\) URL/);
    // And the error points at the right variable rather than the trap.
    expect(() =>
      resolveLocalPublicBaseUrl({ [LOCAL_PUBLIC_BASE_URL_VAR]: 'storage.example' }),
    ).toThrow(/NOT the S3 endpoint/);
  });

  it('never falls back to STORAGE_ENDPOINT', () => {
    // The whole point. An S3 endpoint is not a public API base URL, and reading
    // one as the other is the defect this variable exists to remove.
    const resolved = resolveLocalPublicBaseUrl({
      STORAGE_ENDPOINT: 'http://storage.invalid:9000',
    });
    expect(resolved.value).toBe(LOCAL_PUBLIC_BASE_URL_DEFAULT);
    expect(resolved.configured).toBe(false);
  });
});

describe('STORAGE_PUBLIC_BASE_URL and backend selection', () => {
  it('does not count toward S3 selection', () => {
    // If it did, setting it alone would be a "partial S3 configuration" and the
    // process would refuse to start -- exactly the failure that was reported.
    withSecret(() => {
      const { kind } = selectObjectStorage(
        { [LOCAL_PUBLIC_BASE_URL_VAR]: 'http://192.168.1.61:3399/api/v1/storage' },
        silent,
      );
      expect(kind).toBe('local');
    });
  });

  it('mints upload and download URLs at the configured base', async () => {
    const { storage } = withSecret(() =>
      selectObjectStorage(
        { [LOCAL_PUBLIC_BASE_URL_VAR]: 'http://192.168.1.61:3399/api/v1/storage' },
        silent,
      ),
    );

    const auth = await storage.authorizeUpload({
      prefix: 'teacher-certificates/t1',
      mimeType: 'application/pdf',
      byteSize: 1024,
    });
    expect(auth.uploadUrl.startsWith('http://192.168.1.61:3399/api/v1/storage/')).toBe(true);
    expect(auth.uploadUrl).toContain('sig=');

    const read = await storage.signedReadUrl(auth.objectKey, 60);
    expect(read.startsWith('http://192.168.1.61:3399/api/v1/storage/')).toBe(true);
  });

  it('warns, naming the variable, when local storage is left on the default', () => {
    const warnings: string[] = [];
    withSecret(() =>
      selectObjectStorage({}, { log: () => {}, warn: (m: string) => warnings.push(m) }),
    );
    const warning = warnings.join('\n');
    expect(warning).toContain(LOCAL_PUBLIC_BASE_URL_VAR);
    // And steers away from the trap rather than leaving it to be rediscovered.
    expect(warning).toContain('STORAGE_ENDPOINT');
  });

  it('warns that it is ignored when S3 is the selected backend', () => {
    const warnings: string[] = [];
    selectObjectStorage(
      {
        STORAGE_ENDPOINT: 'http://storage.invalid:9000',
        STORAGE_REGION: 'auto',
        STORAGE_BUCKET: 'b',
        STORAGE_ACCESS_KEY: 'k',
        STORAGE_SECRET_KEY: 's',
        [LOCAL_PUBLIC_BASE_URL_VAR]: 'http://192.168.1.61:3399/api/v1/storage',
      },
      { log: () => {}, warn: (m: string) => warnings.push(m) },
    );
    expect(warnings.join('\n')).toMatch(/STORAGE_PUBLIC_BASE_URL is set but ignored/);
  });
});

describe('the signature is unchanged by where the URL points', () => {
  it('still verifies a PUT only against its authorized type and size', async () => {
    const storage = withSecret(
      () => new SignedLocalObjectStorage({ publicBaseUrl: 'https://api.example/api/v1/storage' }),
    );
    const auth = await storage.authorizeUpload({
      prefix: 'attachments/c1',
      mimeType: 'image/png',
      byteSize: 10,
    });
    const url = new URL(auth.uploadUrl);
    const expires = Number(url.searchParams.get('expires'));
    const sig = url.searchParams.get('sig')!;

    expect(
      storage.verify(auth.objectKey, expires, 'PUT', sig, {
        mimeType: 'image/png',
        byteSize: 10,
      }),
    ).toBe(true);
    // A different size is a different signature: the base URL is not in the
    // payload, so changing it must not have widened what a signature covers.
    expect(
      storage.verify(auth.objectKey, expires, 'PUT', sig, {
        mimeType: 'image/png',
        byteSize: 11,
      }),
    ).toBe(false);
    expect(storage.verify(auth.objectKey, expires, 'PUT', sig)).toBe(false);
  });
});
