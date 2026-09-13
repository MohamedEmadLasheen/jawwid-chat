/**
 * Whether this deployment can identify a client's network source, and how.
 *
 * THE PROBLEM THIS EXISTS FOR
 * ---------------------------
 * The login rate limiter has a SOURCE dimension whose whole job is to catch
 * password spraying -- one attempt against each of many accounts, which the
 * per-account lockout is blind to by construction. That dimension is only as
 * good as the address it is given.
 *
 * Express `req.ip` is the socket peer unless `trust proxy` is configured.
 * Behind a reverse proxy the socket peer is the PROXY, identically for every
 * client on the internet, so the source budget collapses into one global
 * budget -- and an atomic limiter then enforces that global budget exactly.
 * Roughly thirty failures from one attacker would refuse login to every user of
 * the product. The control becomes the outage.
 *
 * WHY IT IS NOT SIMPLY CONFIGURED
 * -------------------------------
 * Configuring `trust proxy` correctly requires knowing the topology, and this
 * repository does not record one:
 *
 *   - `docs/infrastructure/architecture.md` marks the reverse proxy PLANNED,
 *     and says TLS terminates "at the proxy **or platform edge**" -- two
 *     different shapes with different hop counts;
 *   - `docs/infrastructure/decisions.md` leaves the host an open recommendation
 *     ("Fly.io or Render") and states "The pipeline cannot deploy today";
 *   - nothing specifies a hop count, a trusted address range, or which header
 *     the edge sets.
 *
 * Guessing is worse than abstaining. `trust proxy: true` would let ANY caller
 * forge `X-Forwarded-For` and choose their own source identity: evading the
 * budget entirely, or poisoning another client's to lock that client out. A
 * guessed hop count is wrong on at least one of the two candidate platforms,
 * and a wrong hop count is the same forgery bug with extra steps.
 *
 * THE DECISION
 * ------------
 * One variable, `TRUSTED_PROXY_HOPS`, states the topology explicitly. Until a
 * deployment states it, THE SOURCE DIMENSION IS OFF -- no source budget is
 * charged at all, rather than a wrong one being charged globally.
 *
 *   unset / empty   OFF. `trust proxy` stays false and no source budget is
 *                   used. The identifier (per-account) budget is unaffected and
 *                   remains fully enforced. Anti-spraying is NOT active.
 *   0               ON, and the socket peer IS the client: an explicit
 *                   statement that nothing sits in front of the API.
 *   N >= 1          ON, with N trusted hops. `trust proxy` is set to N, which
 *                   is Express's own semantics: the client is the (N+1)th
 *                   address from the right of X-Forwarded-For, so a client that
 *                   forges extra entries on the left cannot reach that position.
 *
 * There is no fourth state and no inference. A value that is present but not a
 * non-negative integer stops the boot, because "the operator tried to configure
 * this and got it wrong" must not silently become "off".
 *
 * NOTE FOR WHOEVER SETS THIS: N is a property of the deployment, not a guess.
 * It is the number of proxies between the internet and this process that append
 * to X-Forwarded-For. Setting it too high lets a client forge its own address.
 */

export const TRUSTED_PROXY_HOPS = 'TRUSTED_PROXY_HOPS';

/**
 * DI token. ClientAddressPolicy is an interface, so it has no runtime type for
 * Nest to resolve -- a default parameter value does NOT stand in for a provider
 * (Nest resolves every constructor parameter before the default could apply,
 * and fails the whole boot if one is unknown).
 */
export const CLIENT_ADDRESS_POLICY = Symbol('ClientAddressPolicy');

export interface ClientAddressPolicy {
  /**
   * True only when a deployment has explicitly stated its topology. While
   * false, the limiter charges no source budget.
   */
  readonly sourceDimensionEnabled: boolean;
  /**
   * What to pass to Express `app.set('trust proxy', …)`. `false` means the
   * socket peer is used verbatim and no forwarded header is consulted.
   */
  readonly trustProxy: false | number;
}

export class TrustedProxyConfigurationError extends Error {
  constructor(raw: string) {
    super(
      `${TRUSTED_PROXY_HOPS}='${raw}' is not a non-negative integer. It is the number of ` +
        'proxies between the internet and this process that append to X-Forwarded-For: ' +
        '0 means nothing is in front, 1 means one trusted proxy, and so on. Leave it unset ' +
        'to run with the login source-IP budget disabled.',
    );
    this.name = 'TrustedProxyConfigurationError';
  }
}

/** OFF, and explicitly so: the shape a deployment gets when it says nothing. */
export const SOURCE_DIMENSION_DISABLED: ClientAddressPolicy = Object.freeze({
  sourceDimensionEnabled: false,
  trustProxy: false as const,
});

export function readClientAddressPolicy(
  env: NodeJS.ProcessEnv = process.env,
): ClientAddressPolicy {
  const raw = (env[TRUSTED_PROXY_HOPS] ?? '').trim();
  if (raw === '') return SOURCE_DIMENSION_DISABLED;

  if (!/^\d+$/.test(raw)) throw new TrustedProxyConfigurationError(raw);
  const hops = Number(raw);
  if (!Number.isSafeInteger(hops)) throw new TrustedProxyConfigurationError(raw);

  return {
    sourceDimensionEnabled: true,
    // 0 hops means "no proxy": keep trust proxy false so that no forwarded
    // header is read at all, and req.ip stays the unspoofable socket peer.
    trustProxy: hops === 0 ? false : hops,
  };
}

/**
 * The address the SOURCE budget is charged against, or undefined when this
 * deployment cannot identify one.
 *
 * Returning undefined is the safe outcome, not a degraded one: the limiter
 * simply charges no source budget, and the identifier budget still applies.
 */
export function sourceAddress(
  ip: string | undefined,
  policy: ClientAddressPolicy,
): string | undefined {
  if (!policy.sourceDimensionEnabled) return undefined;
  return ip && ip.length > 0 ? ip : undefined;
}
