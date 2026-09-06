/**
 * PROTECTED (docs/qa/protected-tests.tsv) -- RT-001 containment.
 *
 * The header-identity seam is the only open P0. This suite pins the rule that
 * a build carrying the seam cannot start outside a local environment. Widening
 * the allow-list or removing the guard must fail here first.
 */
import {
  assertHeaderIdentitySeamAllowed,
  IdentitySeamRefused,
  SEAM_ALLOWED_ENVIRONMENTS,
} from '@platform/identity-seam';

describe('RT-001 containment: the x-actor-id seam never runs outside local', () => {
  it('refuses production', () => {
    expect(() => assertHeaderIdentitySeamAllowed({ APP_ENV: 'production' })).toThrow(
      IdentitySeamRefused,
    );
  });

  it('refuses staging', () => {
    expect(() => assertHeaderIdentitySeamAllowed({ APP_ENV: 'staging' })).toThrow(
      IdentitySeamRefused,
    );
  });

  it('refuses any environment that is not on the allow-list, whatever its casing', () => {
    for (const env of ['Production', 'PROD', 'prod', 'preview', 'demo', 'uat', ' ']) {
      expect(() => assertHeaderIdentitySeamAllowed({ APP_ENV: env })).toThrow(IdentitySeamRefused);
    }
  });

  it('allows exactly local, test and ci', () => {
    expect([...SEAM_ALLOWED_ENVIRONMENTS].sort()).toEqual(['ci', 'local', 'test']);
    for (const env of SEAM_ALLOWED_ENVIRONMENTS) {
      expect(() => assertHeaderIdentitySeamAllowed({ APP_ENV: env })).not.toThrow();
    }
  });

  it('treats a missing APP_ENV as local, matching readBuildInfo()', () => {
    expect(() => assertHeaderIdentitySeamAllowed({})).not.toThrow();
  });

  it('names the finding and the seam in the refusal, so the operator knows why', () => {
    expect(() => assertHeaderIdentitySeamAllowed({ APP_ENV: 'production' })).toThrow(
      /RT-001.*x-actor-id|x-actor-id.*RT-001/,
    );
  });
});
