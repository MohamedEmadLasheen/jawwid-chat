import type { PrismaClient } from '@prisma/client';

/**
 * PD-42 S3 / D2: the verification report signed off by the Operations manager
 * and the Sales manager before SALES_FAMILY_SCOPE goes to 'own'. Every family
 * should have an Operations supervisor (each of its children placed,
 * chat.learner_supervision) or a Sales owner (chat.family_sales_owner);
 * otherwise turning the switch on would leave it to nobody in Sales.
 *
 * Read-only (one READ ONLY transaction). It names families and staff by id
 * only -- never a parent's name, a phone or an e-mail (G-07).
 */
export interface FamilyOwnershipRow {
  familyId: string;
  organizationId: string;
  children: number;
  supervised: number;
  supervisorIds: string[];
  salesOwnerId: string | null;
}

export interface OwnershipReport {
  families: number;
  /** Every child placed on an Operations supervisor (a Sales owner or not). */
  withOperationsSupervisor: number;
  /** Not every child placed, but a Sales owner answers for the family. */
  salesOwnedOnly: number;
  /** Neither: what the owner and the managers must resolve before the switch. */
  unowned: Array<{ familyId: string; organizationId: string; children: number }>;
  /** Some children placed and some not (an added child waiting for its supervisor). */
  partlySupervised: Array<{ familyId: string; organizationId: string; children: number; supervised: number }>;
  operationsSupervisors: Array<{ staffId: string; families: number; children: number }>;
  salesOwners: Array<{ staffId: string; families: number }>;
  /** True when nothing is unowned: the report the managers sign off. */
  ok: boolean;
}

/** The summary, from one row per family. Pure. */
export function summariseOwnership(rows: readonly FamilyOwnershipRow[]): OwnershipReport {
  const unowned: OwnershipReport['unowned'] = [];
  const partly: OwnershipReport['partlySupervised'] = [];
  const ops = new Map<string, { families: number; children: number }>();
  const sales = new Map<string, number>();
  let supervisedFamilies = 0;
  let salesOnly = 0;
  for (const r of rows) {
    const fullySupervised = r.children > 0 && r.supervised === r.children;
    if (r.supervised > 0 && r.supervised < r.children) {
      partly.push({ familyId: r.familyId, organizationId: r.organizationId, children: r.children, supervised: r.supervised });
    }
    if (fullySupervised) supervisedFamilies += 1;
    else if (r.salesOwnerId) salesOnly += 1;
    else unowned.push({ familyId: r.familyId, organizationId: r.organizationId, children: r.children });
    for (const id of new Set(r.supervisorIds)) {
      const at = ops.get(id) ?? { families: 0, children: 0 };
      at.families += 1;
      // supervisorIds holds one entry per placed child.
      at.children += r.supervisorIds.filter((x) => x === id).length;
      ops.set(id, at);
    }
    if (r.salesOwnerId) sales.set(r.salesOwnerId, (sales.get(r.salesOwnerId) ?? 0) + 1);
  }
  const byId = <T extends { staffId: string }>(a: T, b: T) => a.staffId.localeCompare(b.staffId);
  return {
    families: rows.length,
    withOperationsSupervisor: supervisedFamilies,
    salesOwnedOnly: salesOnly,
    unowned,
    partlySupervised: partly,
    operationsSupervisors: [...ops].map(([staffId, v]) => ({ staffId, families: v.families, children: v.children })).sort(byId),
    salesOwners: [...sales].map(([staffId, families]) => ({ staffId, families })).sort(byId),
    ok: unowned.length === 0,
  };
}

type Db = Pick<PrismaClient, '$transaction'>;

/** The report, read from the database in one read-only transaction. */
export async function ownershipReport(db: Db): Promise<OwnershipReport> {
  const rows = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    return tx.$queryRaw<Array<{
      family_id: string; organization_id: string; children: number; supervised: number; supervisor_ids: string[]; sales_owner_id: string | null;
    }>>`
      SELECT f.id::text AS family_id, f.organization_id::text AS organization_id,
             count(l.id)::int AS children,
             count(ls.learner_id)::int AS supervised,
             coalesce(array_agg(ls.supervisor_id::text) FILTER (WHERE ls.supervisor_id IS NOT NULL), '{}') AS supervisor_ids,
             o.staff_id::text AS sales_owner_id
        FROM chat.family f
        LEFT JOIN chat.learner l ON l.family_id = f.id
        LEFT JOIN chat.learner_supervision ls ON ls.learner_id = l.id
        LEFT JOIN chat.family_sales_owner o ON o.family_id = f.id
       GROUP BY f.id, f.organization_id, o.staff_id
       ORDER BY f.organization_id, f.created_at, f.id`;
  });
  return summariseOwnership(rows.map((r) => ({
    familyId: r.family_id, organizationId: r.organization_id, children: r.children, supervised: r.supervised,
    supervisorIds: r.supervisor_ids, salesOwnerId: r.sales_owner_id,
  })));
}

/** The CLI's arguments: it only reads, so it takes no write flag. */
export function parseReportArgs(argv: readonly string[]): { format: 'json' | 'text' } {
  const unknown = argv.filter((a) => a !== '--text');
  if (unknown.length > 0) throw new Error(`the ownership report is read-only; unknown argument(s): ${unknown.join(' ')}`);
  return { format: argv.includes('--text') ? 'text' : 'json' };
}
