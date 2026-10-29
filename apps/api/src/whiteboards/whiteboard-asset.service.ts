import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ObjectStorage, UploadAuthorization } from '../communication/attachments/object-storage';
import { CommError, CommErrorCode } from '../platform/errors';
import { OBJECT_STORAGE } from '../platform/tokens';
import { BOARD_IMAGE_MAX_BYTES, inspectBoardImage, sniffBoardImage, type BoardImageType } from './whiteboard-image';

/**
 * PD-39 §6.3: a board's objects in storage. An object key is a NAME, never a
 * capability: this service is the only code that signs one, and only for a
 * board its caller has already authorized (WhiteboardService runs the board's
 * read check first and hands over rows it read by board id).
 *
 *   whiteboard-uploads/<org>/<board>/<asset>/<random>   what an upload grant may write
 *   whiteboards/<org>/<board>/<asset>                    what is kept and signed
 *
 * Confirming copies the upload to its kept key -- one no grant can name -- and
 * checks THOSE bytes, so what was inspected is what is served. The upload is
 * then deleted. An upload that is never confirmed is never signed; the bucket's
 * lifecycle rule on `whiteboard-uploads/` removes it (docs/ops runbook, #191).
 */

/** How long a signed image URL lives; the editor asks again (GET .../assets) when it runs out. */
export const ASSET_URL_TTL_SECONDS = 15 * 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AssetRow {
  id: string;
  kind: string;
  object_key: string;
  content_type: string;
  byte_size: bigint | number;
  width: number | null;
  height: number | null;
}

/** What a reader of the board gets for one of its images. */
export interface AssetView {
  id: string;
  kind: string;
  contentType: string;
  width: number | null;
  height: number | null;
  byteSize: number;
  url: string;
  expiresAt: string;
}

export interface Pinned {
  width: number;
  height: number;
  sha256: string;
  bytes: Buffer;
}

export const keptKey = (org: string, board: string, asset: string) => `whiteboards/${org}/${board}/${asset}`;
const stagingPrefix = (org: string, board: string, asset: string) => `whiteboard-uploads/${org}/${board}/${asset}`;

@Injectable()
export class WhiteboardAssetService {
  private readonly log = new Logger(WhiteboardAssetService.name);

  constructor(@Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage) {}

  /** A signed PUT for one asset, bound to its type and size, under its own staging prefix. */
  grant(org: string, board: string, asset: string, mimeType: string, byteSize: number): Promise<UploadAuthorization> {
    return this.storage.authorizeUpload({ prefix: stagingPrefix(org, board, asset), mimeType, byteSize });
  }

  /**
   * Exactly the key a grant for this asset could have minted: five segments,
   * the asset's own prefix and one random id. Structural, never startsWith.
   */
  isUploadOf(key: unknown, org: string, board: string, asset: string): key is string {
    if (typeof key !== 'string') return false;
    const parts = key.split('/');
    return parts.length === 5 && `${parts.slice(0, 4).join('/')}` === stagingPrefix(org, board, asset) && UUID.test(parts[4]);
  }

  /**
   * The upload copied to its kept key and inspected there. Refused bytes are
   * deleted from the kept key and never become ready.
   */
  async pin(uploadKey: string, keepAt: string, declared: { contentType: string; byteSize: number }): Promise<Pinned> {
    const mime = declared.contentType as BoardImageType;
    const head = await this.storage.readHead(uploadKey, 16);
    if (!head) throw new CommError(CommErrorCode.WHITEBOARD_STATE, 'the image has not been uploaded', 409);
    if (head.byteSize !== declared.byteSize || sniffBoardImage(head.head) !== mime) {
      throw new CommError(CommErrorCode.WHITEBOARD_INVALID, 'the uploaded file is not the image it claims to be', 422);
    }
    if (!this.storage.copy) throw new CommError(CommErrorCode.WHITEBOARD_ASSETS_OFF, 'this storage cannot keep board images', 503);
    if (!(await this.storage.copy(uploadKey, keepAt))) throw new CommError(CommErrorCode.WHITEBOARD_STATE, 'the image has not been uploaded', 409);
    const bytes = await this.readAll(keepAt);
    const verdict = !bytes
      ? ({ ok: false, reason: 'the image has not been uploaded' } as const)
      : bytes.length !== declared.byteSize
        ? ({ ok: false, reason: 'the image changed size' } as const)
        : inspectBoardImage(bytes, mime);
    if (!verdict.ok || !bytes) {
      await this.deleteQuietly([keepAt]);
      throw new CommError(CommErrorCode.WHITEBOARD_INVALID, verdict.ok ? 'the image has not been uploaded' : verdict.reason, 422);
    }
    return { width: verdict.width, height: verdict.height, sha256: createHash('sha256').update(bytes).digest('hex'), bytes };
  }

  /**
   * Signed reads for a board's ready images. The board is the caller's
   * authorized one, and every key must be exactly that board's name for that
   * asset: a row whose key says otherwise is not signed (and is logged).
   */
  async sign(board: { id: string; organization_id: string }, rows: AssetRow[]): Promise<AssetView[]> {
    const expiresAt = new Date(Date.now() + ASSET_URL_TTL_SECONDS * 1000).toISOString();
    const out: AssetView[] = [];
    for (const row of rows) {
      if (row.object_key !== keptKey(board.organization_id, board.id, row.id)) {
        this.log.error(`whiteboard asset ${row.id}: its key is not its board's; not signed`);
        continue;
      }
      out.push({
        id: row.id,
        kind: row.kind,
        contentType: row.content_type,
        width: row.width,
        height: row.height,
        byteSize: Number(row.byte_size),
        url: await this.storage.signedReadUrl(row.object_key, ASSET_URL_TTL_SECONDS, { cacheControl: `private, max-age=${ASSET_URL_TTL_SECONDS}` }),
        expiresAt,
      });
    }
    return out;
  }

  /** Server-side copies (a board copied to another teacher); every target or none. */
  async copyAll(pairs: Array<{ from: string; to: string }>): Promise<void> {
    if (pairs.length === 0) return;
    if (!this.storage.copy) throw new CommError(CommErrorCode.WHITEBOARD_ASSETS_OFF, 'this storage cannot copy board images', 503);
    const done: string[] = [];
    try {
      for (const { from, to } of pairs) {
        if (!(await this.storage.copy(from, to))) throw new CommError(CommErrorCode.WHITEBOARD_STATE, 'an image of this board is missing from storage', 409);
        done.push(to);
      }
    } catch (e) {
      await this.deleteQuietly(done);
      throw e;
    }
  }

  async readAll(key: string): Promise<Buffer | null> {
    const got = await this.storage.read(key);
    if (!got || got === 'unsatisfiable') return null;
    if (Buffer.isBuffer(got.body)) return got.body.length > BOARD_IMAGE_MAX_BYTES ? null : got.body;
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of got.body) {
      total += chunk.length;
      if (total > BOARD_IMAGE_MAX_BYTES) return null;
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  async deleteQuietly(keys: string[]): Promise<void> {
    for (const key of keys) await this.storage.delete(key).catch((e) => this.log.warn(`could not delete ${key}: ${String(e)}`));
  }
}
