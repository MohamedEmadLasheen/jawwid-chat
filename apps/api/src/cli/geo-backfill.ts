import { cliPrismaClient } from './cli-prisma';
import { backfillFamilyLocation } from '../parent-profile/family-location-backfill';

/**
 * `npm run geo:backfill -- --dry-run | --apply` (build first: `npm run build`)
 * -- PD-45 PR-5 (docs/product/pd045-parent-location-plan.md §6.3).
 *
 *   DATABASE_URL=...   the database (a server-side role)
 *   --dry-run          counts what would be written, writes nothing
 *   --apply            writes the exact, unique matches, marked as the backfill's
 *
 * One of the two is required: there is no default. Idempotent; never overwrites
 * a location set by staff or by the parent. The report names families by id
 * only -- never a name, a phone or the old region text. A non-empty
 * `invalidCountry` is the list staff fix by hand before the VALIDATE CONSTRAINT
 * migration. Exit status: 0 = done; 2 = refused, nothing changed.
 */
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const dry = argv.includes('--dry-run');
  const unknown = argv.filter((a) => a !== '--apply' && a !== '--dry-run');
  if (unknown.length > 0 || apply === dry) {
    process.stderr.write(
      unknown.length > 0
        ? `geo-backfill: REFUSED unknown argument(s): ${unknown.join(' ')}\n`
        : 'geo-backfill: REFUSED pass exactly one of --dry-run or --apply\n',
    );
    process.exit(2);
  }
  if (!process.env.DATABASE_URL) {
    process.stderr.write('geo-backfill: REFUSED DATABASE_URL is not set\n');
    process.exit(2);
  }
  const prisma = cliPrismaClient();
  try {
    const report = await backfillFamilyLocation(prisma, { apply });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((e: unknown) => {
  process.stderr.write(`geo-backfill: FAILED ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
