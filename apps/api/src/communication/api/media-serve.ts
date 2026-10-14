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
  res.setHeader('Cache-Control', 'private, no-store');
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
  for await (const chunk of object.body) res.write(chunk);
  res.end();
}

function refuse(res: ResponseLike, status: number, message: string, counted = true): void {
  if (counted) realtimeMetrics.mediaDownloadsRefused++;
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).send(JSON.stringify({ error: { message } }));
}
