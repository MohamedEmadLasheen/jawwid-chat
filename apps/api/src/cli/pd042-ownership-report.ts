import { cliPrismaClient } from './cli-prisma';
import { ownershipReport, parseReportArgs } from '../new-students/ownership-report';

/**
 * `node dist/cli/pd042-ownership-report.js` -- PD-42 S3 / D2: before
 * SALES_FAMILY_SCOPE goes to 'own', every family has an Operations supervisor
 * or a Sales owner, with the counts per person the Operations manager and the
 * Sales manager sign off.
 *
 *   DATABASE_URL=...   the database (a server-side role)
 *   (no flag)          the report as JSON
 *   --text             the same, for people
 *
 * Read-only: one READ ONLY transaction; it writes nothing and takes no write
 * flag. Families and staff are named by id only.
 * Exit status: 0 = every family is owned ("ok": true); 1 = some are not (the
 * report lists them); 2 = refused, nothing read.
 */
async function main(): Promise<void> {
  let args: { format: 'json' | 'text' };
  try {
    args = parseReportArgs(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`pd042-ownership-report: REFUSED ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(2);
  }
  if (!process.env.DATABASE_URL) {
    process.stderr.write('pd042-ownership-report: REFUSED DATABASE_URL is not set\n');
    process.exit(2);
  }
  const prisma = cliPrismaClient();
  try {
    const report = await ownershipReport(prisma);
    if (args.format === 'json') {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      const lines = [
        `families: ${report.families}`,
        `  with an Operations supervisor: ${report.withOperationsSupervisor}`,
        `  with a Sales owner only:       ${report.salesOwnedOnly}`,
        `  with neither:                  ${report.unowned.length}`,
        `  partly supervised:             ${report.partlySupervised.length}`,
        'Operations supervisors (families / children):',
        ...report.operationsSupervisors.map((x) => `  ${x.staffId}  ${x.families} / ${x.children}`),
        'Sales owners (families):',
        ...report.salesOwners.map((x) => `  ${x.staffId}  ${x.families}`),
        ...(report.unowned.length > 0 ? ['Families with neither:', ...report.unowned.map((u) => `  ${u.familyId}  (${u.children} children)`)] : []),
        report.ok ? 'OK: every family is owned.' : 'NOT READY: resolve the families with neither before the Sales switch.',
      ];
      process.stdout.write(`${lines.join('\n')}\n`);
    }
    process.exitCode = report.ok ? 0 : 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((e: unknown) => {
  process.stderr.write(`pd042-ownership-report: FAILED ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(2);
});
