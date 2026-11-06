import { originOfRequest, runWithRequestOrigin } from '@platform/request-origin';
import { MediaUrlSigner } from '@platform/media-url';

/** RT-037 / RT-039: where a media link points, for every deployment shape. */
describe('media link origin', () => {
  const req = (headers: Record<string, string>, protocol = 'http') => ({ protocol, headers });

  it('uses the Host the request reached us at', () => {
    expect(originOfRequest(req({ host: '192.168.1.20:3386' }))).toBe('http://192.168.1.20:3386');
    expect(originOfRequest(req({ host: 'api.example.test' }, 'https'))).toBe('https://api.example.test');
  });

  it('never reads X-Forwarded-Host: App Platform passes a forged one through, so it could only lie', () => {
    const r = req({ host: 'api.example.test', 'x-forwarded-host': 'evil.test' }, 'https');
    expect(originOfRequest(r)).toBe('https://api.example.test');
    const saved = process.env.TRUSTED_PROXY_HOPS;
    try {
      // Not even behind a declared proxy.
      process.env.TRUSTED_PROXY_HOPS = '2';
      expect(originOfRequest(r)).toBe('https://api.example.test');
      expect(originOfRequest(req({ host: 'a b', 'x-forwarded-host': 'evil.test' }))).toBeUndefined();
    } finally {
      if (saved === undefined) delete process.env.TRUSTED_PROXY_HOPS;
      else process.env.TRUSTED_PROXY_HOPS = saved;
    }
  });

  it('refuses a hostile Host (no link is built from it)', () => {
    for (const host of ['evil.test/path', 'a b', 'x@y', 'evil.test\r\nX: y', '']) {
      expect(originOfRequest(req({ host }))).toBeUndefined();
    }
  });

  it('MEDIA_PUBLIC_BASE_URL wins; else the request origin + /api/v1; never localhost by default', () => {
    const signer = new MediaUrlSigner();
    const saved = process.env.MEDIA_PUBLIC_BASE_URL;
    try {
      delete process.env.MEDIA_PUBLIC_BASE_URL;
      expect(signer.url('attachments', 'id', 'o', 'a', 60)).toMatch(/^\/api\/v1\/media\/attachments\/id\?/);
      runWithRequestOrigin('https://api.example.test', () =>
        expect(signer.url('attachments', 'id', 'o', 'a', 60)).toMatch(/^https:\/\/api\.example\.test\/api\/v1\/media\//));
      process.env.MEDIA_PUBLIC_BASE_URL = 'https://cdn.example.test/chat/api/v1/';
      runWithRequestOrigin('https://internal:3000', () =>
        expect(signer.url('attachments', 'id', 'o', 'a', 60)).toMatch(/^https:\/\/cdn\.example\.test\/chat\/api\/v1\/media\//));
    } finally {
      if (saved === undefined) delete process.env.MEDIA_PUBLIC_BASE_URL;
      else process.env.MEDIA_PUBLIC_BASE_URL = saved;
    }
  });
});
