/**
 * The LiveKit webhook over REAL HTTP -- the global guard, the Express body
 * parsers and the controller, as a running API has them.
 *
 * Two defects made every real LiveKit delivery fail before the controller
 * could verify it (found 2026-10-14 against a real LiveKit 1.8 server, while
 * closing RT-037; W5 reopened for them):
 *   1. the global bearer guard (PR-B) answered 401 -- LiveKit authenticates
 *      with its own signature, not a Jawwid token;
 *   2. LiveKit posts `application/webhook+json`, which no parser claimed, so
 *      the signed raw body never reached the controller ("no body").
 * Each test below fails if either returns.
 */
import { randomUUID, createHash } from 'node:crypto';
import { Body, Controller, INestApplication, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AccessToken } from 'livekit-server-sdk';
import { PlatformModule } from '@platform/platform.module';
import { AuthModule } from '@platform/auth/auth.module';
import { Public } from '@platform/auth/auth.guard';
import { MEDIA_ROOM_CONTROL } from '@platform/tokens';
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

const removed: Array<[string, string]> = [];
let app: INestApplication;
let base: string;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [PlatformModule, AuthModule],
    controllers: [LiveKitWebhookController, EchoController],
    providers: [
      LiveKitWebhookVerifier,
      MediaPresenceService,
      OutboxService,
      {
        provide: MEDIA_ROOM_CONTROL,
        useValue: { configured: true, removeParticipant: async (r: string, i: string) => { removed.push([r, i]); return 'absent'; } },
      },
    ],
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

it('a join by an identity that is no longer live reaches the join-time enforcement over HTTP', async () => {
  const unknownIdentity = randomUUID(); // not a live principal of any table
  const raw = event('participant_joined', { participant: { identity: unknownIdentity, name: 'x' } });
  const r = await fetch(`${base}/livekit/webhook`, {
    method: 'POST', headers: { 'content-type': 'application/webhook+json', authorization: await signed(raw) }, body: raw,
  });
  expect(r.status).toBe(200);
  expect(removed).toContainEqual(['jawwid-x', unknownIdentity]);
});

it('ordinary JSON bodies are still parsed (the webhook parser claims only its own type); a user route still needs a token', async () => {
  const r = await fetch(`${base}/echo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ x: 1 }) });
  expect(await r.json()).toEqual({ body: { x: 1 } });
  const me = await fetch(`${base}/me`);
  expect(me.status).toBe(401);
});
