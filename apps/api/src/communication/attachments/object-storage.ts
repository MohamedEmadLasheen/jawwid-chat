import { Injectable } from '@nestjs/common';
import { createHmac, randomUUID } from 'node:crypto';

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
  private readonly secret = process.env.STORAGE_SIGNING_SECRET ?? 'dev-only-not-a-secret';
  private readonly base = process.env.STORAGE_ENDPOINT ?? 'http://localhost:3000/storage';
  private readonly ttl = Number(process.env.STORAGE_SIGNED_URL_TTL_SECONDS ?? 300);

  async authorizeUpload(params: {
    prefix: string;
    mimeType: string;
    byteSize: number;
  }): Promise<UploadAuthorization> {
    const objectKey = `${params.prefix}/${randomUUID()}`;
    const expires = Math.floor(Date.now() / 1000) + this.ttl;
    const sig = this.sign(objectKey, expires, 'PUT');
    return {
      objectKey,
      uploadUrl: `${this.base}/${encodeURIComponent(objectKey)}?expires=${expires}&sig=${sig}`,
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

  verify(objectKey: string, expires: number, method: string, sig: string): boolean {
    if (expires * 1000 < Date.now()) return false;
    return this.sign(objectKey, expires, method) === sig;
  }

  private sign(objectKey: string, expires: number, method: string): string {
    return createHmac('sha256', this.secret)
      .update(`${method}:${objectKey}:${expires}`)
      .digest('hex');
  }
}
