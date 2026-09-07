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

/**
 * The database role the process is about to run as.
 *
 * Reported by chat.runtime_role_report(). Every field except the name must be
 * false for row-level security to mean anything: an owner, a superuser or a
 * BYPASSRLS role ignores every policy in the schema, silently.
 */
export interface RuntimeRoleReport {
  role_name: string;
  is_superuser: boolean;
  bypasses_rls: boolean;
  owns_schema: boolean;
  can_create_in_schema: boolean;
}

export class RuntimeRoleTooPrivileged extends Error {
  constructor(readonly report: RuntimeRoleReport) {
    const faults = [
      report.is_superuser && 'it is a superuser',
      report.bypasses_rls && 'it bypasses row-level security',
      report.owns_schema && 'it owns the chat schema',
      report.can_create_in_schema && 'it may create objects in the chat schema',
    ].filter(Boolean);
    super(
      `refusing to start: DATABASE_URL connects as '${report.role_name}', and ` +
        `${faults.join(', ')}.\n` +
        'Every row-level security policy in this schema is inert for such a role, ' +
        'so the second authorization layer would be documentation rather than a ' +
        'control -- and nothing would say so at runtime.\n' +
        'Point DATABASE_URL at chat_app (created NOLOGIN by ' +
        'supabase/migrations/20260907120000_chat_phase1_runtime_role.sql; grant it ' +
        'LOGIN and a password from the secret store) and give the worker and the ' +
        'migration runner DATABASE_SERVICE_URL as chat_service.',
    );
    this.name = 'RuntimeRoleTooPrivileged';
  }
}

/** Environments where an over-privileged connection is tolerated. */
export const OWNER_CONNECTION_ALLOWED_ENVIRONMENTS: ReadonlySet<string> = new Set([
  'local',
  'test',
  'ci',
]);

export function isLeastPrivileged(report: RuntimeRoleReport): boolean {
  return (
    !report.is_superuser &&
    !report.bypasses_rls &&
    !report.owns_schema &&
    !report.can_create_in_schema
  );
}

/**
 * Refuses to start on an over-privileged database connection, outside local.
 *
 * This is the automated gate that stops the application being "accidentally
 * configured with an owner connection" -- the failure mode that made RLS inert
 * for the whole of Phase 1 while every document described it as a control. It
 * fails at boot, where it is cheap and obvious, rather than at the first leak.
 *
 * Local development keeps the owner connection deliberately: `prisma db push`,
 * migrations and fixtures need it, and a developer's laptop is not the threat.
 */
export function assertRuntimeRoleAcceptable(
  report: RuntimeRoleReport,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const appEnv = (env.APP_ENV ?? 'local').trim().toLowerCase();
  if (OWNER_CONNECTION_ALLOWED_ENVIRONMENTS.has(appEnv)) return;
  if (!isLeastPrivileged(report)) throw new RuntimeRoleTooPrivileged(report);
}
