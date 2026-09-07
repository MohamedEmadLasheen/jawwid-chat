/**
 * Fail-closed startup checks for authentication.
 *
 * This file replaces src/platform/identity-seam.ts, which existed to stop a
 * build whose identity was the `x-actor-id` header from starting anywhere an
 * untrusted network could reach it (RT-001 / NF-08). That seam is gone: there
 * is no header identity to contain.
 *
 * What remains is the other half of the same idea. Authentication is only worth
 * anything if its signing secrets are real, so the process refuses to start
 * without them rather than minting forgeable tokens and looking healthy. A
 * missing secret is a deployment mistake; discovering it at boot is cheap, and
 * discovering it from a forged token is not.
 *
 * There is deliberately no development fallback secret. A default that works
 * locally is a default that ships.
 */
export const MINIMUM_SECRET_LENGTH = 32;

export const REQUIRED_AUTH_SECRETS = ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const;

export class AuthSecretsMissing extends Error {
  constructor(readonly problems: readonly string[]) {
    super(
      `refusing to start: authentication is not configured.\n  - ${problems.join('\n  - ')}\n` +
        'Set them from the secret store; there is no development default because a ' +
        'default that works locally is a default that ships.',
    );
    this.name = 'AuthSecretsMissing';
  }
}

/** Throws unless every signing secret is present and long enough. */
export function assertAuthSecretsConfigured(env: NodeJS.ProcessEnv = process.env): void {
  const problems: string[] = [];
  for (const name of REQUIRED_AUTH_SECRETS) {
    const value = env[name];
    if (!value) {
      problems.push(`${name} is not set`);
    } else if (value.length < MINIMUM_SECRET_LENGTH) {
      problems.push(`${name} is shorter than ${MINIMUM_SECRET_LENGTH} characters`);
    }
  }
  if (REQUIRED_AUTH_SECRETS.every((n) => env[n]) &&
      env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
    // Distinct keys mean a compromised access-token key does not also let an
    // attacker forge the stored refresh-token hashes.
    problems.push('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different');
  }
  if (problems.length > 0) throw new AuthSecretsMissing(problems);
}
