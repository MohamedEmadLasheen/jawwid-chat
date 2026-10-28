import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import type { SalesFamilyScope } from './pd012-policy';

/**
 * PD-42 S3: which families a Sales member handles.
 *
 * THE SWITCH. SALES_FAMILY_SCOPE is read here only, at boot, and written into
 * chat.config ('sales.family_scope'), because the database decides the scope
 * too (chat.sales_family_scope(), the write guards of the family-scoped money
 * and contact tables). The API's billingAccessOf reads the same row, so the two
 * cannot disagree. Only an explicit value is written: a process booted without
 * the variable leaves the row as it is (no last-boot-wins), and a boot that
 * turns the stored value over says so loudly.
 *
 *   unset          writes nothing: the stored value stands ('all' until written).
 *   all            every Sales member reads every family, as before PD-42.
 *   own            a Sales member reads and writes only the families they own
 *                  (chat.family_sales_owner); the Sales manager keeps every
 *                  family. The owner turns it on only after the intake from
 *                  Jawwid Core is complete and verified (D2).
 *
 * Any other value refuses to boot (fail closed).
 *
 * Whatever the switch says, PD-42's own actions (enter, add a child, carry a
 * package over, edit the contact record) are a Sales member's for the families
 * they own only.
 */
export function salesFamilyScopeFromEnv(): SalesFamilyScope | null {
  const raw = (process.env.SALES_FAMILY_SCOPE ?? '').trim().toLowerCase();
  if (raw === '') return null;
  if (raw === 'own' || raw === 'all') return raw;
  // Fail closed: a typo must never silently widen (or narrow) who reads families.
  throw new Error(`SALES_FAMILY_SCOPE must be 'all' or 'own' (or unset to keep the stored value); got '${process.env.SALES_FAMILY_SCOPE}'`);
}

@Injectable()
export class SalesScopeService implements OnModuleInit {
  private readonly log = new Logger(SalesScopeService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    const stored = await this.scope();
    const wanted = salesFamilyScopeFromEnv();
    if (wanted === null) {
      this.log.log(`sales family scope: ${stored} (stored; SALES_FAMILY_SCOPE unset)`);
      return;
    }
    await this.prisma.$executeRaw`
      INSERT INTO chat.config (key, value, scope, description)
      VALUES ('sales.family_scope', ${JSON.stringify(wanted)}::jsonb, 'sales',
              'PD-42: written at boot from SALES_FAMILY_SCOPE.')
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
    if (wanted !== stored) this.log.warn(`sales family scope CHANGED at boot: ${stored} -> ${wanted} (SALES_FAMILY_SCOPE)`);
    else this.log.log(`sales family scope: ${wanted}`);
  }

  /** The switch, as the database reads it. */
  async scope(): Promise<SalesFamilyScope> {
    const [row] = await this.prisma.$queryRaw<Array<{ scope: string }>>`SELECT chat.sales_family_scope() AS scope`;
    return row?.scope === 'own' ? 'own' : 'all';
  }
}
