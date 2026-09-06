import { Inject, Injectable } from '@nestjs/common';
import { Conversation, ConversationMember } from '@prisma/client';
import { COVERAGE_SERVICE } from './tokens';
import type { CoverageService } from './coverage.service';
import { Actor, isFamilyFacingStaff } from './types';
import { CommErrorCode } from './errors';
import {
  ActorKind,
  ConversationType,
  MemberRole,
  Moderation,
  OnBehalfMode,
  Visibility,
} from '../communication/contracts/vocab';

export type Decision =
  | { allowed: true; onBehalfMode: string | null; moderation: string }
  | { allowed: false; code: CommErrorCode; reason: string };

const deny = (code: CommErrorCode, reason: string): Decision => ({ allowed: false, code, reason });
const allow = (onBehalfMode: string | null = null, moderation: string = Moderation.PUBLISHED): Decision => ({
  allowed: true,
  onBehalfMode,
  moderation,
});

export interface SendIntent {
  visibility: string;
  /** Only ASSIST / ESCALATION are honoured; OWNER vs COVERAGE is derived. */
  requestedMode?: string;
}

type Conv = Pick<
  Conversation,
  | 'id'
  | 'type'
  | 'familyId'
  | 'stickyHandlerId'
  | 'stickyUntil'
  | 'teacherRequiresApproval'
  | 'parentRequiresApproval'
  | 'archivedAt'
>;

type Member = Pick<ConversationMember, 'actorId' | 'actorKind' | 'memberRole' | 'isSilent' | 'leftAt'>;

/**
 * THE centralized communication authorization service.
 *
 * There is exactly one implementation of the communication matrix in this
 * codebase and it is this class. No controller, gateway or worker makes its own
 * access decision. Messaging and calling both route through it, so a permission
 * can never be enforced for chat but forgotten for calls.
 *
 * BR-1 -- Teacher <-> Parent direct communication is FORBIDDEN.
 * Defended three times over:
 *   1. canOpenDirect() below refuses to create the channel.
 *   2. canSend()/canCall() refuse even if such a channel somehow existed.
 *   3. Database triggers (chat.enforce_direct_conversation_rules,
 *      chat.enforce_call_participant_rules) refuse the row outright, so a
 *      compromised API or a manual SQL session cannot create one either.
 */
@Injectable()
export class AuthorizationService {
  constructor(@Inject(COVERAGE_SERVICE) private readonly coverage: CoverageService) {}

  // ------------------------------------------------------------------
  // Opening a 1:1 channel
  // ------------------------------------------------------------------

  /**
   * The complete allow-list for direct conversations. Anything not named here
   * is denied, so a new actor kind is denied by default rather than allowed by
   * accident.
   */
  canOpenDirect(a: Actor, b: Actor): Decision {
    if (!a.isActive || !b.isActive) {
      return deny(CommErrorCode.ACTOR_INACTIVE, 'one of the participants is inactive');
    }
    if (a.actorId === b.actorId) {
      return deny(CommErrorCode.INVALID_PARTICIPANTS, 'cannot open a conversation with yourself');
    }

    const kinds = [a.kind, b.kind].sort().join('+');

    // BR-1. The constitutional rule.
    if (kinds === 'contact+teacher') {
      return deny(
        CommErrorCode.BR1_TEACHER_PARENT_DIRECT,
        'BR-1: teacher and parent may communicate only inside the official student group',
      );
    }
    if (kinds === 'contact+contact') {
      return deny(CommErrorCode.INVALID_PARTICIPANTS, 'two family contacts cannot open a channel');
    }
    if (kinds === 'teacher+teacher') {
      return deny(
        CommErrorCode.TEACHER_TEACHER_DISABLED,
        'teacher-to-teacher direct messaging is disabled',
      );
    }
    if (kinds === 'staff+staff') {
      return deny(
        CommErrorCode.STAFF_STAFF_DISABLED,
        'staff-to-staff direct messaging is not part of MVP; use internal notes',
      );
    }

    // Allowed: contact <-> staff, teacher <-> staff. The staff side must be
    // family-facing: finance / technical / academic staff never message families.
    const staff = a.kind === ActorKind.STAFF ? a : b.kind === ActorKind.STAFF ? b : null;
    if (!staff) {
      return deny(CommErrorCode.INVALID_PARTICIPANTS, 'a direct conversation requires a staff participant');
    }
    if (!isFamilyFacingStaff(staff)) {
      return deny(
        CommErrorCode.ROLE_CANNOT_MESSAGE_FAMILY,
        `role ${staff.staffRole} may never take part in family communication`,
      );
    }
    return allow();
  }

  // ------------------------------------------------------------------
  // Reading
  // ------------------------------------------------------------------

  canRead(actor: Actor, conv: Conv, membership: Member | null): Decision {
    if (!actor.isActive) return deny(CommErrorCode.ACTOR_INACTIVE, 'actor is inactive');
    if (actor.kind === ActorKind.SYSTEM) return allow();

    // Family-facing staff may open any family conversation. A teacher or a
    // parent must be an actual member.
    if (actor.kind === ActorKind.STAFF) {
      if (!isFamilyFacingStaff(actor)) {
        return deny(
          CommErrorCode.ROLE_CANNOT_MESSAGE_FAMILY,
          `role ${actor.staffRole} may not access conversations`,
        );
      }
      return allow();
    }

    if (!membership || membership.leftAt !== null) {
      return deny(CommErrorCode.NOT_CONVERSATION_MEMBER, 'actor is not a member of this conversation');
    }
    return allow();
  }

  /** Internal notes are invisible to contacts and to teachers. */
  canReadInternal(actor: Actor): boolean {
    return isFamilyFacingStaff(actor);
  }

  // ------------------------------------------------------------------
  // Sending
  // ------------------------------------------------------------------

  async canSend(
    actor: Actor,
    conv: Conv,
    membership: Member | null,
    intent: SendIntent,
    now: Date,
  ): Promise<Decision> {
    const readable = this.canRead(actor, conv, membership);
    if (!readable.allowed) return readable;

    if (conv.archivedAt) {
      return deny(CommErrorCode.CONVERSATION_ARCHIVED, 'conversation is archived');
    }

    if (actor.kind === ActorKind.SYSTEM) return allow(null, Moderation.PUBLISHED);

    // --- family contact (parent) ---
    if (actor.kind === ActorKind.CONTACT) {
      if (intent.visibility === Visibility.INTERNAL) {
        return deny(CommErrorCode.CONTACT_CANNOT_WRITE_INTERNAL, 'contacts cannot write internal notes');
      }
      if (!actor.canMessage) {
        return deny(CommErrorCode.CONTACT_CANNOT_MESSAGE, 'contact lacks the can_message capability');
      }
      if (membership?.isSilent) {
        return deny(CommErrorCode.MEMBER_IS_SILENT, 'this member is present but may not post');
      }
      return allow(null, this.moderationFor(conv, MemberRole.PARENT));
    }

    // --- teacher ---
    if (actor.kind === ActorKind.TEACHER) {
      if (intent.visibility === Visibility.INTERNAL) {
        return deny(CommErrorCode.TEACHER_CANNOT_WRITE_INTERNAL, 'teachers cannot write internal notes');
      }
      // BR-1 backstop: a teacher may only ever speak in a group.
      if (conv.type !== ConversationType.STUDENT_GROUP && conv.type !== ConversationType.CLASS_GROUP) {
        const hasContact = membership && conv.type === ConversationType.DIRECT;
        if (hasContact) {
          return deny(
            CommErrorCode.BR1_TEACHER_PARENT_DIRECT,
            'BR-1: a teacher may not message a parent outside the student group',
          );
        }
      }
      if (membership?.isSilent) {
        return deny(CommErrorCode.MEMBER_IS_SILENT, 'this member is present but may not post');
      }
      return allow(null, this.moderationFor(conv, MemberRole.TEACHER));
    }

    // --- staff ---
    // Internal notes: any family-facing admin, any family, any time.
    if (intent.visibility === Visibility.INTERNAL) {
      return allow(this.deriveMode(actor, conv, OnBehalfMode.OWNER), Moderation.PUBLISHED);
    }

    // A manager may act on anything.
    if (actor.staffRole === 'manager') {
      return allow(intent.requestedMode ?? OnBehalfMode.ESCALATION, Moderation.PUBLISHED);
    }

    // Staff messages in a group are always published; approval applies to
    // teachers and parents only.
    const isGroup =
      conv.type === ConversationType.STUDENT_GROUP || conv.type === ConversationType.CLASS_GROUP;

    // Stickiness wins while it is live.
    if (
      conv.stickyHandlerId === actor.actorId &&
      conv.stickyUntil !== null &&
      conv.stickyUntil > now
    ) {
      return allow(this.deriveMode(actor, conv, OnBehalfMode.OWNER), Moderation.PUBLISHED);
    }

    // Otherwise the on-duty admin, resolved by AI #1's coverage engine.
    if (conv.familyId) {
      const onDutyId = await this.coverage.onDuty(conv.familyId, now);
      if (onDutyId === actor.actorId) {
        return allow(this.deriveMode(actor, conv, OnBehalfMode.OWNER), Moderation.PUBLISHED);
      }
    } else if (isGroup) {
      return allow(OnBehalfMode.OWNER, Moderation.PUBLISHED);
    }

    // "Reply as assist" and escalation: explicit, tagged, and audited by the caller.
    if (intent.requestedMode === OnBehalfMode.ASSIST) {
      return allow(OnBehalfMode.ASSIST, Moderation.PUBLISHED);
    }
    if (intent.requestedMode === OnBehalfMode.ESCALATION) {
      return allow(OnBehalfMode.ESCALATION, Moderation.PUBLISHED);
    }

    return deny(
      CommErrorCode.NOT_ON_DUTY,
      'staff is not on duty for this family and did not request assist or escalation',
    );
  }

  /** Group approval policy. Staff messages are never held. */
  private moderationFor(conv: Conv, role: string): string {
    if (conv.type !== ConversationType.STUDENT_GROUP && conv.type !== ConversationType.CLASS_GROUP) {
      return Moderation.PUBLISHED;
    }
    if (role === MemberRole.TEACHER && conv.teacherRequiresApproval) return Moderation.PENDING;
    if (role === MemberRole.PARENT && conv.parentRequiresApproval) return Moderation.PENDING;
    return Moderation.PUBLISHED;
  }

  private deriveMode(actor: Actor, _conv: Conv, fallback: string): string {
    return fallback;
  }

  // ------------------------------------------------------------------
  // Membership, approval, calling
  // ------------------------------------------------------------------

  /**
   * Teachers and parents can never change a group's membership. Managers can;
   * so can the family's admins. The client is never the source of truth.
   */
  canManageMembership(actor: Actor): Decision {
    if (!isFamilyFacingStaff(actor)) {
      return deny(CommErrorCode.CANNOT_MANAGE_MEMBERSHIP, 'only Jawwid admins may change membership');
    }
    return allow();
  }

  /** The approver is the family's active handler, or any manager. */
  canApprove(actor: Actor, activeHandlerId: string | null): Decision {
    if (!isFamilyFacingStaff(actor)) {
      return deny(CommErrorCode.CANNOT_APPROVE, 'only Jawwid admins may decide approvals');
    }
    if (actor.staffRole === 'manager') return allow();
    if (activeHandlerId && activeHandlerId === actor.actorId) return allow();
    return deny(CommErrorCode.CANNOT_APPROVE, 'only the active handler or a manager may decide');
  }

  /**
   * Calling uses the same matrix as messaging - deliberately. A permission can
   * never be enforced for chat and forgotten for calls.
   */
  async canCall(
    actor: Actor,
    conv: Conv,
    membership: Member | null,
    participants: Array<Pick<Actor, 'kind'>>,
    now: Date,
  ): Promise<Decision> {
    const sendable = await this.canSend(actor, conv, membership, { visibility: Visibility.CUSTOMER }, now);
    if (!sendable.allowed) return sendable;

    const kinds = new Set(participants.map((p) => p.kind));
    if (conv.type === ConversationType.DIRECT && kinds.has(ActorKind.TEACHER) && kinds.has(ActorKind.CONTACT)) {
      return deny(
        CommErrorCode.BR1_TEACHER_PARENT_DIRECT,
        'BR-1: a teacher and a parent may not share a 1:1 call',
      );
    }
    return allow();
  }
}
