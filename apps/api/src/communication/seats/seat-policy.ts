import { Injectable } from '@nestjs/common';
import type { Decision } from '../../platform/authorization.service';
import type { StaffAccessBasis } from '../../platform/staff-scope';
import type { Actor } from '../../platform/types';

/**
 * PD-35: why a seat may be taken. A reason is a row in chat.seat_reason (with
 * its SQL eligibility function, which decides whether a seat still HOLDS) and a
 * SeatPolicy here (which decides whether it may be TAKEN). The two answer
 * different questions on purpose: joining may need facts only the API has (a
 * live mention), staying must be decidable on every access by the database.
 */
export const SeatReason = {
  /** A staff member with a PD-8 basis of their own makes their presence visible. */
  MANUAL: 'manual',
  /** PD-36: summoned by an @mention. Refused until PD-36 registers its policy. */
  MENTION: 'mention',
} as const;

/** The facts a policy decides on; all read by the seat service, never sent by the client. */
export interface SeatTarget {
  id: string;
  organizationId: string;
  type: string;
  familyId: string | null;
  learnerId: string | null;
}

export interface SeatJoinContext {
  /** What the seat comes from (PD-36: the mention id), as the caller named it. */
  sourceId: string | null;
  /** The caller's PD-8 standing here, without any seat (chat.staff_conversation_standing). */
  standing: StaffAccessBasis | null;
  now: Date;
}

export interface SeatPolicy {
  readonly reason: string;
  /** A stand-in another feature is expected to replace (registerPolicy replaces it). */
  readonly placeholder?: boolean;
  /**
   * May `actor` take a seat for this reason in `conv`, now? A refusal for a
   * conversation the caller may not otherwise see must be CONVERSATION_NOT_FOUND,
   * so a join cannot tell anyone which ids exist.
   */
  canJoin(actor: Actor, conv: SeatTarget, ctx: SeatJoinContext): Promise<Decision> | Decision;
  /**
   * The role word shown beside the name in the visible line ("Ola (teacher
   * supervisor) joined"). Clients map known words to their language; null shows
   * the name only.
   */
  roleLabel?(actor: Actor): string | null;
}

/**
 * Every reason's join policy, by reason. A feature registers its own in its
 * module's onModuleInit; a reason with no policy cannot be joined for.
 */
@Injectable()
export class SeatPolicyRegistry {
  private readonly policies = new Map<string, SeatPolicy>();

  register(policy: SeatPolicy): void {
    const existing = this.policies.get(policy.reason);
    if (existing && !existing.placeholder) {
      throw new Error(`a seat policy for '${policy.reason}' is already registered`);
    }
    this.policies.set(policy.reason, policy);
  }

  get(reason: string): SeatPolicy | undefined {
    return this.policies.get(reason);
  }
}
