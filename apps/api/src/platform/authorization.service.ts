import { Injectable, Inject } from '@nestjs/common';
import { MessageVisibility, OnBehalfMode, StaffRole, Thread } from '@prisma/client';
import { COVERAGE_SERVICE } from './tokens';
import type { CoverageService } from './coverage.service';
import { Actor, isFamilyFacing } from './types';
import { CommErrorCode } from './errors';

export type AuthzDecision =
  | { allowed: true; onBehalfMode: OnBehalfMode | null }
  | { allowed: false; code: CommErrorCode; reason: string };

const deny = (code: CommErrorCode, reason: string): AuthzDecision => ({
  allowed: false,
  code,
  reason,
});
const allow = (onBehalfMode: OnBehalfMode | null = null): AuthzDecision => ({
  allowed: true,
  onBehalfMode,
});

export interface SendIntent {
  visibility: MessageVisibility;
  /** Only honoured for ASSIST/ESCALATION; OWNER vs COVERAGE is derived, never trusted. */
  requestedMode?: OnBehalfMode;
}

/**
 * THE centralized communication authorization service.
 *
 * There is exactly one implementation of the communication matrix in this
 * codebase and it is this class. No controller, gateway, or worker is permitted
 * to make its own access decision. AI #1 may replace the internals; the contract
 * and the guarantees below must survive any replacement.
 *
 * STRUCTURAL GUARANTEE - no teacher <-> parent channel can exist:
 *   1. There is no user-to-user conversation entity in this system at all. The
 *      only customer-facing thread is Thread(kind=FAMILY), keyed by familyId and
 *      unique per family. A "Teacher <-> Parent 1:1 thread" is not merely denied,
 *      it is unrepresentable in the schema.
 *   2. Every staff write is gated on isFamilyFacing(role), which excludes
 *      ACADEMIC (teaching), TECHNICAL and FINANCE staff entirely - matching the
 *      brief's "Never message families".
 *   3. Every staff read of a family thread is gated the same way.
 */
@Injectable()
export class AuthorizationService {
  constructor(@Inject(COVERAGE_SERVICE) private readonly coverage: CoverageService) {}

  /** May this actor read the thread at all? */
  canReadThread(actor: Actor, thread: Pick<Thread, 'familyId'>): AuthzDecision {
    if (!actor.isActive) return deny(CommErrorCode.ACTOR_INACTIVE, 'actor is inactive');

    if (actor.kind === 'SYSTEM') return allow();

    if (actor.kind === 'CONTACT') {
      if (actor.familyId !== thread.familyId) {
        return deny(CommErrorCode.NOT_THREAD_PARTICIPANT, 'contact belongs to another family');
      }
      return allow();
    }

    if (!isFamilyFacing(actor.staffRole)) {
      return deny(
        CommErrorCode.ROLE_CANNOT_MESSAGE_FAMILY,
        `role ${actor.staffRole} may not access family threads`,
      );
    }
    // Brief section 5: "Any admin may open any family and write internal notes any time."
    return allow();
  }

  /** May this actor see INTERNAL-visibility messages (internal notes)? */
  canReadInternal(actor: Actor): boolean {
    // JC-006: an offboarded/deactivated actor loses access on EVERY path, not
    // only the one that happens to check first. Each public method of this
    // service must be independently safe to call.
    if (!actor.isActive) return false;
    return actor.kind === 'STAFF' && isFamilyFacing(actor.staffRole);
  }

  /**
   * May this actor send into the thread, and under which on_behalf_mode?
   *
   * The mode is DERIVED from on_duty() + ownership, never taken from the client,
   * except for the explicit ASSIST/ESCALATION requests which are additionally
   * gated and audited by the caller.
   */
  async canSendMessage(
    actor: Actor,
    thread: Pick<Thread, 'familyId' | 'stickyHandlerId' | 'stickyUntil'>,
    familyOwnerId: string,
    intent: SendIntent,
    now: Date,
  ): Promise<AuthzDecision> {
    if (!actor.isActive) return deny(CommErrorCode.ACTOR_INACTIVE, 'actor is inactive');

    if (actor.kind === 'SYSTEM') return allow(null);

    if (actor.kind === 'CONTACT') {
      if (actor.familyId !== thread.familyId) {
        return deny(CommErrorCode.NOT_THREAD_PARTICIPANT, 'contact belongs to another family');
      }
      if (intent.visibility === MessageVisibility.INTERNAL) {
        return deny(
          CommErrorCode.CONTACT_CANNOT_WRITE_INTERNAL,
          'contacts cannot write internal notes',
        );
      }
      if (!actor.canMessage) {
        return deny(CommErrorCode.CONTACT_CANNOT_MESSAGE, 'contact lacks can_message capability');
      }
      return allow(null);
    }

    // --- staff ---
    if (!isFamilyFacing(actor.staffRole)) {
      return deny(
        CommErrorCode.ROLE_CANNOT_MESSAGE_FAMILY,
        `role ${actor.staffRole} may never message families`,
      );
    }

    // Internal notes: any family-facing admin, any time, on any family.
    if (intent.visibility === MessageVisibility.INTERNAL) {
      return allow(this.deriveMode(actor, familyOwnerId, OnBehalfMode.OWNER));
    }

    // Customer-facing reply. Manager can act on anything (brief section 2: "Everything").
    if (actor.staffRole === StaffRole.MANAGER) {
      return allow(intent.requestedMode ?? OnBehalfMode.ESCALATION);
    }

    // Stickiness wins over on_duty while it is live (brief section 4).
    if (
      thread.stickyHandlerId === actor.userId &&
      thread.stickyUntil !== null &&
      thread.stickyUntil > now
    ) {
      return allow(this.deriveMode(actor, familyOwnerId, OnBehalfMode.OWNER));
    }

    const onDutyId = await this.coverage.onDuty(thread.familyId, now);
    if (onDutyId === actor.userId) {
      return allow(this.deriveMode(actor, familyOwnerId, OnBehalfMode.OWNER));
    }

    // JC-005 - FAIL CLOSED.
    //
    // ASSIST and ESCALATION are the only paths that let a staff member act on a
    // family they are not on duty for. They must therefore be granted by a
    // SERVER-EVALUATED precondition, never by a field the client controls.
    //
    // The real assist predicate (family in the NOW bucket, waited > 50% of the
    // response target, on-duty admin has not opened it -- or the on-duty admin
    // explicitly requested help) depends on the attention and response-target
    // engines, which AI #1 owns and which have not landed. QA does not invent
    // that predicate here. Until it exists, a client-supplied mode grants
    // nothing.
    //
    // AI #1: replace these two branches with the real check. Do NOT restore an
    // unconditional allow(), and do NOT move the gate into a caller - this
    // service is contractually the only place an access decision is made.
    if (intent.requestedMode === OnBehalfMode.ASSIST) {
      return deny(
        CommErrorCode.ASSIST_NOT_PERMITTED,
        'assist requires a server-evaluated grant; a client-supplied mode never grants access',
      );
    }
    if (intent.requestedMode === OnBehalfMode.ESCALATION) {
      return deny(
        CommErrorCode.ESCALATION_NOT_PERMITTED,
        'escalation requires a server-evaluated grant; a client-supplied mode never grants access',
      );
    }

    return deny(
      CommErrorCode.NOT_ON_DUTY,
      'staff is not on duty for this family and did not request assist/escalation',
    );
  }

  /** OWNER when the actor is the family's permanent owner, COVERAGE otherwise. */
  private deriveMode(actor: Actor, familyOwnerId: string, fallback: OnBehalfMode): OnBehalfMode {
    if (actor.userId === familyOwnerId) return OnBehalfMode.OWNER;
    return fallback === OnBehalfMode.OWNER ? OnBehalfMode.COVERAGE : fallback;
  }
}
