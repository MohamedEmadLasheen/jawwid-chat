import { cliPrismaClient } from './cli-prisma';
import { backfillFamilyContactKeys } from '../parent-profile/family-contact-keys';

/**
 * `node dist/cli/family-contact-keys-backfill.js` -- PD-42's operator step
 * before families are entered by hand (review of #202, P1-2).
 *
 *   DATABASE_URL=...      the database (a server-side role)
 *   RESET_CODE_HASH_SECRET  the server key the contact keys are keyed with
 *                         (the same the API uses; required in staging and production)
 *   (no flag)             DRY RUN: counts what would be written, writes nothing
 *   --apply               writes the keys; opens /family-intake when nothing
 *                         was left unresolved
 *   --accept-gaps         with --apply: open it even when some parents could not
 *                         be keyed (collisions, unreadable phones), after the
 *                         operator has looked at the report
 *
 * Idempotent: re-run it any time; it writes only what is missing. The report
 * names families by id only -- never a phone or an e-mail.
 * Exit status: 0 = done (see "ready"); 2 = refused, nothing changed.
 */
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const unknown = argv.filter((a) => a !== '--apply' && a !== '--accept-gaps');
  if (unknown.length > 0) {
    process.stderr.write(`family-contact-keys-backfill: REFUSED unknown argument(s): ${unknown.join(' ')}\n`);
    process.exit(2);
  }
  if (!process.env.DATABASE_URL) {
    process.stderr.write('family-contact-keys-backfill: REFUSED DATABASE_URL is not set\n');
    process.exit(2);
  }
  const prisma = cliPrismaClient();
  try {
    const report = await backfillFamilyContactKeys(prisma, { apply: argv.includes('--apply'), acceptGaps: argv.includes('--accept-gaps') });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((e: unknown) => {
  process.stderr.write(`family-contact-keys-backfill: FAILED ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
