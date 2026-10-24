import { Controller, Get, Inject, Param, Req, Res } from '@nestjs/common';
import { Public } from '../platform/auth/auth.guard';
import { actorIsLive } from '../platform/liveness';
import { PrismaService } from '../platform/prisma.service';
import { OBJECT_STORAGE } from '../platform/tokens';
import { parseByteRange, type ObjectStorage } from '../communication/attachments/object-storage';
import { ConversationService, isUuid } from '../communication/conversations/conversation.service';
import { ActorKind } from '../communication/contracts/vocab';
import { contentTypeOf, readEntryBytes } from './package-validation';
import { PlayTokenSigner } from './play-token';
import { MaterialsAdminService } from './materials-admin.service';

interface PlayRequest {
  headers: Record<string, string | string[] | undefined>;
}
interface PlayResponse {
  status(code: number): PlayResponse;
  setHeader(name: string, value: string): void;
  send(body?: string | Buffer): void;
}

/**
 * The policy every package file is served with. `sandbox` WITHOUT
 * `allow-same-origin` makes the page an opaque origin even when it is opened
 * directly in a tab: it cannot read this origin's storage or cookies, and it
 * never sees a bearer token (ours live in app memory and the keychain). The
 * rest keeps the package to its own files: no form posts, no <base> rewrite,
 * no plugins.
 */
export function playCsp(frameAncestors: string[]): string {
  return [
    'sandbox allow-scripts allow-forms',
    "default-src 'self' data: blob:",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "frame-src 'self'",
    "object-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    `frame-ancestors ${frameAncestors.length ? frameAncestors.join(' ') : "'none'"}`,
  ].join('; ');
}

/** The Admin Web origins that may frame a package (its preview): the CORS allow-list. */
function frameAncestors(): string[] {
  return (process.env.CORS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter((o) => /^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/.test(o));
}

/**
 * PD-29: the files of an HTML5 package,
 *
 *   GET /api/v1/materials/play/:itemId/:token/<path inside the package>
 *
 * `@Public()` to the bearer guard because a WebView or an <iframe> cannot send
 * a header; the token in the path is the binding (play-token.ts). Before any
 * byte, on EVERY request:
 *
 *   1. the token verifies for this item's CURRENT package, unexpired (403);
 *   2. the viewer it names is live and of the item's organization (403);
 *   3. the item is still published -- or the viewer manages the library (a
 *      preview) (404);
 *   4. the path is in the package's validated index (404). Nothing outside
 *      the index exists here: there is no filesystem, so no traversal.
 *
 * Bytes are read from storage by offset (a ranged read of the zip). A stored
 * entry honours the client's Range, so a video inside a package can seek.
 */
@Public()
@Controller('materials/play')
export class MaterialsPlayController {
  private readonly tokens = new PlayTokenSigner();

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationService,
    private readonly admin: MaterialsAdminService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  @Get(':itemId/:token/*path')
  async file(
    @Param('itemId') itemId: string,
    @Param('token') token: string,
    @Param('path') rawPath: string | string[],
    @Req() req: PlayRequest,
    @Res() res: PlayResponse,
  ): Promise<void> {
    const path = Array.isArray(rawPath) ? rawPath.join('/') : String(rawPath ?? '');
    if (!isUuid(itemId)) return refuse(res, 404, 'not found');
    const item = await this.prisma.materialItem.findUnique({ where: { id: itemId } });
    if (!item || item.source !== 'package' || !item.objectKey) return refuse(res, 404, 'not found');
    const claims = this.tokens.verify(token, item.id, item.objectKey);
    if (!claims) return refuse(res, 403, 'invalid or expired link');
    if (!(await actorIsLive(this.prisma, claims.actorId))) return refuse(res, 403, 'this account is no longer active');
    const actor = await this.conversations.requireActor(claims.actorId).catch(() => null);
    if (!actor || actor.organizationId !== item.organizationId || (actor.kind === ActorKind.CONTACT && !actor.familyId)) {
      return refuse(res, 403, 'not available');
    }
    if (item.status !== 'published' && !(await this.admin.mayManage(actor))) return refuse(res, 404, 'not found');

    const entry = await this.prisma.materialPackageEntry.findUnique({ where: { objectKey_path: { objectKey: item.objectKey, path } } });
    const type = contentTypeOf(path);
    if (!entry || !type) return refuse(res, 404, 'not found');

    const size = Number(entry.size);
    const start = Number(entry.dataOffset);
    const csize = Number(entry.compressedSize);
    let body: Buffer;
    let range: { start: number; end: number } | null = null;
    if (entry.method === 0) {
      const wanted = parseByteRange(req.headers.range, size);
      if (wanted === 'unsatisfiable') {
        res.setHeader('Content-Range', `bytes */${size}`);
        return refuse(res, 416, 'range not satisfiable');
      }
      range = wanted;
      const from = start + (range?.start ?? 0);
      const to = start + (range ? range.end : size - 1);
      body = size === 0 ? Buffer.alloc(0) : await this.readRange(item.objectKey, from, to);
    } else {
      const compressed = csize === 0 ? Buffer.alloc(0) : await this.readRange(item.objectKey, start, start + csize - 1);
      const whole = readEntryBytes(compressed, 8, size);
      const wanted = parseByteRange(req.headers.range, whole.length);
      if (wanted === 'unsatisfiable') {
        res.setHeader('Content-Range', `bytes */${whole.length}`);
        return refuse(res, 416, 'range not satisfiable');
      }
      range = wanted;
      body = range ? whole.subarray(range.start, range.end + 1) : whole;
    }

    res.setHeader('Content-Type', type);
    res.setHeader('Content-Security-Policy', playCsp(frameAncestors()));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    // The sandboxed page is an opaque origin, so its own requests for its own
    // files are cross-origin: let them through, without credentials.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('Accept-Ranges', 'bytes');
    if (range) {
      res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
      res.setHeader('Content-Length', String(body.length));
      res.status(206).send(body);
      return;
    }
    res.setHeader('Content-Length', String(body.length));
    res.status(200).send(body);
  }

  private async readRange(objectKey: string, from: number, to: number): Promise<Buffer> {
    const got = await this.storage.read(objectKey, `bytes=${from}-${to}`);
    if (!got || got === 'unsatisfiable') throw new Error('package bytes missing from storage');
    let bytes: Buffer;
    if (Buffer.isBuffer(got.body)) bytes = got.body;
    else {
      const parts: Buffer[] = [];
      for await (const chunk of got.body) parts.push(Buffer.from(chunk));
      bytes = Buffer.concat(parts);
    }
    // A store that ignored the range would hand back the whole zip.
    if (bytes.length !== to - from + 1) throw new Error('storage did not honour the byte range');
    return bytes;
  }
}

function refuse(res: PlayResponse, status: number, message: string): void {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(status).send(JSON.stringify({ error: { message } }));
}
