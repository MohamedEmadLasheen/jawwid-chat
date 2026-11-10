/**
 * `POST /notifications/devices`: the device is always registered to the
 * authenticated caller and to the caller's current session, and the body is
 * whitelisted and type-checked.
 *
 * There is no global ValidationPipe, so the controller is the only place the
 * body's shape is checked. Exercised directly against the controller with a
 * recording double of NotificationService.
 *
 * (#534's spec, carried into #537: the session the guard verified -- never
 * anything in the body -- is what LR-46 binds the token to.)
 */
import { NotificationController } from '@communication/api/notification.controller';
import type { NotificationService } from '@communication/notifications/notification.service';
import { CommError, CommErrorCode } from '@platform/errors';

const CALLER = '11111111-1111-4111-8111-111111111111';
const SOMEONE_ELSE = '22222222-2222-4222-8222-222222222222';
const SESSION = '33333333-3333-4333-8333-333333333333';
const OTHER_SESSION = '44444444-4444-4444-8444-444444444444';

/** What the guard attaches: the verified session. */
const REQUEST = { sessionId: SESSION };

function setup() {
  const calls: Array<Record<string, unknown>> = [];
  const service = {
    registerDevice: async (input: Record<string, unknown>) => {
      calls.push(input);
    },
  } as unknown as NotificationService;
  return { controller: new NotificationController(service), calls };
}

async function rejection(p: Promise<unknown>): Promise<CommError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(CommError);
    return e as CommError;
  }
  throw new Error('expected a rejection');
}

describe('POST /notifications/devices: owner, session and body shape', () => {
  it('registers to the caller even when the body names another actorId', async () => {
    const { controller, calls } = setup();
    await controller.register(CALLER, {
      token: 'tok-1',
      platform: 'android',
      actorId: SOMEONE_ELSE,
    } as never, REQUEST);
    expect(calls).toHaveLength(1);
    expect(calls[0].actorId).toBe(CALLER);
  });

  it('binds to the verified session, never one named in the body (LR-46)', async () => {
    const { controller, calls } = setup();
    await controller.register(CALLER, {
      token: 'tok-s',
      platform: 'ios',
      sessionId: OTHER_SESSION,
    } as never, REQUEST);
    expect(calls[0].sessionId).toBe(SESSION);
  });

  it('a request with no session (none attached) passes null, never something from the body', async () => {
    const { controller, calls } = setup();
    await controller.register(CALLER, { token: 'tok-n', platform: 'ios', sessionId: OTHER_SESSION } as never, {});
    expect(calls[0].sessionId).toBeNull();
  });

  it('passes only the whitelisted fields; unknown fields are dropped', async () => {
    const { controller, calls } = setup();
    await controller.register(CALLER, {
      token: 'tok-2',
      platform: 'ios',
      isVoip: true,
      locale: 'en',
      organizationId: 'x',
      isActive: false,
    } as never, REQUEST);
    expect(calls[0]).toEqual({
      actorId: CALLER,
      sessionId: SESSION,
      token: 'tok-2',
      platform: 'ios',
      isVoip: true,
      locale: 'en',
    });
  });

  it('leaves optional fields absent when the client omits them (service defaults apply)', async () => {
    const { controller, calls } = setup();
    await controller.register(CALLER, { token: 'tok-3', platform: 'web' } as never, REQUEST);
    expect(calls[0]).toEqual({ actorId: CALLER, sessionId: SESSION, token: 'tok-3', platform: 'web' });
  });

  it('accepts the exact payload the app sends', async () => {
    const { controller, calls } = setup();
    await controller.register(CALLER, { token: 'a'.repeat(64), platform: 'ios', isVoip: false } as never, REQUEST);
    expect(calls[0]).toEqual({
      actorId: CALLER,
      sessionId: SESSION,
      token: 'a'.repeat(64),
      platform: 'ios',
      isVoip: false,
    });
  });

  const malformed: Array<[string, unknown]> = [
    ['no body', undefined],
    ['null body', null],
    ['an array body', [{ token: 't', platform: 'ios' }]],
    ['a string body', 'token=t'],
    ['missing token', { platform: 'ios' }],
    ['empty token', { token: '', platform: 'ios' }],
    ['blank token', { token: '   ', platform: 'ios' }],
    ['non-string token', { token: 123, platform: 'ios' }],
    ['object token', { token: { $ne: '' }, platform: 'ios' }],
    ['over-long token', { token: 'x'.repeat(4097), platform: 'ios' }],
    ['missing platform', { token: 't' }],
    ['unknown platform', { token: 't', platform: 'windows' }],
    ['upper-case platform', { token: 't', platform: 'IOS' }],
    ['non-string platform', { token: 't', platform: 1 }],
    ['string isVoip', { token: 't', platform: 'ios', isVoip: 'true' }],
    ['numeric isVoip', { token: 't', platform: 'ios', isVoip: 1 }],
    ['unknown locale', { token: 't', platform: 'ios', locale: 'fr' }],
    ['non-string locale', { token: 't', platform: 'ios', locale: 7 }],
  ];

  it.each(malformed)('rejects %s with 400 COMMON.VALIDATION and registers nothing', async (_name, body) => {
    const { controller, calls } = setup();
    const err = await rejection(controller.register(CALLER, body as never, REQUEST));
    expect(err.code).toBe(CommErrorCode.VALIDATION);
    expect(err.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});
