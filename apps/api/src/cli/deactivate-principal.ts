import { cliPrismaClient } from './cli-prisma';
import { describeTarget } from './bootstrap-super-admin';
import {
  DeactivationRefusal,
  PRINCIPAL_KINDS,
  type DeactivationInput,
  type PrincipalKind,
  deactivatePrincipal,
} from './principal-deactivation';

/**
 * `node dist/cli/deactivate-principal.js` -- RT-032's operator path.
 *
 *   DATABASE_URL=...                          the database (a server-side role)
 *   --kind account|contact|staff|teacher      REQUIRED
 *   --id <uuid>                               REQUIRED
 *   --reason <text>                           REQUIRED; recorded on the revocation
 *   --target <host:port/database>             REQUIRED; must name DATABASE_URL's target
 *   --requested-by <uuid>                     who asked; recorded, informational
 *   --suspend                                 accounts only: 'suspended' instead of 'deactivated'
 *   --timeout-ms <n>                          how long to wait for confirmation (default 30000)
 *
 * Exit status: 0 = COMPLETE (an API node ran the completion barrier after the
 * commit); 75 = saved but NOT YET COMPLETE (no confirmation in time -- re-run
 * the same command; it is idempotent); 2 = refused, nothing changed.
 *
 * A deactivation written any other way (psql, chat.offboard_staff) is journaled
 * and confirmed the same way; this tool is the one that waits for it.
 */

const EXIT_UNCONFIRMED = 75; // EX_TEMPFAIL

function fail(code: string, message: string): never {
  process.stderr.write(`deactivate-principal: REFUSED [${code}] ${message}\n`);
  process.exit(2);
}

interface Args {
  kind?: string;
  id?: string;
  reason?: string;
  target?: string;
  requestedBy?: string;
  suspend: boolean;
  timeoutMs: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { suspend: false, timeoutMs: 30_000 };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = (): string => {
      const v = argv[++i];
      if (v === undefined) fail('USAGE', `${flag} needs a value`);
      return v;
    };
    switch (flag) {
      case '--kind': args.kind = value(); break;
      case '--id': args.id = value(); break;
      case '--reason': args.reason = value(); break;
      case '--target': args.target = value(); break;
      case '--requested-by': args.requestedBy = value(); break;
      case '--suspend': args.suspend = true; break;
      case '--timeout-ms': args.timeoutMs = Number(value()); break;
      default: fail('USAGE', `unknown argument ${flag}`);
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) fail('USAGE', 'DATABASE_URL is not set');
  const target = describeTarget(databaseUrl);
  if (!args.target) fail('USAGE', `--target is required; DATABASE_URL points at ${target}`);
  if (args.target !== target) fail('TARGET_MISMATCH', `--target ${args.target} does not match DATABASE_URL (${target})`);
  if (!args.kind || !PRINCIPAL_KINDS.includes(args.kind as PrincipalKind)) {
    fail('USAGE', `--kind must be one of ${PRINCIPAL_KINDS.join(', ')}`);
  }
  if (!args.id) fail('USAGE', '--id is required');
  if (!args.reason) fail('USAGE', '--reason is required');
  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs < 0) fail('USAGE', '--timeout-ms must be a non-negative number');

  const input: DeactivationInput = {
    kind: args.kind as PrincipalKind,
    principalId: args.id,
    reason: args.reason,
    requestedBy: args.requestedBy ?? null,
    status: args.suspend ? 'suspended' : 'deactivated',
  };
  const prisma = cliPrismaClient(databaseUrl);
  try {
    const result = await deactivatePrincipal(prisma, input, { timeoutMs: args.timeoutMs });
    process.stdout.write(`${JSON.stringify({ target, ...result })}\n`);
    if (!result.confirmed) {
      process.stderr.write(
        'deactivate-principal: SAVED, NOT YET COMPLETE -- no API node confirmed the realtime barrier in time; re-run this command\n',
      );
      process.exitCode = EXIT_UNCONFIRMED;
    }
  } catch (error) {
    const code = error instanceof DeactivationRefusal ? error.code : 'ERROR';
    const message = error instanceof Error ? error.message : 'unknown error';
    process.stderr.write(`deactivate-principal: REFUSED [${code}] ${message}\n`);
    process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) void main();
