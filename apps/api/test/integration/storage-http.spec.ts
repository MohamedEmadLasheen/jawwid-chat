/**
 * The local reference storage route over REAL HTTP -- the global bearer guard,
 * Express and the controller, as a running API has them.
 *
 * The route is unauthenticated by design: the signed URL is the authorization,
 * minted only after AttachmentService ran the conversation's read rule. The
 * global guard (PR-B) came later and answered 401 to every upload and read
 * before the signature was checked, so on local storage no attachment could be
 * stored or played (found 2026-10-17 while testing Admin Web voice notes).
 *
 * What must hold, both ways:
 *   - a correctly signed PUT/GET with NO bearer succeeds;
 *   - everything the signature binds still refuses: no signature, a forged one,
 *     an expired one, another object's, a different MIME type or size.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Controller, Get, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PlatformModule } from '@platform/platform.module';
import { AuthModule } from '@platform/auth/auth.module';
import { OBJECT_STORAGE } from '@platform/tokens';
import { StorageController } from '@communication/api/storage.controller';
import { SignedLocalObjectStorage } from '@communication/attachments/object-storage';
import { LocalFsBlobStore } from '@communication/attachments/blob-store';
import { applyInfrastructure } from '../../src/infra/http/bootstrap';

jest.setTimeout(60_000);

/** Test-only, deliberately NOT public: the guard must still answer for it. */
@Controller('probe')
class ProbeController {
  @Get()
  probe() {
    return { reached: true };
  }
}

const root = mkdtempSync(join(tmpdir(), 'jawwid-storage-http-'));
let app: INestApplication;
let storage: SignedLocalObjectStorage;
let base: string;

beforeAll(async () => {
  process.env.STORAGE_LOCAL_ROOT = root;
  storage = new SignedLocalObjectStorage();
  const moduleRef = await Test.createTestingModule({
    imports: [PlatformModule, AuthModule],
    controllers: [StorageController, ProbeController],
    providers: [{ provide: OBJECT_STORAGE, useValue: storage }, LocalFsBlobStore],
  }).compile();
  app = moduleRef.createNestApplication({ logger: false, rawBody: true });
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/live', 'health/ready'] });
  applyInfrastructure(app);
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}/api/v1/storage`;
});
afterAll(async () => {
  await app.close();
  rmSync(root, { recursive: true, force: true });
});

/** The signed URL the API would hand a client, re-pointed at this test server. */
const onThisServer = (signedUrl: string) => base + signedUrl.slice(signedUrl.indexOf('/storage') + '/storage'.length);
const VOICE = Buffer.from('a voice note, eleven+ bytes');

async function authorized(byteSize = VOICE.length, mimeType = 'audio/webm') {
  const grant = await storage.authorizeUpload({ prefix: 'conversations/c-1', mimeType, byteSize });
  return { ...grant, url: onThisServer(grant.uploadUrl) };
}
const put = (url: string, body: Buffer, contentType = 'audio/webm', extra: Record<string, string> = {}) =>
  fetch(url, { method: 'PUT', headers: { 'content-type': contentType, ...extra }, body });

it('a correctly signed upload with NO bearer token is stored, and its signed read plays it back', async () => {
  const grant = await authorized();
  const r = await put(grant.url, VOICE);
  expect(r.status).toBe(201);

  const read = await fetch(onThisServer(await storage.signedReadUrl(grant.objectKey)));
  expect(read.status).toBe(200);
  expect(read.headers.get('content-type')).toBe('audio/webm');
  expect(read.headers.get('x-content-type-options')).toBe('nosniff');
  expect(Buffer.from(await read.arrayBuffer())).toEqual(VOICE);
});

it('a signed read honours a byte range (a player seeking in a voice note)', async () => {
  const grant = await authorized();
  expect((await put(grant.url, VOICE)).status).toBe(201);
  const read = await fetch(onThisServer(await storage.signedReadUrl(grant.objectKey)), { headers: { range: 'bytes=0-4' } });
  expect(read.status).toBe(206);
  expect(Buffer.from(await read.arrayBuffer()).toString()).toBe('a voi');
});

describe('the signature is still the whole authorization', () => {
  it('no signature: refused, nothing stored', async () => {
    const grant = await authorized();
    const bare = grant.url.split('?')[0]!;
    expect((await put(`${bare}?size=${VOICE.length}`, VOICE)).status).toBe(403);
    expect((await fetch(bare)).status).toBe(403);
  });

  it('a forged signature: refused', async () => {
    const grant = await authorized();
    const forged = grant.url.replace(/sig=[^&]+/, 'sig=' + 'f'.repeat(64));
    expect((await put(forged, VOICE)).status).toBe(403);
  });

  it('an expired signature: refused', async () => {
    const grant = await authorized();
    const expired = grant.url.replace(/expires=\d+/, `expires=${Math.floor(Date.now() / 1000) - 60}`);
    expect((await put(expired, VOICE)).status).toBe(403);
  });

  it('another object\'s signature does not open this object', async () => {
    const a = await authorized();
    const b = await authorized();
    const swapped = b.url.replace(/sig=[^&]+/, a.url.match(/sig=[^&]+/)![0]);
    expect((await put(swapped, VOICE)).status).toBe(403);
  });

  it('a MIME type other than the one signed: refused (no text/html smuggled in as audio)', async () => {
    const grant = await authorized();
    expect((await put(grant.url, VOICE, 'text/html')).status).toBe(403);
  });

  it('more bytes than signed: refused', async () => {
    const grant = await authorized(5);
    expect((await put(grant.url, VOICE)).status).toBe(413);
  });

  it('a read signature cannot write, and an upload signature cannot read', async () => {
    const grant = await authorized();
    expect((await put(grant.url, VOICE)).status).toBe(201);
    const readUrl = onThisServer(await storage.signedReadUrl(grant.objectKey));
    expect((await put(`${readUrl}&size=${VOICE.length}`, VOICE)).status).toBe(403);
    expect((await fetch(grant.url)).status).toBe(403);
  });

  it('a bearer token is neither needed nor a substitute for the signature', async () => {
    const grant = await authorized();
    const bare = grant.url.split('?')[0]!;
    const r = await put(`${bare}?size=${VOICE.length}`, VOICE, 'audio/webm', { authorization: 'Bearer not-a-signature' });
    expect(r.status).toBe(403);
  });
});

it('every OTHER route still requires a bearer (the exemption is this controller only)', async () => {
  const r = await fetch(base.replace(/\/storage$/, '/probe'));
  expect(r.status).toBe(401);
  expect(((await r.json()) as { error: { code: string } }).error.code).toBe('AUTH.UNAUTHENTICATED');
});
