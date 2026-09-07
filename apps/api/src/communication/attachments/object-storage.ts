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

/** What the STORAGE says an object is, as opposed to what a client claimed. */
export interface ObjectMetadata {
  byteSize: number;
  mimeType: string | null;
}

export interface ObjectStorage {
  authorizeUpload(params: {
    prefix: string;
    mimeType: string;
    byteSize: number;
  }): Promise<UploadAuthorization>;

  /** Short-lived signed read URL. Never a permanent public URL. */
  signedReadUrl(objectKey: string, ttlSeconds: number): Promise<string>;

  /**
   * What was ACTUALLY uploaded, or null when no such object exists.
   *
   * The reason this is on the port at all: an upload is presigned, so the bytes
   * never transit this API and it cannot inspect them on the way past. What it
   * declared allowed -- a kind, a MIME type, a size -- was a CLAIM by the
   * client, and the client is also the thing that then PUTs whatever it likes
   * to the URL. Without asking the storage afterwards, "image/png, 40 KB" and
   * "a 400 MB binary" are the same request.
   */
  head(objectKey: string): Promise<ObjectMetadata | null>;

  /**
   * Remove an object. Used to reclaim an upload that was authorized, performed,
   * and then never attached to a message.
   */
  delete(objectKey: string): Promise<void>;

  /**
   * Whether [head] reports what the storage really holds.
   *
   * False for the local reference signer, which signs URLs for a path nothing
   * serves and therefore has no objects to describe. AttachmentService reads
   * this rather than guessing: a check that silently passes because the
   * backend cannot answer is worse than no check, because it reads like one.
   *
   * Every deployed environment runs S3-compatible storage -- `STORAGE_*` is
   * REQUIRED for staging and production in `infra/env/manifest.tsv` -- so this
   * is false only in local development.
   */
  readonly verifiesObjects: boolean;
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

  /**
   * There is nothing to describe: this implementation signs URLs and stores no
   * bytes. It reports that honestly through [verifiesObjects] rather than
   * returning a fabricated answer that would make the caller's check pass.
   */
  async head(): Promise<null> {
    return null;
  }

  async delete(): Promise<void> {}

  readonly verifiesObjects = false;

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
