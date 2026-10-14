import { readFileSync, statSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { BootstrapRefusal, bootstrapSuperAdmin } from './super-admin-bootstrap';

/**
 * `node dist/cli/bootstrap-super-admin.js` -- establish the super admin.
 *
 *   DATABASE_URL=...                              the database to write (owner role)
 *   --email <address>                             or SUPER_ADMIN_EMAIL
 *   --password-file <path>                        or SUPER_ADMIN_PASSWORD_FILE; else stdin
 *   --target <host:port/database>                 REQUIRED; must name DATABASE_URL's target
 *   --name <display name>                         default "Jawwid Management"
 *   --promote-existing-staff                      allow an existing staff login to be promoted
 *   --reset-password                              replace an existing credential (revokes sessions)
 *   --dry-run                                     report what would happen; write nothing
 *   --allow-non-local                             required when APP_ENV is not local/test/ci
 *
 * THE PASSWORD NEVER APPEARS ON A COMMAND LINE. argv is visible to every user
 * of the machine through `ps`, and lands in shell history. It comes from a file
 * that only its owner can read, or from stdin, and is never printed, logged or
 * echoed back -- not on success, not in an error.
 *
 * `--target` exists because the most dangerous mistake this tool can make is
 * running against the wrong database. Restating the target forces whoever runs
 * it to look at which one DATABASE_URL points to; the URL itself (which may
 * carry a password) is never printed.
 */

const LOCAL_ENVS = new Set(['local', 'test', 'ci', '']);

interface Args {
  email?: string;
  passwordFile?: string;
  target?: string;
  name: string;
  promoteExistingStaff: boolean;
  resetPassword: boolean;
  dryRun: boolean;
  allowNonLocal: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    email: process.env.SUPER_ADMIN_EMAIL,
    passwordFile: process.env.SUPER_ADMIN_PASSWORD_FILE,
    name: 'Jawwid Management',
    promoteExistingStaff: false,
    resetPassword: false,
    dryRun: false,
    allowNonLocal: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = (): string => {
      const v = argv[++i];
      if (v === undefined) fail('USAGE', `${flag} needs a value`);
      return v;
    };
    switch (flag) {
      case '--email': args.email = value(); break;
      case '--password-file': args.passwordFile = value(); break;
      case '--target': args.target = value(); break;
      case '--name': args.name = value(); break;
      case '--promote-existing-staff': args.promoteExistingStaff = true; break;
      case '--reset-password': args.resetPassword = true; break;
      case '--dry-run': args.dryRun = true; break;
      case '--allow-non-local': args.allowNonLocal = true; break;
      case '--password':
        fail('USAGE', 'a password is never accepted on the command line; use --password-file or stdin');
      // eslint-disable-next-line no-fallthrough
      default: fail('USAGE', `unknown argument ${flag}`);
    }
  }
  return args;
}

/** host:port/database of DATABASE_URL -- never its user or password. */
export function describeTarget(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  const port = url.port || '5432';
  return `${url.hostname}:${port}${url.pathname}`.replace(/\?.*$/, '');
}

function readPassword(path: string | undefined): string {
  if (path) {
    const stat = statSync(path);
    if (!stat.isFile()) fail('PASSWORD_FILE', 'the password file is not a regular file');
    // Readable by group or others means someone besides its owner may already
    // hold the super admin's credential. Refuse rather than warn.
    if ((stat.mode & 0o077) !== 0) {
      fail('PASSWORD_FILE', 'the password file must be readable by its owner only (chmod 600)');
    }
    return stripOneNewline(readFileSync(path, 'utf8'));
  }
  if (process.stdin.isTTY) {
    fail('PASSWORD_FILE', 'no --password-file given and stdin is a terminal; pipe the password in');
  }
  return stripOneNewline(readFileSync(0, 'utf8'));
}

function stripOneNewline(raw: string): string {
  return raw.replace(/\r?\n$/, '');
}

function fail(code: string, message: string): never {
  process.stderr.write(`bootstrap-super-admin: REFUSED [${code}] ${message}\n`);
  process.exit(2);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) fail('USAGE', 'DATABASE_URL is not set');
  if (!args.email) fail('USAGE', '--email (or SUPER_ADMIN_EMAIL) is required');

  const target = describeTarget(databaseUrl);
  if (!args.target) fail('USAGE', `--target is required; DATABASE_URL points at ${target}`);
  if (args.target !== target) {
    fail('TARGET_MISMATCH', `--target ${args.target} does not match DATABASE_URL (${target})`);
  }

  const appEnv = (process.env.APP_ENV ?? '').trim().toLowerCase();
  if (!LOCAL_ENVS.has(appEnv) && !args.allowNonLocal) {
    fail('ENVIRONMENT', `APP_ENV=${appEnv}; pass --allow-non-local to bootstrap outside a local environment`);
  }

  const password = readPassword(args.passwordFile);
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    const result = await bootstrapSuperAdmin(prisma, {
      email: args.email,
      password,
      displayName: args.name,
      promoteExistingStaff: args.promoteExistingStaff,
      resetPassword: args.resetPassword,
      dryRun: args.dryRun,
    });
    process.stdout.write(`${JSON.stringify({ target, ...result })}\n`);
  } catch (error) {
    // Anything but a refusal is unexpected. Its message is printed, never the
    // input -- and no input field can surface in a Prisma error here, because
    // the password only ever reaches Prisma as an Argon2id hash.
    const code = error instanceof BootstrapRefusal ? error.code : 'ERROR';
    const message = error instanceof Error ? error.message : 'unknown error';
    process.stderr.write(`bootstrap-super-admin: REFUSED [${code}] ${message}\n`);
    // exitCode, not exit(): the finally block must still close the pool.
    process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) void main();
