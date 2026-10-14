import { Injectable } from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { LocalFsBlobStore } from './blob-store';

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

/** RT-037: the bytes of a stored object, as the media route serves them. */
export interface StoredObject {
  mimeType: string;
  /** Total size of the object in bytes. */
  size: number;
  /** The inclusive byte range served, or null for the whole object. */
  range: { start: number; end: number } | null;
  /** The served bytes: a buffer, or a stream for large remote objects. */
  body: Buffer | AsyncIterable<Uint8Array>;
}

/**
 * Single-range `bytes=a-b` / `bytes=a-` / `bytes=-n` only; anything else is
 * served whole (null). Shared by the storage and media routes.
 */
export function parseByteRange(
  header: string | string[] | undefined,
  total: number,
): { start: number; end: number } | 'unsatisfiable' | null {
  const raw = Array.isArray(header) ? header[0] : header;
  const match = /^bytes=(\d*)-(\d*)$/.exec(raw ?? '');
  if (!match) return null;

  const [, rawStart, rawEnd] = match;
  if (rawStart === '' && rawEnd === '') return null;

  // A suffix range (`bytes=-500`) asks for the last N bytes.
  const start = rawStart === '' ? Math.max(0, total - Number(rawEnd)) : Number(rawStart);
  const end = rawStart === '' || rawEnd === '' ? total - 1 : Math.min(Number(rawEnd), total - 1);

  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start > end || start >= total) return 'unsatisfiable';
  return { start, end };
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
   * Remove the bytes. Idempotent: deleting an absent object succeeds, because a
   * retention sweep must converge rather than wedge on a key somebody already
   * cleaned up by hand.
   *
   * `S3ObjectStorage` has had this since the S3 work landed; declaring it on the
   * interface is what lets a caller that is not holding a concrete class use it.
   * Message attachments deliberately do not: `deleteForEveryone` keeps the row
   * and stops serving the body. Story media does, because a story's whole
   * contract is that it stops existing.
   */
  delete(objectKey: string): Promise<void>;
  /**
   * The first `maxBytes` of a stored object, its total size and the content
   * type storage recorded for it -- or null when the object does not exist.
   *
   * For a caller that must look at what was ACTUALLY uploaded before it commits
   * to it (a profile photo is checked for its real image signature and its
   * dimensions, not for the type the client declared). Bounded on purpose: a
   * validator never needs, and never gets, the whole object in memory.
   */
  readHead(objectKey: string, maxBytes: number): Promise<StoredObjectHead | null>;
  /**
   * RT-037. The bytes, read by this API on behalf of a request it has just
   * authorized (the media route) -- so no storage URL has to be handed out.
   * Null when there is no such object; 'unsatisfiable' for a range outside it.
   */
  read(objectKey: string, rangeHeader?: string | string[]): Promise<StoredObject | 'unsatisfiable' | null>;
}

export interface StoredObjectHead {
  head: Buffer;
  byteSize: number;
  contentType: string | null;
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
   * Remove the bytes.
   *
   * Its own blob store rather than an injected one: this class is constructed by
   * a factory (`selectObjectStorage`) that has no DI container in hand, and
   * `LocalFsBlobStore` addresses files by hashing the object key under
   * STORAGE_LOCAL_ROOT -- so a second instance reaches exactly the same bytes as
   * the one StorageController serves reads from.
   *
   * Note what this does NOT do: invalidate outstanding signed URLs. It cannot --
   * a signature is self-validating. A URL minted before the purge stays
   * syntactically valid until it expires, and then 404s because the bytes are
   * gone. That is why STORAGE_SIGNED_URL_TTL_SECONDS is capped at an hour.
   */
  async delete(objectKey: string): Promise<void> {
    await this.blobs.delete(objectKey);
  }

  async read(objectKey: string, rangeHeader?: string | string[]): Promise<StoredObject | 'unsatisfiable' | null> {
    const blob = await this.blobs.get(objectKey);
    if (!blob) return null;
    const size = blob.bytes.length;
    const range = parseByteRange(rangeHeader, size);
    if (range === 'unsatisfiable') return 'unsatisfiable';
    return {
      mimeType: blob.mimeType,
      size,
      range,
      body: range ? blob.bytes.subarray(range.start, range.end + 1) : blob.bytes,
    };
  }

  private readonly blobs = new LocalFsBlobStore();

  async readHead(objectKey: string, maxBytes: number): Promise<StoredObjectHead | null> {
    const blob = await this.blobs.get(objectKey);
    if (!blob) return null;
    return {
      head: blob.bytes.subarray(0, Math.max(0, maxBytes)),
      byteSize: blob.bytes.length,
      contentType: blob.mimeType,
    };
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
