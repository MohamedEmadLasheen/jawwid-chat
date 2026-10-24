/**
 * PD-29: the play token is signed with a PURPOSE-BOUND key derived from
 * JWT_ACCESS_SECRET, never the secret itself -- so it can neither be confused
 * with nor used to forge an access token (or anything else signed from that
 * secret), and vice versa.
 */
import { createHmac } from 'node:crypto';
import { PlayTokenSigner, PLAY_TOKEN_LABEL } from '../../../src/materials/play-token';
import { signAccessToken } from '../../../src/platform/auth/jwt';
import { playCsp } from '../../../src/materials/play.controller';

const SECRET = 'unit-test-access-secret-32-characters-long!';
const ITEM = '11111111-1111-4111-8111-111111111111';
const KEY = 'materials/org/aaaa';
const ACTOR = '22222222-2222-4222-8222-222222222222';

describe('PD-29 play token', () => {
  const signer = new PlayTokenSigner(() => SECRET);

  it('verifies for its item, package and viewer, and names the viewer', () => {
    const t = signer.sign(ITEM, KEY, ACTOR);
    expect(signer.verify(t, ITEM, KEY)).toMatchObject({ actorId: ACTOR });
  });

  it('refuses another item, a replaced package, an expired or tampered token, and another viewer', () => {
    const t = signer.sign(ITEM, KEY, ACTOR);
    expect(signer.verify(t, '33333333-3333-4333-8333-333333333333', KEY)).toBeNull();
    expect(signer.verify(t, ITEM, 'materials/org/bbbb')).toBeNull();
    expect(signer.verify(signer.sign(ITEM, KEY, ACTOR, -10), ITEM, KEY)).toBeNull();
    const [, exp, mac] = t.split('.');
    expect(signer.verify(`33333333-3333-4333-8333-333333333333.${exp}.${mac}`, ITEM, KEY)).toBeNull();
    expect(signer.verify(`${ACTOR}.${Number(exp) + 1000}.${mac}`, ITEM, KEY)).toBeNull();
    expect(signer.verify('garbage', ITEM, KEY)).toBeNull();
    expect(signer.verify(`${ACTOR}.${exp}.${mac}x`, ITEM, KEY)).toBeNull();
  });

  it('is keyed by HMAC(secret, label), not by the secret itself', () => {
    const t = signer.sign(ITEM, KEY, ACTOR);
    const [actor, exp, mac] = t.split('.');
    const payload = `${ITEM}\n${KEY}\n${actor}\n${exp}`;
    const withRawSecret = createHmac('sha256', SECRET).update(payload).digest('base64url');
    expect(mac).not.toBe(withRawSecret);
    const derived = createHmac('sha256', SECRET).update(PLAY_TOKEN_LABEL).digest();
    expect(mac).toBe(createHmac('sha256', derived).update(payload).digest('base64url'));
  });

  it('a value signed as a JWT with the same secret never verifies as a play token', () => {
    const jwt = signAccessToken(
      { sub: ACTOR, kind: 'contact' } as never,
      { issuer: 'i', audience: 'a', accessTtlSeconds: 600, activeKey: { kid: 'k1', secret: SECRET } } as never,
    );
    expect(signer.verify(jwt, ITEM, KEY)).toBeNull();
    // Nor does a token built from the JWT's own signature in the play shape.
    const jwtSig = jwt.split('.')[2];
    const exp = Math.floor(Date.now() / 1000) + 600;
    expect(signer.verify(`${ACTOR}.${exp}.${jwtSig}`, ITEM, KEY)).toBeNull();
    // And a raw-secret HMAC of the play payload (what a key mix-up would produce) is refused.
    const raw = createHmac('sha256', SECRET).update(`${ITEM}\n${KEY}\n${ACTOR}\n${exp}`).digest('base64url');
    expect(signer.verify(`${ACTOR}.${exp}.${raw}`, ITEM, KEY)).toBeNull();
  });

  it('refuses to sign without a real secret', () => {
    expect(() => new PlayTokenSigner(() => 'short').sign(ITEM, KEY, ACTOR)).toThrow(/JWT_ACCESS_SECRET/);
  });
});

describe('PD-29 play CSP', () => {
  it('sandboxes the package without same-origin, keeps it to its own files, and names who may frame it', () => {
    const csp = playCsp(['https://admin.example.test']);
    expect(csp).toMatch(/^sandbox allow-scripts allow-forms;/);
    expect(csp).not.toContain('allow-same-origin');
    expect(csp).not.toContain('allow-top-navigation');
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain('frame-ancestors https://admin.example.test');
    expect(playCsp([])).toContain("frame-ancestors 'none'");
  });
});
