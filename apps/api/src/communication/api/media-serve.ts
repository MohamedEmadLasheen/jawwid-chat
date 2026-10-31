import { Logger } from '@nestjs/common';
import type { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { CommError } from '../../platform/errors';
import { actorIsLive } from '../../platform/liveness';
import type { MediaKind, MediaUrlSigner, MediaVariant } from '../../platform/media-url';
import type { PrismaService } from '../../platform/prisma.service';
import { realtimeMetrics } from '../../platform/realtime-metrics';
import type { ObjectStorage } from '../attachments/object-storage';

export interface RequestLike {
  headers: Record<string, string | string[] | undefined>;
}
export interface ResponseLike {
  status(code: number): ResponseLike;
  setHeader(name: string, value: string): void;
  send(body?: string | Buffer): void;
  write(chunk: Uint8Array): boolean;
  end(): void;
}
export interface MediaServeDeps {
  signer: MediaUrlSigner;
  prisma: PrismaService;
  storage: ObjectStorage;
}

/**
 * RT-037 -- the ONE implementation behind every access-checked media link
 * (attachments, story media, staff profile photos). Before any byte, in order:
 *
 *   1. the link's signature and expiry verify (403);
 *   2. the reader named in it is LIVE now -- principal and login (403);
 *   3. `authorize()` -- the owning feature's own read rule, decided now
 *      (refusals read as 404 when the feature says "absent").
 *
 * Then the object is read through the storage interface and streamed; no
 * storage key or provider URL is ever returned to the client.
 */
export async function serveAuthorizedMedia(
  deps: MediaServeDeps,
  kind: MediaKind,
  id: string,
  variant: string,
  actorId: string,
  expires: string,
  sig: string,
  req: RequestLike,
  res: ResponseLike,
  authorize: () => Promise<{ objectKey: string }>,
  /**
   * The Cache-Control to send. Default `private, no-store`: the authorization
   * is per request, per reader. A kind may relax it to a short PRIVATE max-age
   * when the object is the reader's own and its URL changes whenever it does.
   */
  cacheControl = 'private, no-store',
): Promise<void> {
  if (!deps.signer.verify({ kind, attachmentId: id, variant: variant as MediaVariant, actorId, expires: Number(expires), sig })) {
    return refuse(res, 403, 'invalid or expired media link');
  }
  if (!(await actorIsLive(deps.prisma, actorId))) {
    return refuse(res, 403, 'this account is no longer active');
  }
  let objectKey: string;
  try {
    ({ objectKey } = await authorize());
  } catch (e) {
    if (e instanceof CommError) return refuse(res, e.status === 404 ? 404 : 403, 'not available');
    throw e;
  }

  const object = await deps.storage.read(objectKey, req.headers.range);
  if (object === null) return refuse(res, 404, 'not available', false);
  if (object === 'unsatisfiable') {
    res.setHeader('Content-Range', 'bytes */*');
    return refuse(res, 416, 'range not satisfiable', false);
  }

  // Served as the MIME that was stored, never sniffed; never cached by a
  // shared cache (the authorization is per request, per reader).
  res.setHeader('Content-Type', object.mimeType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('Cache-Control', cacheControl);
  res.setHeader('Accept-Ranges', 'bytes');
  const length = object.range ? object.range.end - object.range.start + 1 : object.size;
  res.setHeader('Content-Length', String(length));
  if (object.range) {
    res.setHeader('Content-Range', `bytes ${object.range.start}-${object.range.end}/${object.size}`);
  }
  res.status(object.range ? 206 : 200);
  if (Buffer.isBuffer(object.body)) {
    res.send(object.body);
    return;
  }
  // pipeline, not a write loop: it waits for 'drain' whenever the socket's
  // buffer is full, so a slow reader holds a few socket buffers of the object
  // in memory, not all of it; and when the reader goes away it destroys the
  // source, which aborts the storage GET instead of reading the rest for nobody.
  // A streamed body only comes from remote storage, served through Express,
  // whose Response is an http.ServerResponse -- a Writable. Anything else is a
  // wiring error, said out loud rather than swallowed below.
  const out = res as unknown as Writable;
  if (!isWritable(out)) {
    destroySource(object.body);
    throw new Error('media-serve: a streamed body needs a Writable response');
  }
  try {
    await pipeline(object.body, out);
  } catch (e) {
    // The status line is gone, so there is nothing left to answer: end both
    // ends (pipeline normally has already) so neither the reader nor the
    // storage socket is left hanging. A reader leaving early is ordinary
    // (seeking, closing the viewer); anything else is storage failing mid-body.
    if (!out.destroyed) out.destroy();
    destroySource(object.body);
    if ((e as NodeJS.ErrnoException).code !== 'ERR_STREAM_PREMATURE_CLOSE') {
      log.warn(`media ${kind}/${id}: stream ended early: ${(e as Error).message}`);
    }
  }
}

function isWritable(w: Writable): boolean {
  return typeof w?.on === 'function' && typeof w.write === 'function' && typeof w.destroy === 'function';
}

function destroySource(body: AsyncIterable<Uint8Array>): void {
  const stream = body as { destroyed?: boolean; destroy?: () => void };
  if (typeof stream.destroy === 'function' && !stream.destroyed) stream.destroy();
}

const log = new Logger('MediaServe');

function refuse(res: ResponseLike, status: number, message: string, counted = true): void {
  if (counted) realtimeMetrics.mediaDownloadsRefused++;
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).send(JSON.stringify({ error: { message } }));
}
