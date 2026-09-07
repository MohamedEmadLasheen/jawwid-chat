import { Injectable } from '@nestjs/common';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import type { ObjectMetadata, ObjectStorage, UploadAuthorization } from './object-storage';

/**
 * S3-compatible object storage, behind the same `ObjectStorage` interface.
 *
 * This is the Phase 2 item the architecture names: "replaces the local signer
 * with the S3/MinIO implementation behind the same `ObjectStorage` interface"
 * (`docs/architecture/JAWUID-CHAT-ARCHITECTURE.md` §2.5). The seam already
 * existed; only the implementation was missing, and until it landed
 * `STORAGE_ENDPOINT` pointed at MinIO while the URLs were signed for a path
 * this API serves — so an upload authorized in a deployed environment could
 * not actually be uploaded.
 *
 * ## Why there is no AWS SDK here
 *
 * Presigning is one well-specified signature, and `@aws-sdk/client-s3` plus
 * `s3-request-presigner` is several megabytes and a large transitive tree for
 * it. SigV4 is ~70 lines of HMAC against `node:crypto`, it is a stable
 * published specification, and it is exercised end to end against a real MinIO
 * in `scripts/qa/phase2-smoke`. A dependency that large earns its place by
 * doing something hard; this is not that.
 *
 * ## What is signed, and what is not
 *
 * Only `host` is a signed header. The client therefore sends its own
 * `Content-Type` on the PUT without invalidating the signature — which is what
 * lets `AttachmentService` state the MIME type it validated without this class
 * having to re-derive it. The payload is `UNSIGNED-PAYLOAD`: the bytes never
 * transit this API, so it cannot hash them, and that is the whole point of a
 * presigned upload.
 *
 * The URL is path-style (`endpoint/bucket/key`). MinIO serves path-style by
 * default, and virtual-host style would require DNS per bucket.
 */
@Injectable()
export class S3ObjectStorage implements ObjectStorage {
  private readonly endpoint: string;
  private readonly region: string;
  private readonly bucket: string;
  private readonly accessKey: string;
  private readonly secretKey: string;
  private readonly ttl: number;

  constructor() {
    const config = S3ObjectStorage.requireConfig();
    this.endpoint = config.endpoint;
    this.region = config.region;
    this.bucket = config.bucket;
    this.accessKey = config.accessKey;
    this.secretKey = config.secretKey;
    this.ttl = S3ObjectStorage.requireTtl(
      Number(process.env.STORAGE_SIGNED_URL_TTL_SECONDS ?? 300),
    );
  }

  /**
   * SigV4 admits an expiry of 1 second to 7 days, and nothing outside it.
   *
   * A misconfigured `STORAGE_SIGNED_URL_TTL_SECONDS=0` would otherwise mint
   * URLs that every storage backend rejects as MALFORMED — which reads as
   * "attachments are broken" rather than as "that variable is wrong". Failing
   * at construction says which.
   */
  private static requireTtl(seconds: number): number {
    if (!Number.isFinite(seconds) || seconds < 1 || seconds > 604_800) {
      throw new Error(
        `STORAGE_SIGNED_URL_TTL_SECONDS must be between 1 and 604800; got ${seconds}`,
      );
    }
    return Math.floor(seconds);
  }

  /**
   * Whether this process is configured for real object storage.
   *
   * The module uses this to choose an implementation, so a developer with no
   * MinIO running still gets the local signer rather than a boot failure —
   * while a deployment, where `infra/env/manifest.tsv` marks every one of these
   * REQUIRED for staging and production, gets the real one.
   */
  static isConfigured(): boolean {
    return Boolean(
      process.env.STORAGE_ENDPOINT &&
        process.env.STORAGE_BUCKET &&
        process.env.STORAGE_ACCESS_KEY &&
        process.env.STORAGE_SECRET_KEY,
    );
  }

  private static requireConfig() {
    const endpoint = process.env.STORAGE_ENDPOINT;
    const bucket = process.env.STORAGE_BUCKET;
    const accessKey = process.env.STORAGE_ACCESS_KEY;
    const secretKey = process.env.STORAGE_SECRET_KEY;

    if (!endpoint || !bucket || !accessKey || !secretKey) {
      // No fallback. A default credential is a credential in the repository,
      // and a default endpoint is an environment somebody uploads to by
      // accident.
      throw new Error(
        'S3ObjectStorage requires STORAGE_ENDPOINT, STORAGE_BUCKET, ' +
          'STORAGE_ACCESS_KEY and STORAGE_SECRET_KEY',
      );
    }
    return {
      endpoint: endpoint.replace(/\/+$/, ''),
      region: process.env.STORAGE_REGION || 'us-east-1',
      bucket,
      accessKey,
      secretKey,
    };
  }

  async authorizeUpload(params: {
    prefix: string;
    mimeType: string;
    byteSize: number;
  }): Promise<UploadAuthorization> {
    // The key is server-generated. A client-supplied name would let one caller
    // overwrite another's object, and would put user text in a storage path.
    const objectKey = `${params.prefix}/${randomUUID()}`;
    const expiresIn = this.ttl;

    return {
      objectKey,
      uploadUrl: this.presign('PUT', objectKey, expiresIn),
      method: 'PUT',
      headers: { 'content-type': params.mimeType },
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    };
  }

  async signedReadUrl(objectKey: string, ttlSeconds = this.ttl): Promise<string> {
    // Validated per call as well as at construction: a caller passing a
    // computed TTL must not be able to mint a URL that storage will reject as
    // malformed, which looks like a broken attachment rather than a bad
    // argument.
    return this.presign('GET', objectKey, S3ObjectStorage.requireTtl(ttlSeconds));
  }

  // ------------------------------------------------------------------
  // AWS Signature Version 4, query-string ("presigned") form
  // ------------------------------------------------------------------

  /**
   * Ask the storage what it actually holds.
   *
   * A presigned HEAD, issued by this API with its own credentials, so the
   * answer is the storage's and not the client's. Returns null for anything
   * that is not there -- which is also the answer for "the client claimed an
   * object key it never uploaded to".
   *
   * Network failures are NOT swallowed into null. "The object does not exist"
   * and "I could not reach storage" are different facts, and collapsing them
   * would turn a MinIO outage into every attachment being silently rejected as
   * missing.
   */
  async head(objectKey: string): Promise<ObjectMetadata | null> {
    const response = await fetch(this.presign('HEAD', objectKey, 60), { method: 'HEAD' });

    if (response.status === 404 || response.status === 403) return null;
    if (!response.ok) {
      throw new Error(`object storage HEAD failed with ${response.status}`);
    }

    const length = Number(response.headers.get('content-length') ?? NaN);
    return {
      byteSize: Number.isFinite(length) ? length : 0,
      // What storage recorded at upload time. Still not a guarantee about the
      // BYTES -- only a sniff of the content could be that, and this API never
      // sees them -- but it is no longer a value the client can simply assert
      // to the message row while uploading something else.
      mimeType: response.headers.get('content-type'),
    };
  }

  async delete(objectKey: string): Promise<void> {
    const response = await fetch(this.presign('DELETE', objectKey, 60), { method: 'DELETE' });
    // 204 on success, 404 when it is already gone -- both are the desired end
    // state, and treating "already absent" as a failure would make cleanup
    // non-idempotent.
    if (!response.ok && response.status !== 404) {
      throw new Error(`object storage DELETE failed with ${response.status}`);
    }
  }

  readonly verifiesObjects = true;

  private presign(
    method: 'GET' | 'PUT' | 'HEAD' | 'DELETE',
    objectKey: string,
    expiresIn: number,
  ): string {
    const url = new URL(this.endpoint);
    const host = url.host;
    const now = new Date();
    const amzDate = S3ObjectStorage.amzDate(now);
    const dateStamp = amzDate.slice(0, 8);
    const scope = `${dateStamp}/${this.region}/s3/aws4_request`;

    // Path-style: /<bucket>/<key>. Each segment is encoded, and the separators
    // are not — an object key legitimately contains slashes.
    const canonicalUri = `/${S3ObjectStorage.encodePath(this.bucket)}/${S3ObjectStorage.encodePath(objectKey)}`;

    const query: Array<[string, string]> = [
      ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
      ['X-Amz-Credential', `${this.accessKey}/${scope}`],
      ['X-Amz-Date', amzDate],
      ['X-Amz-Expires', String(expiresIn)],
      ['X-Amz-SignedHeaders', 'host'],
    ];
    // SigV4 requires the canonical query string to be sorted by encoded key.
    const canonicalQuery = query
      .map(([k, v]) => [S3ObjectStorage.encode(k), S3ObjectStorage.encode(v)] as const)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${k}=${v}`)
      .join('&');

    const canonicalRequest = [
      method,
      canonicalUri,
      canonicalQuery,
      `host:${host}\n`,
      'host',
      // The bytes never pass through this API, so it cannot hash them. That is
      // exactly what a presigned upload is for.
      'UNSIGNED-PAYLOAD',
    ].join('\n');

    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      scope,
      createHash('sha256').update(canonicalRequest).digest('hex'),
    ].join('\n');

    const signature = S3ObjectStorage.hmac(
      this.signingKey(dateStamp),
      stringToSign,
    ).toString('hex');

    return `${url.origin}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
  }

  private signingKey(dateStamp: string): Buffer {
    const kDate = S3ObjectStorage.hmac(`AWS4${this.secretKey}`, dateStamp);
    const kRegion = S3ObjectStorage.hmac(kDate, this.region);
    const kService = S3ObjectStorage.hmac(kRegion, 's3');
    return S3ObjectStorage.hmac(kService, 'aws4_request');
  }

  private static hmac(key: string | Buffer, data: string): Buffer {
    return createHmac('sha256', key).update(data, 'utf8').digest();
  }

  /** `20260907T101530Z` */
  private static amzDate(date: Date): string {
    return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  }

  /**
   * RFC 3986 encoding, which is stricter than `encodeURIComponent`.
   *
   * `!`, `'`, `(`, `)` and `*` are left alone by `encodeURIComponent` and MUST
   * be encoded for the signature to match. A key containing one of them would
   * otherwise produce a URL that verifies locally and is rejected by storage.
   */
  private static encode(value: string): string {
    return encodeURIComponent(value).replace(
      /[!'()*]/g,
      (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
    );
  }

  /** Encodes each segment; the `/` separators are part of the path. */
  private static encodePath(path: string): string {
    return path.split('/').map(S3ObjectStorage.encode).join('/');
  }
}
