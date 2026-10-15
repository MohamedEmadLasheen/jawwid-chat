/**
 * D4 / RT-038 -- the LiveKit webhook over REAL HTTP: the global guard, the
 * Express body parsers and the controller, as a running API has them.
 *
 * Two defects made every real LiveKit delivery fail before the controller
 * could verify it (W5, closed at 2be26b8, reopened for this on 2026-10-15 --
 * docs/release/REOPEN-W5-D4-2026-10-15.md):
 *   1. the global bearer guard answered 401 -- LiveKit authenticates with its
 *      own signature over the body, not with a Jawwid access token;
 *   2. LiveKit posts `application/webhook+json`, which no parser claimed, so
 *      the signed raw body never reached the controller ("no body").
 * Each test below fails if either returns. Every earlier W5 test called the
 * verifier or the service directly, which is how both stayed invisible.
 *
 * Ported from 4d028e1 (livekit-webhook-http.spec.ts) without its RT-037
 * join-time-enforcement case, which is not part of this reopen.
 */
import { randomUUID, createHash } from 'node:crypto';
import { Body, Controller, INestApplication, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AccessToken } from 'livekit-server-sdk';
import { PlatformModule } from '@platform/platform.module';
import { AuthModule } from '@platform/auth/auth.module';
import { Public } from '@platform/auth/auth.guard';
import { LiveKitWebhookController } from '@communication/api/livekit-webhook.controller';
import { LiveKitWebhookVerifier } from '@communication/calls/livekit-webhook.verifier';
import { MediaPresenceService } from '@communication/calls/media-presence.service';
import { OutboxService } from '@communication/outbox/outbox.service';
import { applyInfrastructure } from '../../src/infra/http/bootstrap';

jest.setTimeout(60_000);

/** Test-only: proves application/json bodies are still parsed with the webhook parser installed. */
@Public()
@Controller('echo')
class EchoController {
  @Post()
  echo(@Body() body: unknown) {
    return { body };
  }
}

/** Test-only: an ordinary route, with no @Public(), is still guarded. */
@Controller('private')
class PrivateController {
  @Post()
  touch() {
    return { reached: true };
  }
}

let app: INestApplication;
let base: string;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [PlatformModule, AuthModule],
    controllers: [LiveKitWebhookController, EchoController, PrivateController],
    providers: [LiveKitWebhookVerifier, MediaPresenceService, OutboxService],
  }).compile();
  app = moduleRef.createNestApplication({ logger: false, rawBody: true });
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/live', 'health/ready'] });
  applyInfrastructure(app);
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}/api/v1`;
});
afterAll(async () => {
  await app.close();
});

async function signed(raw: string): Promise<string> {
  const t = new AccessToken(process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!);
  t.sha256 = createHash('sha256').update(raw).digest('base64');
  return t.toJwt();
}
const event = (name: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ event: name, createdAt: Math.floor(Date.now() / 1000), id: randomUUID(), room: { name: 'jawwid-x', sid: 'RM_x' }, ...extra });

it('a LiveKit-signed delivery as LiveKit sends it (application/webhook+json, no bearer) is ACCEPTED', async () => {
  const raw = event('room_started');
  const r = await fetch(`${base}/livekit/webhook`, {
    method: 'POST', headers: { 'content-type': 'application/webhook+json', authorization: await signed(raw) }, body: raw,
  });
  expect(r.status).toBe(200);
  expect(await r.json()).toEqual({ ok: true });
});

it('the same with application/json is accepted too', async () => {
  const raw = event('room_finished');
  const r = await fetch(`${base}/livekit/webhook`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: await signed(raw) }, body: raw,
  });
  expect(r.status).toBe(200);
});

it('an unsigned or tampered delivery is refused BY THE CONTROLLER\'s signature check, not by the bearer guard', async () => {
  const raw = event('room_started');
  for (const authorization of ['', 'not-a-jwt', await signed(event('room_started'))]) {
    const r = await fetch(`${base}/livekit/webhook`, {
      method: 'POST', headers: { 'content-type': 'application/webhook+json', ...(authorization ? { authorization } : {}) }, body: raw,
    });
    expect(r.status).toBe(401);
    expect(JSON.stringify(await r.json())).not.toContain('AUTH.UNAUTHENTICATED');
  }
});

it('ordinary JSON bodies are still parsed (the webhook parser claims only its own type); a user route still needs a token', async () => {
  const r = await fetch(`${base}/echo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ x: 1 }) });
  expect(await r.json()).toEqual({ body: { x: 1 } });
  const guarded = await fetch(`${base}/private`, { method: 'POST' });
  expect(guarded.status).toBe(401);
  expect(JSON.stringify(await guarded.json())).toContain('AUTH.UNAUTHENTICATED');
});
