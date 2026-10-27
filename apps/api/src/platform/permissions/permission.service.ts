import { Injectable } from '@nestjs/common';
import { ActorKind } from '../../communication/contracts/vocab';
import { PrismaService } from '../prisma.service';
import type { Actor } from '../types';

/** What a staff member holds, as chat.staff_access_profile answers it. */
export interface AccessProfile {
  /** super_admin | manager | supervisor | legacy_department | specialist; null when not live staff. */
  tier: string | null;
  /** The department they run or belong to (PD-8), as stored. */
  departmentKind: string | null;
  placement: 'manager' | 'member' | null;
  permissions: ReadonlySet<string>;
}

export const NO_ACCESS: AccessProfile = Object.freeze({
  tier: null,
  departmentKind: null,
  placement: null,
  permissions: new Set<string>(),
});

/** The tiers whose accounts existed before PD-40: their bundles can be shadowed. */
export const LEGACY_TIERS: ReadonlySet<string> = new Set(['manager', 'supervisor', 'legacy_department']);

/**
 * PD-40: the ONE answer to "what does this staff member hold". It asks
 * chat.staff_access_profile, which is also what the SQL rules ask (H5's
 * "grant only what you hold"), so the API and the database cannot disagree.
 * Read fresh on every call: a role change applies to the next request.
 */
@Injectable()
export class PermissionService {
  constructor(private readonly prisma: PrismaService) {}

  async profileOf(actor: Actor): Promise<AccessProfile> {
    if (actor.kind !== ActorKind.STAFF || !actor.isActive || !actor.organizationId) return NO_ACCESS;
    const rows = await this.prisma.$queryRaw<
      Array<{ tier: string | null; department_kind: string | null; placement: 'manager' | 'member' | null; permissions: string[] | null }>
    >`SELECT tier, department_kind, placement, permissions FROM chat.staff_access_profile(${actor.actorId}::uuid)`;
    const row = rows[0];
    if (!row || row.tier === null) return NO_ACCESS;
    return {
      tier: row.tier,
      departmentKind: row.department_kind,
      placement: row.placement,
      permissions: new Set(row.permissions ?? []),
    };
  }

  async has(actor: Actor, key: string): Promise<boolean> {
    return (await this.profileOf(actor)).permissions.has(key);
  }
}
