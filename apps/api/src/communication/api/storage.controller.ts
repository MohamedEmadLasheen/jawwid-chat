import { Controller, Get, Inject, Param, Put, Query, Req, Res } from '@nestjs/common';
import { OBJECT_STORAGE } from '../../platform/tokens';
import type { ObjectStorage } from '../attachments/object-storage';
import { SignedLocalObjectStorage } from '../attachments/object-storage';
import { LocalFsBlobStore } from '../attachments/blob-store';

/**
 * Minimal shapes, so this controller needs no @types/express on the runtime
 * path -- the same choice `infra/http/bootstrap.ts` makes and for the same
 * reason.
 */
interface RequestLike extends AsyncIterable<Buffer> {
  headers: Record<string, string | string[] | undefined>;
}
interface ResponseLike {
  status(code: number): ResponseLike;
  setHeader(name: string, value: string): void;
  send(body?: string | Buffer): void;
  end(): void;
}

/**
 * Serves the signed upload and download URLs that `SignedLocalObjectStorage`
 * mints. Without this route those URLs 404 and no attachment can be stored or
 * played at all.
 *
 * THIS ROUTE IS UNAUTHENTICATED BY DESIGN, and that is safe only because of
 * what the signature already proves. `AttachmentService.authorizeUpload` runs
 * the full read authorization for the conversation before it will mint an
 * upload URL, and `signUrlsForMessages` mints read URLs only for messages the
 * caller was already permitted to list. So possession of a valid, unexpired
 * signature *is* the authorization decision, made earlier by a service that
 * had the actor in hand. A bearer token here would re-check nothing that the
 * signature has not already settled, and would have to be handed to a storage
 * origin that in production is not ours.
 *
 * The corollary is that object keys are random UUIDs and are never guessable:
 * changing a message id or a conversation id in a URL yields no signature, and
 * no signature means no bytes.
 *
 * In production OBJECT_STORAGE points at S3 and these handlers are dead code --
 * the signed URLs address the bucket directly and never reach this process.
 */
@Controller('storage')
export class StorageController {
  constructor(
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    private readonly blobs: LocalFsBlobStore,
  ) {}

  /** Only the local reference storage is served from this process. */
  private get local(): SignedLocalObjectStorage | null {
    return this.storage instanceof SignedLocalObjectStorage ? this.storage : null;
  }

  @Put(':objectKey')
  async upload(
    @Param('objectKey') objectKey: string,
    @Query('expires') expires: string,
    @Query('size') size: string,
    @Query('sig') sig: string,
    @Req() req: RequestLike,
    @Res() res: ResponseLike,
  ): Promise<void> {
    const local = this.local;
    if (!local) return this.fail(res, 404, 'storage not served by this process');

    const mimeType = String(req.headers['content-type'] ?? '');
    const byteSize = Number(size);
    if (!Number.isInteger(byteSize) || byteSize <= 0) {
      return this.fail(res, 400, 'size is required');
    }

    // The MIME type and byte size are part of what was signed, so a client that
    // declares anything other than what it was authorized for does not verify.
    const ok = local.verify(objectKey, Number(expires), 'PUT', sig, { mimeType, byteSize });
    if (!ok) return this.fail(res, 403, 'invalid or expired upload signature');

    let received = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      received += chunk.length;
      // Stop reading rather than buffering first and checking after: a client
      // that ignores its own declared size must not be able to spend our memory
      // proving it.
      if (received > byteSize) return this.fail(res, 413, 'upload exceeds authorized size');
      chunks.push(chunk);
    }
    if (received !== byteSize) return this.fail(res, 400, 'upload does not match authorized size');

    await this.blobs.put(objectKey, mimeType, Buffer.concat(chunks));
    res.status(201).send();
  }

  @Get(':objectKey')
  async download(
    @Param('objectKey') objectKey: string,
    @Query('expires') expires: string,
    @Query('sig') sig: string,
    @Req() req: RequestLike,
    @Res() res: ResponseLike,
  ): Promise<void> {
    const local = this.local;
    if (!local) return this.fail(res, 404, 'storage not served by this process');

    if (!local.verify(objectKey, Number(expires), 'GET', sig)) {
      return this.fail(res, 403, 'invalid or expired read signature');
    }

    const blob = await this.blobs.get(objectKey);
    if (!blob) return this.fail(res, 404, 'object not found');

    // Serve the MIME that was authorized at upload, never one re-sniffed from
    // the bytes, and forbid sniffing downstream: an attachment origin that can
    // be talked into serving text/html is a stored-XSS primitive.
    res.setHeader('Content-Type', blob.mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', 'inline');
    // A signed URL is per-actor and short-lived. A shared cache holding it would
    // outlive the grant and serve it to somebody else.
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Accept-Ranges', 'bytes');

    // Range support is what lets a player start on the first seconds of a voice
    // note and seek without pulling the whole file.
    const range = this.parseRange(req.headers.range, blob.bytes.length);
    if (range === 'unsatisfiable') {
      res.setHeader('Content-Range', `bytes */${blob.bytes.length}`);
      return this.fail(res, 416, 'range not satisfiable');
    }
    if (range) {
      const slice = blob.bytes.subarray(range.start, range.end + 1);
      res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${blob.bytes.length}`);
      res.setHeader('Content-Length', String(slice.length));
      res.status(206).send(slice);
      return;
    }

    res.setHeader('Content-Length', String(blob.bytes.length));
    res.status(200).send(blob.bytes);
  }

  /** Single-range `bytes=a-b` only; anything else is served whole. */
  private parseRange(
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

  private fail(res: ResponseLike, status: number, message: string): void {
    res.status(status).send(JSON.stringify({ error: message }));
  }
}
