import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * PD-8 (2026-10-15): the ONE staff conversation scope.
 *
 * The decision itself is SQL -- chat.staff_conversation_access() in
 * 20261015120000_chat_pd008_org_structure.sql -- and this class only asks it.
 * Keeping the rule in one place is the point: the per-conversation check, the
 * chat list (chat.staff_visible_conversation_ids, which filters through the same
 * function) and the request-role RLS policy on chat.message cannot disagree,
 * because they are the same function.
 *
 * A basis says WHY a staff member may access a conversation; null means they
 * may not. Nothing else grants staff access: not family.owner_id, not
 * on_duty(), not the sticky handler, not a membership row on its own.
 */
export const StaffAccessBasis = {
  /** The organization's super admin: every conversation. */
  SUPER_ADMIN: 'super_admin',
  /** Supervisor of the learner(s) a group is about. */
  RESPONSIBLE: 'responsible',
  /** A live staff member of a direct/ungrouped conversation who still reaches the family. */
  MEMBER: 'member',
  /** Acting for one of the above through an ACTIVE backup link. */
  BACKUP: 'backup',
  /** Department manager of one of the above. */
  MANAGER: 'manager',
  /**
   * PD-35: an open seat whose reason grants access (chat.seat_reason), while it
   * still holds. The WEAKEST basis: anyone with one of the above keeps theirs.
   * A seated person reads and writes as a party but is not in charge: no
   * moderation of others, no membership changes, no approvals.
   */
  SEATED: 'seated',
} as const;
export type StaffAccessBasis = (typeof StaffAccessBasis)[keyof typeof StaffAccessBasis];

/** How one staff member may act for another: chat.staff_acts_for(). */
export type ActsFor = 'self' | 'backup' | 'manager' | null;

/** How a staff member reaches a family: chat.staff_reaches_family(). */
export type FamilyReach = 'self' | 'backup' | 'manager' | 'super_admin' | null;

export interface StaffScope {
  conversationAccess(staffId: string, conversationId: string, at: Date): Promise<StaffAccessBasis | null>;
  visibleConversationIds(staffId: string, at: Date): Promise<string[]>;
  familyReach(staffId: string, familyId: string, at: Date): Promise<FamilyReach>;
  /** Pairs at once, for the member-list advisory. Keyed `${staffId}:${familyId}`. */
  familyReachMany(pairs: ReadonlyArray<{ staffId: string; familyId: string }>, at: Date): Promise<Map<string, FamilyReach>>;
  actsFor(staffId: string, principalId: string, at: Date): Promise<ActsFor>;
  responsibleSupervisor(conversationId: string): Promise<string | null>;
}

const BASES: ReadonlySet<string> = new Set(Object.values(StaffAccessBasis));
const asBasis = (v: string | null | undefined): StaffAccessBasis | null =>
  v && BASES.has(v) ? (v as StaffAccessBasis) : null;
const ACTS: ReadonlySet<string> = new Set(['self', 'backup', 'manager']);
const asActs = (v: string | null | undefined): ActsFor => (v && ACTS.has(v) ? (v as ActsFor) : null);
const REACH: ReadonlySet<string> = new Set(['self', 'backup', 'manager', 'super_admin']);
const asReach = (v: string | null | undefined): FamilyReach => (v && REACH.has(v) ? (v as FamilyReach) : null);

@Injectable()
export class SqlStaffScope implements StaffScope {
  constructor(private readonly prisma: PrismaService) {}

  async conversationAccess(staffId: string, conversationId: string, at: Date): Promise<StaffAccessBasis | null> {
    const rows = await this.prisma.$queryRaw<Array<{ basis: string | null }>>`
      SELECT chat.staff_conversation_access(${staffId}::uuid, ${conversationId}::uuid, ${at}::timestamptz) AS basis`;
    return asBasis(rows[0]?.basis);
  }

  async visibleConversationIds(staffId: string, at: Date): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id::text AS id FROM chat.staff_visible_conversation_ids(${staffId}::uuid, ${at}::timestamptz) AS id`;
    return rows.map((r) => r.id);
  }

  async familyReach(staffId: string, familyId: string, at: Date): Promise<FamilyReach> {
    const rows = await this.prisma.$queryRaw<Array<{ reach: string | null }>>`
      SELECT chat.staff_reaches_family(${staffId}::uuid, ${familyId}::uuid, ${at}::timestamptz) AS reach`;
    return asReach(rows[0]?.reach);
  }

  async familyReachMany(
    pairs: ReadonlyArray<{ staffId: string; familyId: string }>,
    at: Date,
  ): Promise<Map<string, FamilyReach>> {
    const out = new Map<string, FamilyReach>();
    const unique = [...new Map(pairs.map((p) => [`${p.staffId}:${p.familyId}`, p])).values()];
    if (unique.length === 0) return out;
    const rows = await this.prisma.$queryRaw<Array<{ staff_id: string; family_id: string; reach: string | null }>>`
      SELECT p.staff_id::text AS staff_id, p.family_id::text AS family_id,
             chat.staff_reaches_family(p.staff_id, p.family_id, ${at}::timestamptz) AS reach
        FROM unnest(${unique.map((p) => p.staffId)}::uuid[], ${unique.map((p) => p.familyId)}::uuid[])
             AS p(staff_id, family_id)`;
    for (const r of rows) out.set(`${r.staff_id}:${r.family_id}`, asReach(r.reach));
    return out;
  }

  async actsFor(staffId: string, principalId: string, at: Date): Promise<ActsFor> {
    const rows = await this.prisma.$queryRaw<Array<{ acts: string | null }>>`
      SELECT chat.staff_acts_for(${staffId}::uuid, ${principalId}::uuid, ${at}::timestamptz) AS acts`;
    return asActs(rows[0]?.acts);
  }

  async responsibleSupervisor(conversationId: string): Promise<string | null> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string | null }>>`
      SELECT chat.conversation_responsible_supervisor(${conversationId}::uuid)::text AS id`;
    return rows[0]?.id ?? null;
  }
}

/**
 * The default when no scope is wired: nobody is in scope. A construction that
 * forgets the dependency narrows staff access to nothing rather than widening it.
 */
export const NO_STAFF_SCOPE: StaffScope = {
  conversationAccess: async () => null,
  visibleConversationIds: async () => [],
  familyReach: async () => null,
  familyReachMany: async () => new Map(),
  actsFor: async () => null,
  responsibleSupervisor: async () => null,
};
