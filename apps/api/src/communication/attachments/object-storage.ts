import { Injectable } from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

/**
 * PLATFORM SEAM. Binary content never touches Postgres.
 *
 * Swap the reference implementation for S3/MinIO by providing another class for
 * the OBJECT_STORAGE token. Nothing in the communication domain imports a
 * concrete storage client.
 */
export interface UploadAuthorization {
  objectKey: string;
  uploadUrl: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresAt: string;
}

/**
 * What an upload signature commits the uploader to.
 *
 * Without this the signature says only "you may write to this key", so an
 * authorization taken out for a 20 KB voice note could be spent uploading a
 * 100 MB file: every limit `AttachmentService.validate` enforces would be
 * advisory, checked at authorization time and unenforceable at write time.
 */
export interface UploadBinding {
  mimeType: string;
  byteSize: number;
}

export interface ObjectStorage {
  authorizeUpload(params: {
    prefix: string;
    mimeType: string;
    byteSize: number;
  }): Promise<UploadAuthorization>;
  /** Short-lived signed read URL. Never a permanent public URL. */
  signedReadUrl(objectKey: string, ttlSeconds: number): Promise<string>;
}

/**
 * Reference implementation: HMAC-signed, expiring URLs served by this API.
 * Production should point OBJECT_STORAGE at S3-compatible storage instead.
 */
@Injectable()
export class SignedLocalObjectStorage implements ObjectStorage {
  /**
   * No default. A committed fallback secret would make every signed URL
   * forgeable by anyone who can read this repository, so an unset secret is a
   * startup failure rather than a silent downgrade.
   */
  private readonly secret = SignedLocalObjectStorage.requireSecret();

  private static requireSecret(): string {
    const secret = process.env.STORAGE_SIGNING_SECRET;
    if (!secret || secret.length < 32) {
      throw new Error(
        'STORAGE_SIGNING_SECRET must be set to at least 32 characters; ' +
          'signed attachment URLs are forgeable without it',
      );
    }
    return secret;
  }
  private readonly base = process.env.STORAGE_ENDPOINT ?? 'http://localhost:3000/storage';
  private readonly ttl = Number(process.env.STORAGE_SIGNED_URL_TTL_SECONDS ?? 300);

  async authorizeUpload(params: {
    prefix: string;
    mimeType: string;
    byteSize: number;
  }): Promise<UploadAuthorization> {
    const objectKey = `${params.prefix}/${randomUUID()}`;
    const expires = Math.floor(Date.now() / 1000) + this.ttl;
    const binding: UploadBinding = { mimeType: params.mimeType, byteSize: params.byteSize };
    const sig = this.sign(objectKey, expires, 'PUT', binding);
    return {
      objectKey,
      uploadUrl:
        `${this.base}/${encodeURIComponent(objectKey)}` +
        `?expires=${expires}&size=${params.byteSize}&sig=${sig}`,
      method: 'PUT',
      headers: { 'content-type': params.mimeType },
      expiresAt: new Date(expires * 1000).toISOString(),
    };
  }

  async signedReadUrl(objectKey: string, ttlSeconds = this.ttl): Promise<string> {
    const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
    const sig = this.sign(objectKey, expires, 'GET');
    return `${this.base}/${encodeURIComponent(objectKey)}?expires=${expires}&sig=${sig}`;
  }

  /**
   * A PUT is verifiable only against the MIME type and byte size it was
   * authorized for. Omitting the binding is not "unbound PUT" -- it is a
   * failure, because no such signature is ever issued.
   */
  verify(
    objectKey: string,
    expires: number,
    method: string,
    sig: string,
    binding?: UploadBinding,
  ): boolean {
    if (!Number.isFinite(expires) || expires * 1000 < Date.now()) return false;
    if (method === 'PUT' && !binding) return false;
    return SignedLocalObjectStorage.constantTimeEquals(
      this.sign(objectKey, expires, method, binding),
      sig,
    );
  }

  /**
   * Comparing HMACs with `===` leaks their contents: it returns on the first
   * differing byte, so response time reveals how long a guessed prefix was
   * correct and a signature can be recovered byte by byte.
   */
  private static constantTimeEquals(expected: string, actual: string): boolean {
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(actual ?? '', 'utf8');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  private sign(
    objectKey: string,
    expires: number,
    method: string,
    binding?: UploadBinding,
  ): string {
    const payload =
      binding && method === 'PUT'
        ? `${method}:${objectKey}:${expires}:${binding.mimeType}:${binding.byteSize}`
        : `${method}:${objectKey}:${expires}`;
    return createHmac('sha256', this.secret).update(payload).digest('hex');
  }
}
