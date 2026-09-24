import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { ObjectStorage, UploadAuthorization } from './object-storage';

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
  async signedReadUrl(objectKey: string, ttlSeconds = this.ttl): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: assertSafeObjectKey(objectKey) }),
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
   * Also not on the interface, and deliberately not called from the message
   * path: `deleteForEveryone` keeps the row and stops serving the body, and a
   * retention policy has not been decided (PRD 11.1). This exists so that
   * lifecycle work has a supported way in when that decision is taken, rather
   * than reaching for the SDK directly.
   */
  async delete(objectKey: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: assertSafeObjectKey(objectKey) }),
    );
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
}

/**
 * Build a key inside a prefix, and refuse one that would escape it.
 *
 * An S3 key is not a filesystem path, so `..` does not traverse a directory --
 * but it is still a namespace, and `conversations/A/../B` addresses a different
 * conversation's objects than the one that was authorized. The prefix here is
 * `conversations/<conversationId>`, which is exactly the boundary the
 * authorization decision was made about, so a key that leaves it is an
 * authorization bypass whatever the storage layer calls it.
 */
export function buildObjectKey(prefix: string): string {
  return assertSafeObjectKey(`${assertSafePrefix(prefix)}/${randomUUID()}`);
}

function assertSafePrefix(prefix: string): string {
  if (!prefix || prefix.startsWith('/') || prefix.endsWith('/')) {
    throw new Error('object key prefix must be a non-empty relative path');
  }
  return assertSafeObjectKey(prefix);
}

/**
 * The one place a key is checked. Rejects absolute keys, traversal segments,
 * backslashes, control characters and NUL -- the last because a NUL in a key
 * truncates it in some clients, so `a/b%00.png` and `a/b` can become the same
 * object for one participant and different objects for another.
 */
export function assertSafeObjectKey(objectKey: string): string {
  if (typeof objectKey !== 'string' || objectKey.length === 0 || objectKey.length > 1024) {
    throw new Error('object key must be a non-empty string of at most 1024 characters');
  }
  if (objectKey.startsWith('/') || objectKey.includes('\\')) {
    throw new Error('object key must be relative and must not contain backslashes');
  }
  if (/[\u0000-\u001f\u007f]/.test(objectKey)) {
    throw new Error('object key must not contain control characters');
  }
  if (objectKey.split('/').some((segment) => segment === '..' || segment === '.' || segment === '')) {
    throw new Error('object key must not contain empty or traversal segments');
  }
  return objectKey;
}

function isNotFound(error: unknown): boolean {
  const name = (error as { name?: string })?.name;
  const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
  return name === 'NotFound' || name === 'NoSuchKey' || status === 404;
}
