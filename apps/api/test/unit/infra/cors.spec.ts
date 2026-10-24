/**
 * CORS as a browser sees it: the preflight the API answers for an allowed
 * origin. PD-28: the teacher web portal is the Flutter app in a browser, so
 * every header that app sends must pass a preflight -- a phone never sends one,
 * which is how a missing header went unnoticed.
 */
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { applyInfrastructure } from '../../../src/infra/http/bootstrap';

@Module({})
class EmptyModule {}

describe('CORS preflight', () => {
  let app: INestApplication;
  let base: string;

  beforeAll(async () => {
    app = await NestFactory.create(EmptyModule, { logger: false });
    applyInfrastructure(app, { allowedOrigins: ['https://admin.jawwid.test'] });
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
  });

  async function preflight(origin: string, headers: string) {
    return fetch(`${base}/api/v1/conversations/c-1/messages`, {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': headers,
      },
    });
  }

  it("allows every header the Flutter app sends, from Admin Web's origin (where /teacher/ lives)", async () => {
    const response = await preflight('https://admin.jawwid.test', 'authorization,content-type,x-idempotency-key');
    expect(response.headers.get('access-control-allow-origin')).toBe('https://admin.jawwid.test');
    const allowed = (response.headers.get('access-control-allow-headers') ?? '').toLowerCase().split(',');
    expect(allowed).toEqual(expect.arrayContaining(['authorization', 'content-type', 'x-idempotency-key']));
  });

  it('still refuses an origin that is not on the list', async () => {
    const response = await preflight('https://evil.example', 'authorization');
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });
});
