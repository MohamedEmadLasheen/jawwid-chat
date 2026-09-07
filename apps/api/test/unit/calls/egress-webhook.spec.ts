/**
 * PHASE 5 CLOSURE -- the egress webhook is authenticated, and narrow.
 *
 * This route is the one place in the API that accepts a write from something
 * that is not a user. Egress is a service: it has no session and no actor, so
 * the ordinary auth guard has nothing to resolve -- which is exactly the shape
 * of route that becomes an unauthenticated write endpoint by accident.
 *
 * What replaces the guard is LiveKit's webhook signature, and these tests are
 * what keep it real. Every one of them is an attack.
 */
import { createHash, createHmac } from 'node:crypto';
import { EgressWebhookController } from '@communication/api/egress-webhook.controller';
import type { RecordingService } from '@communication/calls/recording.service';

const SECRET = 'test-livekit-secret-at-least-32-characters';

/** A recording service that records what it was asked to do, and nothing more. */
function stubRecordings() {
  const completed: unknown[] = [];
  const failed: Array<[string, string]> = [];
  return {
    completed,
    failed,
    service: {
      completeFromEgress: async (input: unknown) => {
        completed.push(input);
        return true;
      },
      failFromEgress: async (egressId: string, code: string) => {
        failed.push([egressId, code]);
        return true;
      },
    } as unknown as RecordingService,
  };
}

const b64url = (i: Buffer | string) =>
  Buffer.from(i).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** A LiveKit webhook signature over `body`, as the real sender produces it. */
function sign(body: unknown, secret = SECRET, overrides: Record<string, unknown> = {}): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    iss: 'devkey',
    exp: Math.floor(Date.now() / 1000) + 300,
    sha256: createHash('sha256').update(JSON.stringify(body)).digest('base64'),
    ...overrides,
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  return `${signingInput}.${b64url(createHmac('sha256', secret).update(signingInput).digest())}`;
}

const endedBody = (egressId = 'EG_1') => ({
  event: 'egress_ended',
  egress_info: {
    egress_id: egressId,
    status: 'EGRESS_COMPLETE',
    file_results: [
      { filename: 'recordings/call-1/obj.ogg', size: 4096, duration: 73_000_000_000 },
    ],
  },
});

beforeEach(() => {
  process.env.LIVEKIT_API_SECRET = SECRET;
});

describe('a correctly signed webhook', () => {
  it('completes the recording, converting nanoseconds to whole seconds', async () => {
    const { service, completed } = stubRecordings();
    const controller = new EgressWebhookController(service);
    const body = endedBody();

    expect(await controller.receive(`Bearer ${sign(body)}`, body)).toEqual({ ok: true });
    expect(completed).toEqual([
      {
        egressId: 'EG_1',
        // 73_000_000_000ns. Storing nanoseconds in a seconds column would
        // report every call as lasting two millennia.
        durationSeconds: 73,
        byteSize: 4096,
        objectKey: 'recordings/call-1/obj.ogg',
      },
    ]);
  });

  it('a non-complete status is a FAILURE, never a completion', async () => {
    // The defect this prevents: marking a recording available with no file
    // behind it, because the event name said "ended".
    const { service, completed, failed } = stubRecordings();
    const controller = new EgressWebhookController(service);
    const body = {
      event: 'egress_ended',
      egress_info: { egress_id: 'EG_2', status: 'EGRESS_ABORTED' },
    };

    await controller.receive(`Bearer ${sign(body)}`, body);
    expect(completed).toHaveLength(0);
    expect(failed).toEqual([['EG_2', 'EGRESS_EGRESS_ABORTED']]);
  });

  it('acknowledges events it does not act on, rather than making them retry', async () => {
    const { service, completed, failed } = stubRecordings();
    const controller = new EgressWebhookController(service);
    const body = { event: 'egress_started', egress_info: { egress_id: 'EG_3' } };

    expect(await controller.receive(`Bearer ${sign(body)}`, body)).toEqual({ ok: true });
    expect(completed).toHaveLength(0);
    expect(failed).toHaveLength(0);
  });
});

describe('everything unsigned or mis-signed changes nothing', () => {
  const attacks: Array<
    [string, () => { auth: string | undefined; body: Record<string, unknown> }]
  > = [
    [
      'no Authorization header at all',
      () => ({ auth: undefined, body: endedBody() }),
    ],
    [
      'a signature made with the wrong secret',
      () => ({ auth: `Bearer ${sign(endedBody(), 'not-the-livekit-secret')}`, body: endedBody() }),
    ],
    [
      'a valid signature over a DIFFERENT body (a replay with substituted contents)',
      () => ({
        // Signed over one payload, sent with another. Checking only the
        // signature -- and not the body digest -- would let this through.
        auth: `Bearer ${sign(endedBody('EG_original'))}`,
        body: endedBody('EG_substituted'),
      }),
    ],
    [
      'an expired signature',
      () => {
        const body = endedBody();
        return {
          auth: `Bearer ${sign(body, SECRET, { exp: Math.floor(Date.now() / 1000) - 60 })}`,
          body,
        };
      },
    ],
    [
      'a token that is not a JWT',
      () => ({ auth: 'Bearer not-a-token', body: endedBody() }),
    ],
    [
      'a signature whose sha256 claim is missing',
      () => {
        const body = endedBody();
        return { auth: `Bearer ${sign(body, SECRET, { sha256: undefined })}`, body };
      },
    ],
  ];

  for (const [name, build] of attacks) {
    it(`refuses ${name}`, async () => {
      const { service, completed, failed } = stubRecordings();
      const controller = new EgressWebhookController(service);
      const { auth, body } = build();

      const result = await controller.receive(auth, body);

      expect(result).toEqual({ ok: false });
      // The point is not the status code: it is that NOTHING was written.
      expect(completed).toHaveLength(0);
      expect(failed).toHaveLength(0);
    });
  }

  it('refuses everything when the deployment has no LiveKit secret configured', async () => {
    // An unconfigured deployment must not accept unsigned webhooks by falling
    // through to "no secret, so nothing to check".
    delete process.env.LIVEKIT_API_SECRET;
    const { service, completed } = stubRecordings();
    const controller = new EgressWebhookController(service);
    const body = endedBody();

    expect(await controller.receive(`Bearer ${sign(body)}`, body)).toEqual({ ok: false });
    expect(completed).toHaveLength(0);
  });
});
