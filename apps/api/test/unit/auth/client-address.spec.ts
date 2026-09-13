/**
 * The trusted-proxy decision (PR-B, audit blocker 1).
 *
 * The source dimension of the login rate limiter is OFF unless a deployment
 * states its topology. These pin that default, the three states the variable
 * can express, and the fact that no fourth state can be reached by accident.
 *
 * Why the default is OFF rather than "use req.ip": behind a reverse proxy
 * req.ip is the proxy, identically for every client, so charging a shared
 * budget against it turns the limiter into a product-wide login outage.
 */
import {
  readClientAddressPolicy,
  SOURCE_DIMENSION_DISABLED,
  sourceAddress,
  TRUSTED_PROXY_HOPS,
  TrustedProxyConfigurationError,
} from '@platform/auth/client-address';

describe('the default is OFF', () => {
  it('an unset variable disables the source dimension and trusts no proxy', () => {
    const policy = readClientAddressPolicy({});
    expect(policy.sourceDimensionEnabled).toBe(false);
    expect(policy.trustProxy).toBe(false);
  });

  it('an empty or whitespace value is the same as unset', () => {
    for (const raw of ['', '   ', '\t']) {
      expect(readClientAddressPolicy({ [TRUSTED_PROXY_HOPS]: raw })).toEqual(
        SOURCE_DIMENSION_DISABLED,
      );
    }
  });

  it('while OFF, no address is ever returned — whatever req.ip held', () => {
    // This is the property that stops the proxy's own address becoming a global
    // source budget.
    const off = readClientAddressPolicy({});
    expect(sourceAddress('10.0.0.1', off)).toBeUndefined();
    expect(sourceAddress('203.0.113.9', off)).toBeUndefined();
    expect(sourceAddress(undefined, off)).toBeUndefined();
  });

  it('the disabled policy is frozen, so it cannot be switched on in place', () => {
    expect(Object.isFrozen(SOURCE_DIMENSION_DISABLED)).toBe(true);
  });
});

describe('turning it on is explicit, and says which topology', () => {
  it('0 means nothing is in front: the socket peer IS the client', () => {
    const policy = readClientAddressPolicy({ [TRUSTED_PROXY_HOPS]: '0' });
    expect(policy.sourceDimensionEnabled).toBe(true);
    // Still false: with no proxy there is no forwarded header worth reading,
    // so req.ip stays the unspoofable socket peer.
    expect(policy.trustProxy).toBe(false);
    expect(sourceAddress('203.0.113.9', policy)).toBe('203.0.113.9');
  });

  it('N >= 1 trusts exactly N hops', () => {
    for (const n of [1, 2, 3]) {
      const policy = readClientAddressPolicy({ [TRUSTED_PROXY_HOPS]: String(n) });
      expect(policy.sourceDimensionEnabled).toBe(true);
      expect(policy.trustProxy).toBe(n);
    }
  });

  it('NEVER yields `true` — the value that would trust any forwarded header', () => {
    // `trust proxy: true` is the setting that lets a caller pick its own IP.
    // No input may produce it.
    for (const raw of ['0', '1', '2', '10', '99']) {
      expect(readClientAddressPolicy({ [TRUSTED_PROXY_HOPS]: raw }).trustProxy).not.toBe(true);
    }
  });
});

describe('a misconfiguration stops the boot rather than silently disabling', () => {
  it('refuses anything that is not a non-negative integer', () => {
    for (const raw of ['true', 'yes', 'all', '-1', '1.5', 'one', '1,2', ' 1 2 ', '0x1']) {
      expect(() => readClientAddressPolicy({ [TRUSTED_PROXY_HOPS]: raw })).toThrow(
        TrustedProxyConfigurationError,
      );
    }
  });

  it('the message says what the number means, so the fix is obvious', () => {
    expect(() => readClientAddressPolicy({ [TRUSTED_PROXY_HOPS]: 'true' })).toThrow(
      /number of proxies/i,
    );
  });

  it('"true" in particular is refused — the most tempting wrong answer', () => {
    // An operator who reaches for Express's `trust proxy: true` must be stopped,
    // not quietly given the disabled policy (which would look like it worked).
    expect(() => readClientAddressPolicy({ [TRUSTED_PROXY_HOPS]: 'true' })).toThrow();
  });
});
