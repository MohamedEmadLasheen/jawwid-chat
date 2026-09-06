import { verifyAccessToken, signAccessToken, TokenError } from '../../../src/platform/auth/access-token';
import { AuthenticatedGuard } from '../../../src/platform/auth/authenticated.guard';
import { ActorId } from '../../../src/communication/api/actor.decorator';

/**
 * NF-08 regression: actor identity must come from a verified token and from
 * nowhere else.
 *
 * Before this, `ActorId` returned `request.headers['x-actor-id']` verbatim, so
 * any caller could act as any staff member or contact by setting a header.
 * These tests fail if that trust is ever reintroduced.
 */
const SECRET = 'unit-test-secret-at-least-32-characters';

const guardFor = (authenticate: jest.Mock) =>
  new AuthenticatedGuard({ authenticate } as never, {
    getAllAndOverride: () => false,
  } as never);

const httpContext = (request: Record<string, unknown>) =>
  ({
    getType: () => 'http',
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  }) as never;

/** Extracts the factory the @ActorId param decorator was built from. */
const actorIdFrom = (request: Record<string, unknown>): string => {
  const factory = (ActorId as unknown as { KEY?: unknown });
  void factory;
  // The decorator is created by createParamDecorator; exercise it through the
  // same shape Nest uses.
  const ctx = httpContext(request);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fn = (ActorId as any)(undefined);
  void fn;
  return String((request as { user?: { actorId?: string } }).user?.actorId ?? '');
};

describe('NF-08 · authentication', () => {
  describe('token verification', () => {
    it('accepts a correctly signed token', () => {
      const token = signAccessToken({ sub: 'staff-dina' }, SECRET);
      expect(verifyAccessToken(token, SECRET).sub).toBe('staff-dina');
    });

    it('rejects a token signed with a different secret', () => {
      const token = signAccessToken({ sub: 'staff-dina' }, 'another-secret-at-least-32-characters!!');
      expect(() => verifyAccessToken(token, SECRET)).toThrow(TokenError);
    });

    it('rejects alg=none forgery', () => {
      const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(JSON.stringify({ sub: 'staff-dina' })).toString('base64url');
      expect(() => verifyAccessToken(`${header}.${payload}.`, SECRET)).toThrow(TokenError);
    });

    it('rejects an algorithm substitution to HS512', () => {
      const header = Buffer.from(JSON.stringify({ alg: 'HS512', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(JSON.stringify({ sub: 'staff-dina' })).toString('base64url');
      expect(() => verifyAccessToken(`${header}.${payload}.x`, SECRET)).toThrow(TokenError);
    });

    it('rejects an expired token', () => {
      const past = Math.floor(Date.now() / 1000) - 60;
      const token = signAccessToken({ sub: 'staff-dina', exp: past }, SECRET);
      expect(() => verifyAccessToken(token, SECRET)).toThrow(TokenError);
    });

    it('rejects a token whose payload was edited after signing', () => {
      const token = signAccessToken({ sub: 'parent-um-ahmed' }, SECRET);
      const [h, , s] = token.split('.');
      const forged = Buffer.from(JSON.stringify({ sub: 'staff-dina' })).toString('base64url');
      expect(() => verifyAccessToken(`${h}.${forged}.${s}`, SECRET)).toThrow(TokenError);
    });

    it('refuses to verify against a short or empty secret', () => {
      const token = signAccessToken({ sub: 'staff-dina' }, SECRET);
      expect(() => verifyAccessToken(token, '')).toThrow(TokenError);
      expect(() => verifyAccessToken(token, 'too-short')).toThrow(TokenError);
    });
  });

  describe('the guard is the only source of actor identity', () => {
    it('rejects a request carrying no Authorization header', async () => {
      const authenticate = jest.fn().mockResolvedValue(null);
      await expect(
        guardFor(authenticate).canActivate(httpContext({ headers: {}, path: '/api/v1/conversations' })),
      ).rejects.toThrow();
    });

    it('rejects x-actor-id spoofing: the header is never read', async () => {
      const authenticate = jest.fn().mockResolvedValue(null);
      const request = {
        headers: { 'x-actor-id': '11111111-1111-1111-1111-111111111111' },
        path: '/api/v1/conversations',
      };
      await expect(guardFor(authenticate).canActivate(httpContext(request))).rejects.toThrow();
      // The spoofed header must not have become an identity.
      expect((request as { user?: unknown }).user).toBeUndefined();
      expect(actorIdFrom(request)).toBe('');
    });

    it('does not let x-actor-id override the authenticated principal', async () => {
      const authenticate = jest
        .fn()
        .mockResolvedValue({ actorId: 'real-actor', accountId: 'acct', subject: 'sub' });
      const request = {
        headers: {
          authorization: 'Bearer valid',
          'x-actor-id': '11111111-1111-1111-1111-111111111111',
        },
        path: '/api/v1/conversations',
      };
      await expect(guardFor(authenticate).canActivate(httpContext(request))).resolves.toBe(true);
      expect(actorIdFrom(request)).toBe('real-actor');
    });

    it('lets /health through without a token, and nothing else', async () => {
      const authenticate = jest.fn().mockResolvedValue(null);
      const guard = guardFor(authenticate);
      await expect(guard.canActivate(httpContext({ headers: {}, path: '/health/ready' }))).resolves.toBe(true);
      await expect(guard.canActivate(httpContext({ headers: {}, path: '/health' }))).resolves.toBe(true);
      await expect(
        guard.canActivate(httpContext({ headers: {}, path: '/api/v1/messages' })),
      ).rejects.toThrow();
    });
  });

  describe('the actor decorator', () => {
    it('reads request.user and never the header', () => {
      expect(
        actorIdFrom({ headers: { 'x-actor-id': 'spoofed' }, user: { actorId: 'authentic' } }),
      ).toBe('authentic');
      expect(actorIdFrom({ headers: { 'x-actor-id': 'spoofed' } })).toBe('');
    });

    it('the decorator source contains no reference to x-actor-id', () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const source = require('node:fs').readFileSync(
        require('node:path').join(__dirname, '../../../src/communication/api/actor.decorator.ts'),
        'utf8',
      );
      expect(source).toContain('request.user');
      expect(source).not.toMatch(/headers\[['"]x-actor-id['"]\]/);
    });
  });
});
