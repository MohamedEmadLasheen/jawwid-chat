import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { parseByteRange } from './object-storage';
import type { ObjectStorage, StoredObject, StoredObjectHead, UploadAuthorization } from './object-storage';
import { assertSafeObjectKey, buildObjectKey } from './object-key';

/**
 * `ObjectStorage` against S3-compatible storage. Owner: AI #7 (infrastructure).
 *
 * This is the implementation `object-storage.ts` was written to be replaced by:
 * "Swap the reference implementation for S3/MinIO by providing another class
 * for the OBJECT_STORAGE token." The seam is unchanged -- nothing in the
 * communication domain imports this file, and `AttachmentService` still talks
 * only to the `ObjectStorage` interface.
 *
 * ## Why this had to exist before anything can scale
 *
 * The reference implementation signs URLs that point back at this API and
 * stores the bytes through `LocalFsBlobStore`, on the container's own disk.
 * That is correct for a laptop and wrong for a deployment: the bytes do not
 * survive a redeploy, and a second API replica cannot read what the first one
 * wrote. Uploads would succeed and reads would 404 for roughly half of
 * requests, which reads as flaky storage rather than as a missing bucket.
 *
 * ## S3-compatible, not R2-specific
 *
 * Every call here is plain S3: PutObject, GetObject, HeadObject, DeleteObject
 * and SigV4 presigning. Cloudflare R2 is reached by pointing
 * `STORAGE_ENDPOINT` at an R2 endpoint and `STORAGE_REGION` at `auto`; MinIO
 * and AWS S3 work the same way. No endpoint, account id or provider hostname is
 * hard-coded, and no provider-specific API is used -- choosing the provider
 * remains a configuration decision, not a code change.
 *
 * ## What the presigned URLs commit the client to
 *
 * The reference implementation binds `mimeType` and `byteSize` into its HMAC so
 * that an authorization taken out for a 20 KB voice note cannot be spent
 * uploading a 100 MB file. The same property is preserved here, enforced by
 * storage rather than by us: `ContentType` and `ContentLength` are part of the
 * signed request, so S3 rejects a PUT whose headers differ from the ones that
 * were authorized. `AttachmentService.validate` decides the limits; this makes
 * them binding at write time.
 */
@Injectable()
export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly ttl: number;

  constructor(config: S3StorageConfig) {
    this.bucket = config.bucket;
    this.ttl = config.signedUrlTtlSeconds;
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      // Path-style addressing. Virtual-host style requires the bucket to be a
      // DNS label of the endpoint, which is true for AWS and not reliably true
      // for R2 or a self-hosted MinIO. Path style works on all three.
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      // Bounded waits. The SDK's own defaults are no connect timeout and no
      // response timeout, so a storage endpoint that accepts the connection and
      // never answers held a request (and an agent socket) for minutes, three
      // attempts over. Now: a connection in connectTimeoutMs, response headers
      // in requestTimeoutMs, and a socket idle mid-body for requestTimeoutMs is
      // destroyed -- each a TimeoutError -- at most maxAttempts times.
      maxAttempts: config.maxAttempts ?? STORAGE_TIMEOUT_DEFAULTS.maxAttempts,
      requestHandler: {
        connectionTimeout: config.connectTimeoutMs ?? STORAGE_TIMEOUT_DEFAULTS.connectTimeoutMs,
        requestTimeout: config.requestTimeoutMs ?? STORAGE_TIMEOUT_DEFAULTS.requestTimeoutMs,
        throwOnRequestTimeout: true,
        socketTimeout: config.requestTimeoutMs ?? STORAGE_TIMEOUT_DEFAULTS.requestTimeoutMs,
      },
    });
  }

  async authorizeUpload(params: {
    prefix: string;
    mimeType: string;
    byteSize: number;
  }): Promise<UploadAuthorization> {
    const objectKey = buildObjectKey(params.prefix);
    const expiresIn = this.ttl;

    const uploadUrl = await getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        ContentType: params.mimeType,
        ContentLength: params.byteSize,
      }),
      {
        expiresIn,
        // `signableHeaders` is load-bearing and was not obvious.
        //
        // Setting ContentType on the command alone does NOT bind it: SigV4
        // verifies only the headers named in SignedHeaders, and the presigner
        // does not include content-type by default. Without this, a URL signed
        // for `image/png` accepts a `text/html` body, and a later signed read
        // serves that HTML from the storage origin -- stored XSS, reached
        // through an authorization we issued ourselves.
        //
        // The integration test against MinIO caught exactly this: the upload
        // returned 200. Naming both headers here makes storage refuse a PUT
        // whose type or length differs from the one authorized, which restores
        // the binding the local reference implementation already had in its
        // HMAC.
        signableHeaders: new Set(['content-type', 'content-length']),
      },
    );

    return {
      objectKey,
      uploadUrl,
      method: 'PUT',
      // The client MUST send both. They are inside the signature, so a PUT that
      // omits or changes either is refused by storage -- which is what makes
      // the size and type limits enforceable rather than advisory.
      headers: {
        'content-type': params.mimeType,
        'content-length': String(params.byteSize),
      },
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    };
  }

  /**
   * A short-lived presigned GET. Never a permanent URL, and never a public
   * one: the bucket stays private in every environment (ADR-005), so an object
   * is unreachable without a signature this API issued after authorizing the
   * read.
   */
  async signedReadUrl(objectKey: string, ttlSeconds = this.ttl, opts: { cacheControl?: string } = {}): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: assertSafeObjectKey(objectKey),
        ...(opts.cacheControl ? { ResponseCacheControl: opts.cacheControl } : {}),
      }),
      { expiresIn: ttlSeconds },
    );
  }

  /**
   * Whether the bytes actually arrived.
   *
   * Not on the `ObjectStorage` interface, because the message path does not
   * need it: a message references an object key and a signed read either
   * produces bytes or does not. It exists for operational checks and for the
   * tests, which have to be able to assert that a PUT landed.
   */
  async exists(objectKey: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: assertSafeObjectKey(objectKey) }),
      );
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  /**
   * Remove an object.
   *
   * On the `ObjectStorage` interface since stories landed, and still
   * deliberately not called from the message path: `deleteForEveryone` keeps the
   * row and stops serving the body, and no retention policy has been decided for
   * attachments (PRD 11.1). Stories DO have one -- access ends at expires_at and
   * the bytes are purged story.media_retention_hours later -- which is the
   * lifecycle decision this method was left here waiting for.
   */
  async delete(objectKey: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: assertSafeObjectKey(objectKey) }),
    );
  }

  /** Server-side CopyObject within the bucket: no bytes pass through the API. */
  async copy(sourceKey: string, targetKey: string): Promise<boolean> {
    const source = assertSafeObjectKey(sourceKey);
    try {
      await this.client.send(
        new CopyObjectCommand({
          Bucket: this.bucket,
          Key: assertSafeObjectKey(targetKey),
          CopySource: `${this.bucket}/${source.split('/').map(encodeURIComponent).join('/')}`,
        }),
      );
      return true;
    } catch (error) {
      const name = (error as { name?: string }).name;
      if (name === 'NoSuchKey' || name === 'NotFound') return false;
      throw error;
    }
  }

  /**
   * A ranged GET: the first `maxBytes` and nothing more cross the network. The
   * total size comes from `Content-Range` (`bytes 0-N/TOTAL`); an object
   * smaller than the range is answered whole, with no Content-Range, and then
   * its length is the total.
   */
  async readHead(objectKey: string, maxBytes: number): Promise<StoredObjectHead | null> {
    try {
      const out = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: assertSafeObjectKey(objectKey),
          Range: `bytes=0-${Math.max(0, maxBytes - 1)}`,
        }),
      );
      const head = Buffer.from((await out.Body?.transformToByteArray()) ?? new Uint8Array());
      const total = /\/(\d+)$/.exec(out.ContentRange ?? '')?.[1];
      return {
        head: head.subarray(0, maxBytes),
        byteSize: total ? Number(total) : head.length,
        contentType: out.ContentType ?? null,
      };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  /**
   * RT-037. Read through this API instead of handing out a presigned URL: a
   * HEAD for the size and type, then the GET (ranged when asked), streamed.
   */
  async read(objectKey: string, rangeHeader?: string | string[]): Promise<StoredObject | 'unsatisfiable' | null> {
    const Key = assertSafeObjectKey(objectKey);
    let size: number;
    let mimeType: string;
    try {
      const head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key }));
      size = Number(head.ContentLength ?? 0);
      mimeType = head.ContentType ?? 'application/octet-stream';
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
    const range = parseByteRange(rangeHeader, size);
    if (range === 'unsatisfiable') return 'unsatisfiable';
    const got = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key,
        ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}),
      }),
    );
    const body = got.Body as unknown as AsyncIterable<Uint8Array> | undefined;
    if (!body) return null;
    return { mimeType, size, range, body };
  }

  /** Releases the underlying HTTP handler. */
  destroy(): void {
    this.client.destroy();
  }
}

export interface S3StorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  signedUrlTtlSeconds: number;
  /** TCP connect, per attempt. Default STORAGE_TIMEOUT_DEFAULTS.connectTimeoutMs. */
  connectTimeoutMs?: number;
  /** Response headers, and the longest a socket may idle mid-body, per attempt. */
  requestTimeoutMs?: number;
  /** Attempts per call, the first included (the SDK retries a TimeoutError). */
  maxAttempts?: number;
}

/**
 * Defaults, overridable by STORAGE_CONNECT_TIMEOUT_MS, STORAGE_REQUEST_TIMEOUT_MS
 * and STORAGE_MAX_ATTEMPTS. Storage sits in the same region as the API, so a
 * healthy connect is milliseconds; two attempts of 15 s keep a dead endpoint's
 * worst case (about 31 s) near the API's own 30 s request budget instead of
 * minutes.
 */
export const STORAGE_TIMEOUT_DEFAULTS = { connectTimeoutMs: 3_000, requestTimeoutMs: 15_000, maxAttempts: 2 } as const;

/**
 * Key construction and validation live in `object-key.ts`, storage-agnostic,
 * because the rule must hold identically for the local reference
 * implementation. Re-exported here so existing importers are unaffected.
 */
export { assertSafeObjectKey, buildObjectKey } from './object-key';

function isNotFound(error: unknown): boolean {
  const name = (error as { name?: string })?.name;
  const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
  return name === 'NotFound' || name === 'NoSuchKey' || status === 404;
}
