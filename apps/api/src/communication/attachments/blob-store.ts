import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * PLATFORM SEAM. Where attachment bytes actually live.
 *
 * `ObjectStorage` decides *who may* read or write an object; this decides
 * *where the bytes sit*. They are separate because production replaces both at
 * once with S3 -- at which point the signed URLs point at S3 and nothing in
 * this file is on the request path any more.
 */
export interface StoredBlob {
  bytes: Buffer;
  mimeType: string;
}

export interface BlobStore {
  put(objectKey: string, mimeType: string, bytes: Buffer): Promise<void>;
  get(objectKey: string): Promise<StoredBlob | null>;
}

/**
 * Reference implementation: bytes on the local filesystem.
 *
 * The object key is NEVER used as a path. It is hashed, and the hash is the
 * filename. An object key is partly attacker-influenced (it is echoed back from
 * an authorization and arrives again on the upload), so joining it onto a root
 * directory is exactly the shape of a path-traversal bug -- `..%2F..%2Fetc` is
 * one decode away from writing outside the store. Hashing makes traversal
 * unrepresentable rather than filtered.
 */
@Injectable()
export class LocalFsBlobStore implements BlobStore {
  private readonly root = process.env.STORAGE_LOCAL_ROOT ?? join(tmpdir(), 'jawwid-storage');

  private pathFor(objectKey: string): string {
    const digest = createHash('sha256').update(objectKey).digest('hex');
    return join(this.root, digest);
  }

  async put(objectKey: string, mimeType: string, bytes: Buffer): Promise<void> {
    await mkdir(this.root, { recursive: true });
    const path = this.pathFor(objectKey);
    await writeFile(path, bytes);
    // The declared MIME travels with the bytes: the read path must serve what
    // was authorized, never something re-sniffed from content at read time.
    await writeFile(`${path}.meta`, JSON.stringify({ mimeType }), 'utf8');
  }

  async get(objectKey: string): Promise<StoredBlob | null> {
    const path = this.pathFor(objectKey);
    try {
      const [bytes, meta] = await Promise.all([
        readFile(path),
        readFile(`${path}.meta`, 'utf8'),
      ]);
      const mimeType = (JSON.parse(meta) as { mimeType?: string }).mimeType;
      return { bytes, mimeType: mimeType ?? 'application/octet-stream' };
    } catch {
      return null;
    }
  }
}
