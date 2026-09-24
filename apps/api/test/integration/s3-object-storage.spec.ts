/**
 * The S3 round trip, against a real S3-compatible server.
 *
 * This is an INTEGRATION test, not a mock. `S3ObjectStorage` is almost entirely
 * presigning and header binding, and both are properties of the *server's*
 * interpretation of a signature — a mocked SDK would assert that we called
 * `getSignedUrl` and prove nothing about whether the resulting URL uploads,
 * expires, or refuses a body that differs from the one authorized.
 *
 * It runs against **MinIO**, which `docker-compose.yml` already provisions for
 * local development, with `minio-init` setting the bucket to `anonymous: none`
 * (ADR-005). That is the repository's existing accepted pattern for
 * S3-compatible storage; no new service and no external account is introduced,
 * and no production credential exists or is needed.
 *
 * Bring it up with:
 *   docker compose up -d minio minio-init
 *
 * Skipped, loudly, when no endpoint is reachable — the same shape as the
 * Postgres integration tests, which skip without DATABASE_URL rather than
 * inventing a database.
 */
import { randomUUID } from 'node:crypto';
import {
  CreateBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { S3ObjectStorage } from '@communication/attachments/s3-object-storage';

jest.setTimeout(60_000);

/**
 * Dedicated `S3_TEST_*` names, not the application's `STORAGE_*`.
 *
 * `STORAGE_ENDPOINT` is overloaded: `SignedLocalObjectStorage` reads it as the
 * base URL of this API's own `/storage` route, and `S3ObjectStorage` reads it
 * as the bucket endpoint (`storage.provider.ts` explains why only the provider
 * has to know that). Setting it globally to run this file therefore reaches
 * into every other suite that builds the local implementation — which is
 * exactly what it did: `voice-attachment-lifecycle` started signing URLs
 * against MinIO and failed with a 403.
 *
 * Defaults match the MinIO that `docker compose up -d minio minio-init`
 * provides, so the common case needs no variables at all.
 */
const ENDPOINT = process.env.S3_TEST_ENDPOINT ?? 'http://localhost:9000';
const REGION = process.env.S3_TEST_REGION ?? 'auto';
const ACCESS_KEY = process.env.S3_TEST_ACCESS_KEY ?? 'jawwid-dev';
const SECRET_KEY = process.env.S3_TEST_SECRET_KEY ?? 'jawwid-dev-secret';

/** A bucket per run, so a failed run cannot poison the next one. */
const BUCKET = `jawwid-test-${randomUUID()}`;

let available = false;
let storage: S3ObjectStorage;
let admin: S3Client;

async function reachable(): Promise<boolean> {
  try {
    const response = await fetch(`${ENDPOINT}/minio/health/live`, {
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

beforeAll(async () => {
  available = await reachable();
  if (!available) {
    // eslint-disable-next-line no-console
    console.warn(
      `\n  S3 integration tests SKIPPED: no S3-compatible server at ${ENDPOINT}.` +
        '\n  Start one with: docker compose up -d minio minio-init' +
        '\n  Or point S3_TEST_ENDPOINT at another S3-compatible server.\n',
    );
    return;
  }

  admin = new S3Client({
    region: REGION,
    endpoint: ENDPOINT,
    forcePathStyle: true,
    credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
  });
  await admin.send(new CreateBucketCommand({ Bucket: BUCKET }));

  storage = new S3ObjectStorage({
    endpoint: ENDPOINT,
    region: REGION,
    bucket: BUCKET,
    accessKeyId: ACCESS_KEY,
    secretAccessKey: SECRET_KEY,
    signedUrlTtlSeconds: 300,
  });
});

afterAll(async () => {
  storage?.destroy();
  admin?.destroy();
});

/** Skips the body when no server is available, without failing the suite. */
const itS3 = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!available) return;
    await fn();
  });

const PREFIX = 'conversations/0b9a3a5e-3f1e-4a47-9a2a-2b0e7c1d1f11';

async function upload(
  auth: { uploadUrl: string; headers: Record<string, string> },
  body: Buffer,
): Promise<Response> {
  return fetch(auth.uploadUrl, { method: 'PUT', headers: auth.headers, body });
}

describe('upload and download', () => {
  itS3('a presigned PUT stores the bytes, and a presigned GET returns them', async () => {
    const body = Buffer.from('the voice note bytes');
    const auth = await storage.authorizeUpload({
      prefix: PREFIX,
      mimeType: 'audio/mp4',
      byteSize: body.length,
    });

    expect(auth.method).toBe('PUT');
    expect(auth.objectKey.startsWith(`${PREFIX}/`)).toBe(true);

    const put = await upload(auth, body);
    expect(put.status).toBeGreaterThanOrEqual(200);
    expect(put.status).toBeLessThan(300);

    const readUrl = await storage.signedReadUrl(auth.objectKey);
    const get = await fetch(readUrl);
    expect(get.status).toBe(200);
    expect(Buffer.from(await get.arrayBuffer()).equals(body)).toBe(true);
  });

  itS3('the stored object serves the MIME type it was authorized for', async () => {
    const body = Buffer.from('%PDF-1.4 not really');
    const auth = await storage.authorizeUpload({
      prefix: PREFIX,
      mimeType: 'application/pdf',
      byteSize: body.length,
    });
    await upload(auth, body);

    const get = await fetch(await storage.signedReadUrl(auth.objectKey));
    expect(get.headers.get('content-type')).toContain('application/pdf');
  });

  itS3('exists() distinguishes a stored object from a missing one', async () => {
    const body = Buffer.from('present');
    const auth = await storage.authorizeUpload({
      prefix: PREFIX,
      mimeType: 'text/plain',
      byteSize: body.length,
    });
    await upload(auth, body);

    expect(await storage.exists(auth.objectKey)).toBe(true);
    expect(await storage.exists(`${PREFIX}/${randomUUID()}`)).toBe(false);
  });

  itS3('a missing object reads as 404, not as empty bytes', async () => {
    const get = await fetch(await storage.signedReadUrl(`${PREFIX}/${randomUUID()}`));
    expect(get.status).toBe(404);
  });

  itS3('delete() removes an object', async () => {
    const body = Buffer.from('temporary');
    const auth = await storage.authorizeUpload({
      prefix: PREFIX,
      mimeType: 'text/plain',
      byteSize: body.length,
    });
    await upload(auth, body);
    expect(await storage.exists(auth.objectKey)).toBe(true);

    await storage.delete(auth.objectKey);
    expect(await storage.exists(auth.objectKey)).toBe(false);
  });
});

describe('the authorization is binding, not advisory', () => {
  itS3('a body larger than the one authorized is refused by storage', async () => {
    // The whole point of signing ContentLength. Without it an authorization
    // taken out for a 20 KB voice note could be spent uploading a 100 MB file,
    // and every limit AttachmentService.validate enforces would be decorative.
    const auth = await storage.authorizeUpload({
      prefix: PREFIX,
      mimeType: 'text/plain',
      byteSize: 10,
    });

    const oversized = Buffer.alloc(10_000, 0x61);
    const put = await fetch(auth.uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': 'text/plain', 'content-length': String(oversized.length) },
      body: oversized,
    });

    expect(put.status).toBeGreaterThanOrEqual(400);
  });

  itS3('a different MIME type than the one authorized is refused', async () => {
    const body = Buffer.from('<script>alert(1)</script>');
    const auth = await storage.authorizeUpload({
      prefix: PREFIX,
      mimeType: 'image/png',
      byteSize: body.length,
    });

    const put = await fetch(auth.uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': 'text/html', 'content-length': String(body.length) },
      body,
    });

    expect(put.status).toBeGreaterThanOrEqual(400);
  });
});

describe('the bucket is private and the URLs are short-lived', () => {
  itS3('an unsigned request for a stored object is refused', async () => {
    const body = Buffer.from('private content');
    const auth = await storage.authorizeUpload({
      prefix: PREFIX,
      mimeType: 'text/plain',
      byteSize: body.length,
    });
    await upload(auth, body);

    // The same object, addressed directly with no signature. ADR-005: the
    // bucket is private in every environment, so "unguessable key" is never
    // the control.
    const unsigned = await fetch(`${ENDPOINT}/${BUCKET}/${auth.objectKey}`);
    expect(unsigned.status).toBeGreaterThanOrEqual(400);
  });

  itS3('a read URL carries an expiry and is not permanent', async () => {
    const url = new URL(await storage.signedReadUrl(`${PREFIX}/${randomUUID()}`, 300));
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(url.searchParams.get('X-Amz-Signature')).toBeTruthy();
  });

  itS3('an expired signature is refused', async () => {
    const body = Buffer.from('will outlive its URL');
    const auth = await storage.authorizeUpload({
      prefix: PREFIX,
      mimeType: 'text/plain',
      byteSize: body.length,
    });
    await upload(auth, body);

    // One second, then wait past it. Asserted against the real server rather
    // than by reading the query string: expiry only matters if it is enforced.
    const shortLived = await storage.signedReadUrl(auth.objectKey, 1);
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const get = await fetch(shortLived);
    expect(get.status).toBeGreaterThanOrEqual(400);
  });

  itS3('a signed URL never contains the secret key', async () => {
    const url = await storage.signedReadUrl(`${PREFIX}/${randomUUID()}`);
    expect(url).not.toContain(SECRET_KEY);
  });

  itS3('tampering with the key in a signed URL invalidates it', async () => {
    const body = Buffer.from('for conversation A');
    const auth = await storage.authorizeUpload({
      prefix: PREFIX,
      mimeType: 'text/plain',
      byteSize: body.length,
    });
    await upload(auth, body);

    const url = await storage.signedReadUrl(auth.objectKey);
    const tampered = url.replace(auth.objectKey, `${PREFIX}/${randomUUID()}`);

    const get = await fetch(tampered);
    expect(get.status).toBeGreaterThanOrEqual(400);
  });
});

describe('two replicas share one bucket', () => {
  itS3('an object written by one client is readable by an independent one', async () => {
    // The defect this whole change exists to close. With the local reference
    // implementation the bytes sit on one container's filesystem, so an upload
    // handled by replica A is a 404 from replica B — which looks like flaky
    // storage rather than like a missing bucket.
    const replicaA = storage;
    const replicaB = new S3ObjectStorage({
      endpoint: ENDPOINT,
      region: REGION,
      bucket: BUCKET,
      accessKeyId: ACCESS_KEY,
      secretAccessKey: SECRET_KEY,
      signedUrlTtlSeconds: 300,
    });

    try {
      const body = Buffer.from('written by replica A');
      const auth = await replicaA.authorizeUpload({
        prefix: PREFIX,
        mimeType: 'text/plain',
        byteSize: body.length,
      });
      await upload(auth, body);

      // Independent client, independent signature, same object.
      expect(await replicaB.exists(auth.objectKey)).toBe(true);
      const get = await fetch(await replicaB.signedReadUrl(auth.objectKey));
      expect(get.status).toBe(200);
      expect(Buffer.from(await get.arrayBuffer()).equals(body)).toBe(true);
    } finally {
      replicaB.destroy();
    }
  });

  itS3('the production storage path touches no local filesystem', async () => {
    const body = Buffer.from('never on disk here');
    const auth = await storage.authorizeUpload({
      prefix: PREFIX,
      mimeType: 'text/plain',
      byteSize: body.length,
    });
    await upload(auth, body);

    // The upload and read URLs address the bucket, not this API. If either
    // pointed back at the process, LocalFsBlobStore would be on the path again.
    expect(auth.uploadUrl.startsWith(ENDPOINT)).toBe(true);
    expect((await storage.signedReadUrl(auth.objectKey)).startsWith(ENDPOINT)).toBe(true);
    expect(auth.uploadUrl).not.toContain('/storage/');
  });
});
