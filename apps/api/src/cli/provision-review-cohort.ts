import { readFileSync, statSync } from 'node:fs';
import { cliPrismaClient } from './cli-prisma';
import { describeTarget } from './bootstrap-super-admin';
import { ReviewCohortRefusal, provisionReviewCohort, type ReviewCohortManifest } from './review-cohort';

/**
 * App Store / Google Play review accounts, in their own organization
 * (src/cli/review-cohort.ts; runbook docs/release/review-accounts.md).
 *
 *   DATABASE_URL=postgres://... node dist/cli/provision-review-cohort.js \
 *     --target db.example:5432/jawwid_chat \
 *     --email-domain <domain the owner chose> \
 *     --parent-password-file ~/.jawwid/review-parent.pw \
 *     --teacher-password-file ~/.jawwid/review-teacher.pw \
 *     --deletion-parent-password-file ~/.jawwid/review-parent2.pw \
 *     [--allow-non-local]
 *
 * In production it is run ONLY by the "Review cohort" workflow
 * (.github/workflows/review-cohort.yml), never from a laptop.
 *
 * The rails of seed-org-chat and bootstrap-super-admin: the target must be
 * named and must match DATABASE_URL; outside APP_ENV local/test/ci it refuses
 * unless told otherwise. A PASSWORD IS NEVER ACCEPTED ON THE COMMAND LINE,
 * never printed and never logged: each account's password is read from its own
 * file, readable by its owner only (chmod 600), and stored only as a hash.
 * DATABASE_URL is never printed either, only its host:port/database.
 *
 * Safe to run again: it repairs a deleted or locked-out review account (the
 * disposable deletion-test parent included) and re-sets all three passwords
 * from the files.
 */

const LOCAL_ENVS = new Set(['local', 'test', 'ci', '']);
const NAME = 'provision-review-cohort';

function fail(code: string, message: string): never {
  process.stderr.write(`${NAME}: REFUSED [${code}] ${message}\n`);
  process.exit(2);
}

export function parseArgs(argv: string[]) {
  const args = {
    target: undefined as string | undefined,
    emailDomain: undefined as string | undefined,
    parentPasswordFile: undefined as string | undefined,
    teacherPasswordFile: undefined as string | undefined,
    deletionParentPasswordFile: undefined as string | undefined,
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
      case '--target': args.target = value(); break;
      case '--email-domain': args.emailDomain = value(); break;
      case '--parent-password-file': args.parentPasswordFile = value(); break;
      case '--teacher-password-file': args.teacherPasswordFile = value(); break;
      case '--deletion-parent-password-file': args.deletionParentPasswordFile = value(); break;
      case '--allow-non-local': args.allowNonLocal = true; break;
      default:
        if (/password/i.test(flag) && !flag.endsWith('-file')) {
          fail(
            'USAGE',
            'a password is never accepted on the command line; use --parent-password-file / --teacher-password-file / --deletion-parent-password-file',
          );
        }
        // Never echo an argument: a mistyped command line may hold a password.
        fail('USAGE', `unknown argument at position ${i + 1}`);
    }
  }
  return args;
}

function readPassword(path: string | undefined, who: string): string {
  if (!path) fail('USAGE', `--${who}-password-file is required`);
  // The path is never printed either: a password typed where the path goes
  // would otherwise come back in the error.
  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(path);
  } catch {
    fail('PASSWORD_FILE', `the ${who} password file cannot be read`);
  }
  if (!stat.isFile()) fail('PASSWORD_FILE', `the ${who} password file is not a regular file`);
  if ((stat.mode & 0o077) !== 0) fail('PASSWORD_FILE', `the ${who} password file must be readable by its owner only (chmod 600)`);
  try {
    return readFileSync(path, 'utf8').replace(/\r?\n$/, '');
  } catch {
    fail('PASSWORD_FILE', `the ${who} password file cannot be read`);
  }
}

/** What the command prints: ids and logins, never a credential. */
export function publicSummary(target: string, m: ReviewCohortManifest) {
  return {
    target,
    organizationId: m.organizationId,
    parent: { subject: m.parent.subject, created: m.parent.created },
    teacher: { subject: m.teacher.subject, created: m.teacher.created },
    deletionParent: { subject: m.deletionParent.subject, created: m.deletionParent.created },
    learnerId: m.learnerId,
    familyGroupId: m.familyGroupId,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) fail('USAGE', 'DATABASE_URL is not set');
  // An unparseable URL's error would quote the URL, password and all.
  let target: string;
  try {
    target = describeTarget(databaseUrl);
  } catch {
    fail('USAGE', 'DATABASE_URL is not a valid URL');
  }
  if (!args.target) fail('USAGE', `--target is required; DATABASE_URL points at ${target}`);
  if (args.target !== target) fail('TARGET_MISMATCH', `--target ${args.target} does not match DATABASE_URL (${target})`);
  if (!args.emailDomain) fail('USAGE', '--email-domain is required');
  const appEnv = (process.env.APP_ENV ?? '').trim().toLowerCase();
  if (!LOCAL_ENVS.has(appEnv) && !args.allowNonLocal) {
    fail('ENVIRONMENT', `APP_ENV=${appEnv}; pass --allow-non-local to provision outside a local environment`);
  }
  const parentPassword = readPassword(args.parentPasswordFile, 'parent');
  const teacherPassword = readPassword(args.teacherPasswordFile, 'teacher');
  const deletionParentPassword = readPassword(args.deletionParentPasswordFile, 'deletion-parent');

  const prisma = cliPrismaClient(databaseUrl);
  try {
    const m = await provisionReviewCohort(prisma, {
      emailDomain: args.emailDomain, parentPassword, teacherPassword, deletionParentPassword,
    });
    process.stdout.write(`${JSON.stringify(publicSummary(target, m))}\n`);
  } catch (error) {
    // A refusal's message is ours. Any other error's message is not printed:
    // a database error can quote the statement's arguments, a hash among them.
    const code = error instanceof ReviewCohortRefusal ? error.code : 'ERROR';
    const message =
      error instanceof ReviewCohortRefusal
        ? error.message
        : `${error instanceof Error ? error.name : 'unknown error'}${(error as { code?: unknown })?.code ? ` ${String((error as { code?: unknown }).code)}` : ''}`;
    process.stderr.write(`${NAME}: REFUSED [${code}] ${message}\n`);
    process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) void main();
