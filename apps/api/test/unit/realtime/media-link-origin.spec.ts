import { originOfRequest, runWithRequestOrigin } from '@platform/request-origin';
import { MediaUrlSigner } from '@platform/media-url';

/** RT-037 / RT-039: where a media link points, for every deployment shape. */
describe('media link origin', () => {
  const req = (headers: Record<string, string>, protocol = 'http') => ({ protocol, headers });

  it('uses the Host the request reached us at', () => {
    expect(originOfRequest(req({ host: '192.168.1.20:3386' }), false)).toBe('http://192.168.1.20:3386');
    expect(originOfRequest(req({ host: 'api.example.test' }, 'https'), false)).toBe('https://api.example.test');
  });

  it('ignores X-Forwarded-Host unless a trusted proxy is declared; honours it (first hop) when one is', () => {
    const r = req({ host: 'internal:3000', 'x-forwarded-host': 'api.example.test, evil.test' }, 'https');
    expect(originOfRequest(r, false)).toBe('https://internal:3000');
    expect(originOfRequest(r, true)).toBe('https://api.example.test');
  });

  it('refuses a hostile Host (no link is built from it)', () => {
    for (const host of ['evil.test/path', 'a b', 'x@y', 'evil.test\r\nX: y', '']) {
      expect(originOfRequest(req({ host }), false)).toBeUndefined();
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
