import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SignedLocalObjectStorage } from '@communication/attachments/object-storage';
import { StorageController } from '@communication/api/storage.controller';

/**
 * Where the local reference storage tells a client to come back to.
 *
 * ## The defect this closes
 *
 * `SignedLocalObjectStorage` signs URLs that point at THIS API's own storage route, so the
 * base it builds them from has to be a path this API actually serves. The default was
 * `http://localhost:3000/storage`, and the route is `/api/v1/storage/:objectKey`, because
 * `main.ts` applies a global prefix and excludes only the health probes. Every signed URL
 * minted from the default therefore 404'd -- an upload PUT went nowhere and the photo that
 * followed could never be read.
 *
 * ## Why nothing caught it
 *
 * Every existing suite either constructs this class and verifies the SIGNATURE -- which is
 * correct whatever the host and path are -- or sets `STORAGE_ENDPOINT` to its own test
 * server, which includes whatever path that server serves. The bug lives exclusively in the
 * default, and only an actual HTTP GET of a minted URL reveals it. So these tests assert the
 * one thing a signature check cannot: that the ADDRESS is real.
 *
 * The prefix is read out of `main.ts` rather than written here twice. A test that hardcodes
 * `api/v1` keeps passing after somebody changes the prefix and breaks every signed URL --
 * which is the same class of failure all over again.
 */
describe('the base of a locally signed URL', () => {
  const secret = 'a'.repeat(32);
  let previousSecret: string | undefined;
  let previousPublic: string | undefined;
  let previousEndpoint: string | undefined;

  beforeEach(() => {
    previousSecret = process.env.STORAGE_SIGNING_SECRET;
    previousPublic = process.env.STORAGE_PUBLIC_BASE_URL;
    previousEndpoint = process.env.STORAGE_ENDPOINT;
    process.env.STORAGE_SIGNING_SECRET = secret;
    delete process.env.STORAGE_PUBLIC_BASE_URL;
    delete process.env.STORAGE_ENDPOINT;
  });

  afterEach(() => {
    restore('STORAGE_SIGNING_SECRET', previousSecret);
    restore('STORAGE_PUBLIC_BASE_URL', previousPublic);
    restore('STORAGE_ENDPOINT', previousEndpoint);
  });

  function restore(name: string, value: string | undefined): void {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }

  /** The global prefix, taken from the file that declares it. */
  function globalPrefix(): string {
    const main = readFileSync(join(__dirname, '../../../src/main.ts'), 'utf8');
    const match = /setGlobalPrefix\(\s*'([^']+)'/.exec(main);
    if (!match) throw new Error('main.ts no longer calls setGlobalPrefix with a literal');
    return match[1];
  }

  /** The controller's own path segment, taken from its decorator. */
  function controllerPath(): string {
    const path = Reflect.getMetadata('path', StorageController);
    if (typeof path !== 'string') throw new Error('StorageController declares no path');
    return path;
  }

  it('addresses the path this API actually serves', async () => {
    const url = await new SignedLocalObjectStorage().signedReadUrl('avatars/abc', 300);

    expect(new URL(url).pathname).toContain(`/${globalPrefix()}/${controllerPath()}/`);
  });

  it('is a complete absolute URL, so a phone can resolve it', async () => {
    const url = await new SignedLocalObjectStorage().signedReadUrl('avatars/abc', 300);

    const parsed = new URL(url);
    expect(parsed.protocol).toMatch(/^https?:$/);
    expect(parsed.host).toBeTruthy();
  });

  it('an upload URL addresses the same route as a read URL', async () => {
    const storage = new SignedLocalObjectStorage();

    const read = await storage.signedReadUrl('avatars/abc', 300);
    const upload = await storage.authorizeUpload({
      prefix: 'avatars',
      mimeType: 'image/jpeg',
      byteSize: 10,
    });

    // The PUT and the GET are served by one controller. A base that is right for one and
    // wrong for the other would store bytes nobody can read back.
    expect(new URL(upload.uploadUrl).origin).toBe(new URL(read).origin);
    expect(new URL(upload.uploadUrl).pathname).toContain(
      `/${globalPrefix()}/${controllerPath()}/`,
    );
  });

  it('STORAGE_PUBLIC_BASE_URL is used verbatim when set', async () => {
    process.env.STORAGE_PUBLIC_BASE_URL = 'http://192.0.2.10:3277/api/v1/storage';

    const url = await new SignedLocalObjectStorage().signedReadUrl('avatars/abc', 300);

    expect(url.startsWith('http://192.0.2.10:3277/api/v1/storage/')).toBe(true);
  });

  it('STORAGE_PUBLIC_BASE_URL wins over STORAGE_ENDPOINT', async () => {
    // STORAGE_ENDPOINT is a member of S3_VARS: on its own it makes startup fail "partially
    // configured", so it is the wrong lever for "give the phone a reachable host". The
    // precedence is what lets a deployment set the host without selecting a backend.
    process.env.STORAGE_ENDPOINT = 'http://should-not-be-used.invalid/storage';
    process.env.STORAGE_PUBLIC_BASE_URL = 'http://192.0.2.10:3277/api/v1/storage';

    const url = await new SignedLocalObjectStorage().signedReadUrl('avatars/abc', 300);

    expect(url).toContain('192.0.2.10');
    expect(url).not.toContain('should-not-be-used');
  });
});
