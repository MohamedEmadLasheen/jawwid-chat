import { Inject, Injectable } from '@nestjs/common';
import { Conversation, ConversationMember } from '@prisma/client';
import { COVERAGE_SERVICE } from './tokens';
import type { CoverageService } from './coverage.service';
import { Actor, isFamilyFacingStaff } from './types';
import { CommErrorCode } from './errors';
import {
  NEVER_A_TEAM_MEMBER,
  NO_PROFILE_ACCESS,
  StaffProfilePermission,
  profilePermissionsFor,
  type StaffProfileAccess,
  type StaffProfileTarget,
} from './staff-profile-policy';
import {
  ActorKind,
  ConversationType,
  FAMILY_FACING_STAFF_ROLES,
  MemberRole,
  Moderation,
  OnBehalfMode,
  StaffRole,
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

/**
 * Why the actor is being authorized for a call.
 *
 * Product decision PD-2 (closed 2026-09-07): a parent may JOIN a Student Group
 * call but may never START one. Starting is reserved for a teacher or
 * authorized staff. The two paths therefore need different verdicts for the
 * same actor, conversation and participant set.
 *
 * The default is INITIATE, the stricter of the two, so a caller that does not
 * state its intent is denied rather than allowed.
 */
export const CallIntent = {
  INITIATE: 'initiate',
  JOIN: 'join',
} as const;
export type CallIntent = (typeof CallIntent)[keyof typeof CallIntent];

type Conv = Pick<
  Conversation,
  | 'id'
  | 'type'
  | 'organizationId'
  | 'familyId'
  | 'stickyHandlerId'
  | 'stickyUntil'
  | 'teacherRequiresApproval'
  | 'parentRequiresApproval'
  | 'archivedAt'
>;

type Member = Pick<ConversationMember, 'actorId' | 'actorKind' | 'memberRole' | 'isSilent' | 'leftAt'>;

/**
 * A live member of a conversation, as it stands AT THE MOMENT OF THE OPERATION.
 *
 * `isActive` is what makes this different from the membership row: a member row
 * survives an account being deactivated, so "an admin is a member" and "an admin
 * is present" are not the same statement. Product decision C-4 requires the
 * second one, evaluated when the message is posted or the call is authorized.
 */
export interface LiveMember {
  actorId: string;
  actorKind: string;
  memberRole: string;
  /** Resolved identity state. Undefined means "not resolved"; only an explicit
   *  false excludes the member from satisfying admin presence. */
  isActive?: boolean;
}

/**
 * THE centralized communication authorization service.
 *
 * There is exactly one implementation of the communication matrix in this
 * codebase and it is this class. No controller, gateway or worker makes its own
 * access decision. Messaging and calling both route through it, so a permission
 * can never be enforced for chat but forgotten for calls.
 *
 * BR-1 (restored by PD-7, 2026-10-14, superseding PD-6) -- a teacher and a
 * parent NEVER share a direct 1:1 channel, message or call, whatever their
 * relationship. They communicate only inside the official Student Group, where
 * a live Jawwid admin is present (C-4). Defended three times over:
 *   1. canOpenDirect() below refuses to create the channel.
 *   2. canSend()/canCall() refuse it even if it exists -- a direct
 *      teacher<->parent conversation created under PD-6 stays readable as
 *      history and accepts nothing new.
 *   3. Database triggers (chat.enforce_direct_conversation_rules,
 *      chat.enforce_call_participant_rules, chat.enforce_br1_direct_message)
 *      refuse the row outright, so a compromised API or a manual SQL session
 *      cannot create one either.
 *
 * PD-6 made this decision depend on a resolved relationship. PD-7 removed that
 * input: the refusal is decided from the participant KINDS alone, so no
 * relationship lookup, stale or forged, can open the channel again.
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
  canOpenDirect(
    a: Actor,
    b: Actor,
  ): Decision {
    // Tenant first (RT-030). A direct conversation is filed under its two
    // participants' organization, so they must share one -- and an actor in
    // another organization is answered exactly as an unknown one, before any
    // other property of theirs (activity, role) can be read off the refusal.
    // SYSTEM has no organization and therefore never opens a direct channel.
    if (!a.organizationId || a.organizationId !== b.organizationId) {
      return deny(CommErrorCode.UNKNOWN_ACTOR, 'unknown actor');
    }
    if (!a.isActive || !b.isActive) {
      return deny(CommErrorCode.ACTOR_INACTIVE, 'one of the participants is inactive');
    }
    if (a.actorId === b.actorId) {
      return deny(CommErrorCode.INVALID_PARTICIPANTS, 'cannot open a conversation with yourself');
    }

    const kinds = [a.kind, b.kind].sort().join('+');

    // BR-1, restored by PD-7. Never a direct teacher<->parent channel; the
    // Student Group is the only place they speak.
    if (kinds === 'contact+teacher') {
      return deny(
        CommErrorCode.BR1_TEACHER_PARENT_DIRECT,
        'BR-1: a teacher and a parent communicate only inside the Student Group, never directly',
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

  /**
   * May this actor read the conversation?
   *
   * A teacher or a parent must be a live member.
   *
   * STAFF SCOPE (2026-10-14). Family-facing staff used to read every
   * conversation in the database. They now read only what the academy's own
   * records put in their charge -- no new table, only facts that already
   * exist:
   *
   *   manager           every conversation of their organization;
   *   admin / coverage  conversations they are a live member of, plus those of
   *                     families they own (family.owner_id), are on duty for
   *                     (chat.on_duty) or are the live sticky handler of.
   *
   * The second line arrives as `staffInScope`, a RESOLVED FACT computed by the
   * caller (ConversationService.staffInScope / this.staffInScope) -- the same
   * shape as every other fact this class decides on. It defaults to FALSE, so a
   * call site that forgets to resolve it narrows, never widens.
   *
   * Another organization's conversation reads as not found, for every staff
   * role, before anything else about it is revealed.
   */
  canRead(actor: Actor, conv: Conv, membership: Member | null, staffInScope = false): Decision {
    if (!actor.isActive) return deny(CommErrorCode.ACTOR_INACTIVE, 'actor is inactive');
    if (actor.kind === ActorKind.SYSTEM) return allow();

    const isLiveMember = !!membership && membership.leftAt === null;

    if (actor.kind === ActorKind.STAFF) {
      if (!isFamilyFacingStaff(actor)) {
        return deny(
          CommErrorCode.ROLE_CANNOT_MESSAGE_FAMILY,
          `role ${actor.staffRole} may not access conversations`,
        );
      }
      if (!actor.organizationId || conv.organizationId !== actor.organizationId) {
        return deny(CommErrorCode.CONVERSATION_NOT_FOUND, 'conversation not found');
      }
      if (actor.staffRole === 'manager' || isLiveMember || staffInScope) return allow();
      return deny(
        CommErrorCode.STAFF_OUT_OF_SCOPE,
        'this conversation belongs to a family outside your charge',
      );
    }

    if (!isLiveMember) {
      return deny(CommErrorCode.NOT_CONVERSATION_MEMBER, 'actor is not a member of this conversation');
    }
    return allow();
  }

  /**
   * The staff-scope fact for canRead, resolved from server-owned data.
   *
   * True when the staff actor is the family's owner, is on duty for it now, or
   * is the conversation's live sticky handler (the one who just answered keeps
   * it for the grace window -- canSend honours the same stickiness below).
   * Membership and the manager role are decided by canRead itself.
   */
  async staffInScope(
    actor: Actor,
    conv: Pick<Conv, 'familyId' | 'stickyHandlerId' | 'stickyUntil'>,
    familyOwnerId: string | null,
    now: Date,
  ): Promise<boolean> {
    if (actor.kind !== ActorKind.STAFF || !actor.isActive) return false;
    if (conv.stickyHandlerId === actor.actorId && conv.stickyUntil !== null && conv.stickyUntil > now) {
      return true;
    }
    if (!conv.familyId) return false;
    if (familyOwnerId !== null && familyOwnerId === actor.actorId) return true;
    return (await this.coverage.onDuty(conv.familyId, now)) === actor.actorId;
  }

  /** Internal notes are invisible to contacts and to teachers. */
  canReadInternal(actor: Actor): boolean {
    // JC-006 (re-applied, see JC-011): a deactivated or offboarded actor loses
    // access on EVERY path, not only the one that happens to check first. Each
    // public method of this service must be independently safe to call.
    if (!actor.isActive) return false;
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
    /** chat.family.owner_id. Supplied by the caller; owner/coverage is derived
     *  from it and from on_duty(), never taken from the request. */
    familyOwnerId: string | null = null,
    /** actor_kind of every live member. Supplied by the caller for the BR-1
     *  participant-set check; the database trigger is the final backstop. */
    participantKinds: string[] = [],
    /** Live membership with roles and resolved activity, for the C-4
     *  admin-presence check. When empty the check cannot run and says so. */
    liveMembers: LiveMember[] = [],
  ): Promise<Decision> {
    const readable = this.canRead(
      actor,
      conv,
      membership,
      await this.staffInScope(actor, conv, familyOwnerId, now),
    );
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
      // BR-1 (PD-7). The parent's side of a direct teacher<->parent channel. A
      // conversation created under PD-6 still exists, so this is checked on
      // every send and not only at creation.
      const direct = this.refuseDirectTeacherParent(actor, conv, participantKinds);
      if (direct) return direct;
      const presence = this.requireAdminPresence(conv, liveMembers, participantKinds);
      if (presence) return presence;
      return allow(null, this.moderationFor(conv, MemberRole.PARENT));
    }

    // --- teacher ---
    if (actor.kind === ActorKind.TEACHER) {
      if (intent.visibility === Visibility.INTERNAL) {
        return deny(CommErrorCode.TEACHER_CANNOT_WRITE_INTERNAL, 'teachers cannot write internal notes');
      }
      // BR-1 (PD-7). A teacher may speak in a group and in a 1:1 whose other
      // side is Jawwid staff -- never in a 1:1 with a parent. The check is on
      // the participant set, not on the conversation type: Teacher <-> Admin is
      // a permitted 1:1 and must not be caught here.
      const direct = this.refuseDirectTeacherParent(actor, conv, participantKinds);
      if (direct) return direct;
      if (membership?.isSilent) {
        return deny(CommErrorCode.MEMBER_IS_SILENT, 'this member is present but may not post');
      }
      const presence = this.requireAdminPresence(conv, liveMembers, participantKinds);
      if (presence) return presence;
      return allow(null, this.moderationFor(conv, MemberRole.TEACHER));
    }

    // --- staff ---
    // Internal notes: any family-facing admin, any family, any time. The
    // capacity is still derived from facts, never asserted by the client.
    if (intent.visibility === Visibility.INTERNAL) {
      const mode = await this.deriveMode(actor, conv, familyOwnerId, now);
      return allow(mode, Moderation.PUBLISHED);
    }

    // A manager may act on anything, but may not choose their own attribution:
    // only assist/escalation are honourable requests, everything else is derived.
    if (actor.staffRole === 'manager') {
      const mode = await this.deriveMode(actor, conv, familyOwnerId, now, intent.requestedMode);
      return allow(mode, Moderation.PUBLISHED);
    }

    // Staff messages in a group are always published; approval applies to
    // teachers and parents only.
    const isGroup =
      conv.type === ConversationType.STUDENT_GROUP || conv.type === ConversationType.CLASS_GROUP;

    // DEF-001. A DIRECT staff conversation that is not family-scoped: the
    // Teacher <-> Admin channel (decision C-2, "never family-scoped").
    //
    // Nothing below can reach it. `onDuty()` takes a familyId and there is no
    // family, so the coverage branch is skipped; it is not a group, so the group
    // branch is skipped; control fell through to NOT_ON_DUTY and an ordinary
    // `admin` could never answer a teacher, while a manager and an internal note
    // both could.
    //
    // MEMBERSHIP IS THE AUTHORITY HERE, and it has to be stated explicitly:
    // `canRead` above does NOT establish it: a manager may read any conversation
    // of the organization, and an admin may read one through the staff-scope
    // fact, without being a member. Without this check such a non-member could
    // SEND into a non-family staff channel.
    //
    // WHY THIS IS NOT JC-005 AGAIN. That defect was ASSIST/ESCALATION granted
    // from `intent.requestedMode` -- a field the client controls. This branch
    // reads nothing the caller sent: `membership` is the server's own
    // chat.conversation_member row, resolved before canSend is entered, and a
    // null or departed membership falls straight through to the same deny as
    // before. It also cannot widen anything family-scoped: `conv.familyId ===
    // null` excludes every family conversation, which is where on-duty and
    // coverage live.
    //
    // WHY IT SITS ABOVE STICKINESS. `MessageService.send` makes the replying
    // staff member sticky for `handoff.grace_minutes`, so from the SECOND reply
    // onwards the sticky branch below would match first and attribute the message
    // through `deriveMode`, which -- with no family owner and no coverage to find
    // -- falls through to ASSIST. That would be false (the admin is the
    // counterpart here, not a stand-in) and `MessageService` writes a
    // `message.assist` audit row for it, so every ordinary reply after the first
    // would forge an assist event. Deciding this shape first keeps one honest
    // attribution for every reply. Authorization is identical either way: both
    // paths allow, so the order changes only the recorded capacity.
    //
    // IT DECIDES THE SHAPE OUTRIGHT, allow or deny, and does not fall through.
    // That is deliberate. `MessageService.send` makes a replying staff member
    // sticky, so once an admin has answered once, a LATER request from that same
    // admin after they were removed from the conversation would reach the sticky
    // branch below and be allowed on nothing but a stale `sticky_handler_id`.
    // Falling through would therefore hand a departed member a grace window
    // measured in `handoff.grace_minutes`. Before this fix that window was
    // unreachable only because no admin could ever become sticky here; making the
    // journey work is what made it reachable, so it is closed in the same change.
    // A non-member gets the same refusal they got before, by name.
    if (conv.type === ConversationType.DIRECT && conv.familyId === null) {
      if (membership !== null && membership.leftAt === null) {
        return allow(OnBehalfMode.OWNER, Moderation.PUBLISHED);
      }
      return deny(
        CommErrorCode.NOT_CONVERSATION_MEMBER,
        'a direct staff conversation is answerable only by its members',
      );
    }

    // Stickiness wins while it is live.
    if (
      conv.stickyHandlerId === actor.actorId &&
      conv.stickyUntil !== null &&
      conv.stickyUntil > now
    ) {
      return allow(await this.deriveMode(actor, conv, familyOwnerId, now), Moderation.PUBLISHED);
    }

    // Otherwise the on-duty admin, resolved by AI #1's coverage engine.
    if (conv.familyId) {
      const onDutyId = await this.coverage.onDuty(conv.familyId, now);
      if (onDutyId === actor.actorId) {
        return allow(await this.deriveMode(actor, conv, familyOwnerId, now), Moderation.PUBLISHED);
      }
    } else if (isGroup) {
      return allow(OnBehalfMode.OWNER, Moderation.PUBLISHED);
    }

    // JC-005 - FAIL CLOSED. (Re-applied after the conversation-model rewrite
    // reverted it; see defects.md JC-011.)
    //
    // ASSIST and ESCALATION are the only paths that let a staff member act on a
    // family they are not on duty for. They must be granted by a
    // SERVER-EVALUATED precondition, never by a field the client controls.
    //
    // The real assist predicate (family in the NOW bucket, waited > 50% of the
    // response target, on-duty admin has not opened it -- or the on-duty admin
    // explicitly requested help) depends on the attention and response-target
    // engines that AI #1 owns. QA does not invent that predicate here.
    //
    // AI #1: replace these branches with the real check. Do NOT restore an
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
      'staff is not on duty for this family and did not request assist or escalation',
    );
  }

  /**
   * BR-1, restored by PD-7 (2026-10-14). A DIRECT conversation that pairs a
   * teacher with a family contact accepts nothing -- no message, no call.
   *
   * Evaluated on the participant SET, never on the conversation type alone:
   * Teacher <-> Admin and Parent <-> Admin are direct conversations too and
   * must not be caught here.
   *
   * One method called from three places -- the contact branch of canSend, the
   * teacher branch of canSend, and canCall -- so messaging and calling cannot
   * disagree about who may speak to whom. Both sides are checked: a channel
   * opened under PD-6 must be closed for the parent exactly as for the teacher.
   *
   * Returns a denial, or null when the rule does not apply.
   */
  private refuseDirectTeacherParent(
    actor: Actor,
    conv: Conv,
    participantKinds: string[],
  ): Decision | null {
    if (conv.type !== ConversationType.DIRECT) return null;

    // The actor's own kind is included: a caller that supplies an incomplete
    // member list must not thereby escape the check.
    const kinds = new Set([...participantKinds, actor.kind]);
    if (!kinds.has(ActorKind.TEACHER) || !kinds.has(ActorKind.CONTACT)) return null;

    return deny(
      CommErrorCode.BR1_TEACHER_PARENT_DIRECT,
      'BR-1: a teacher and a parent communicate only inside the Student Group, never directly',
    );
  }

  /**
   * BR-1 required admin presence, evaluated at operation time (product decision
   * C-4, 2026-09-06).
   *
   * PRD BR-1: "Teachers and parents communicate only inside the official
   * Student Group, WHERE THE ASSIGNED ADMIN/SUPERVISOR IS A MEMBER." A group
   * that pairs a teacher with a family contact and has no live Jawwid admin in
   * it is a private teacher<->parent channel wearing a group's name, so the
   * prohibited interaction is refused -- for the teacher and the parent. Staff
   * are not the prohibited interaction and are deliberately still allowed, so
   * an admin can always rejoin and repair the group.
   *
   * The database backstop (chat.assert_conversation_br1) constrains the
   * COMMITTED membership state. This is the other half: a membership row
   * survives deactivation, so an offboarded admin still satisfies the row-level
   * rule while satisfying nothing operationally. Both checks are required, and
   * neither replaces the other.
   *
   * Returns a denial, or null when the rule does not apply.
   */
  private requireAdminPresence(
    conv: Conv,
    liveMembers: LiveMember[],
    participantKinds: string[],
  ): Decision | null {
    const isGroup =
      conv.type === ConversationType.STUDENT_GROUP || conv.type === ConversationType.CLASS_GROUP;
    if (!isGroup) return null;

    const kinds = liveMembers.length > 0 ? liveMembers.map((m) => m.actorKind) : participantKinds;
    const pairsTeacherAndParent =
      kinds.includes(ActorKind.TEACHER) && kinds.includes(ActorKind.CONTACT);
    if (!pairsTeacherAndParent) return null;

    if (liveMembers.length === 0) {
      // Fail closed. A caller that cannot say who is present cannot be told the
      // interaction is safe.
      return deny(
        CommErrorCode.BR1_ADMIN_PRESENCE_REQUIRED,
        'BR-1: admin presence could not be established for this group',
      );
    }

    const adminPresent = liveMembers.some(
      (m) =>
        m.actorKind === ActorKind.STAFF &&
        m.memberRole === MemberRole.ADMIN &&
        m.isActive !== false,
    );
    if (!adminPresent) {
      return deny(
        CommErrorCode.BR1_ADMIN_PRESENCE_REQUIRED,
        'BR-1: a teacher and a parent may communicate only with a live Jawwid admin present',
      );
    }
    return null;
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

  /**
   * on_behalf_mode is DERIVED, never accepted from the client.
   *
   *   owner      the actor is the family's permanent Primary Owner
   *   coverage   the actor is on duty for this family but does not own it
   *   assist     neither, and acting anyway (always audited by the caller)
   *   escalation only when explicitly requested as such
   *
   * A caller asking for "owner" gets whatever the facts say, which is why a
   * manager cannot stamp a message as the family's owner.
   */
  private async deriveMode(
    actor: Actor,
    conv: Conv,
    familyOwnerId: string | null,
    now: Date,
    requested?: string,
  ): Promise<string> {
    if (requested === OnBehalfMode.ESCALATION) return OnBehalfMode.ESCALATION;
    if (familyOwnerId && actor.actorId === familyOwnerId) return OnBehalfMode.OWNER;
    if (conv.familyId) {
      const onDutyId = await this.coverage.onDuty(conv.familyId, now);
      if (onDutyId === actor.actorId) return OnBehalfMode.COVERAGE;
    }
    if (requested === OnBehalfMode.ASSIST) return OnBehalfMode.ASSIST;
    return OnBehalfMode.ASSIST;
  }

  // ------------------------------------------------------------------
  // Membership, approval, calling
  // ------------------------------------------------------------------

  /**
   * Teachers and parents can never change a group's membership. Managers can;
   * so can the family's admins. The client is never the source of truth.
   *
   * This is the gate, asked before the conversation is loaded. Which
   * conversation, and which member, are `canManageMembershipIn` and
   * `canAddMember` -- passing the gate grants neither.
   */
  canManageMembership(actor: Actor): Decision {
    if (!actor.isActive) return deny(CommErrorCode.ACTOR_INACTIVE, 'actor is inactive');
    if (!isFamilyFacingStaff(actor)) {
      return deny(CommErrorCode.CANNOT_MANAGE_MEMBERSHIP, 'only Jawwid admins may change membership');
    }
    if (!actor.organizationId) {
      return deny(CommErrorCode.CANNOT_MANAGE_MEMBERSHIP, 'an actor with no organization cannot change membership');
    }
    return allow();
  }

  /**
   * May this actor change the membership of THIS conversation?
   *
   * Scope (docs/contracts/API-CONTRACT.md `POST /conversations/:id/members`,
   * `conversations.manage` + the conversation's family in scope;
   * AUTHORIZATION-MODEL.md section 6): a manager for any conversation in their
   * organization; an admin or coverage admin for a conversation of a family
   * they own; a conversation with no family only through live admin membership
   * of it. Being on duty is not scope (PD-3).
   *
   * A `direct` conversation's membership is never changed by anyone: its
   * identity IS its two members (`direct_key`), so removing one and adding
   * another would not edit a conversation, it would hijack one.
   *
   * Another organization's conversation reads as NOT FOUND.
   */
  canManageMembershipIn(
    actor: Actor,
    conv: {
      type: string;
      organizationId: string;
      familyId: string | null;
      familyOwnerId: string | null;
      /** The actor's own live member_role in this conversation, or null. */
      actorMemberRole: string | null;
    },
  ): Decision {
    const gate = this.canManageMembership(actor);
    if (!gate.allowed) return gate;
    if (conv.organizationId !== actor.organizationId) {
      return deny(CommErrorCode.CONVERSATION_NOT_FOUND, 'conversation not found');
    }
    if (conv.type === ConversationType.DIRECT) {
      return deny(
        CommErrorCode.CANNOT_MANAGE_MEMBERSHIP,
        'a direct conversation is defined by its two members; its membership never changes',
      );
    }
    if (actor.staffRole === 'manager') return allow();
    if (conv.familyId !== null) {
      if (conv.familyOwnerId === actor.actorId) return allow();
      return deny(
        CommErrorCode.CANNOT_MANAGE_MEMBERSHIP,
        "only the family's supervisor or a manager may change this conversation's membership",
      );
    }
    if (conv.actorMemberRole === MemberRole.ADMIN) return allow();
    return deny(
      CommErrorCode.CANNOT_MANAGE_MEMBERSHIP,
      'only an admin of this conversation or a manager may change its membership',
    );
  }

  /**
   * May this candidate be ADDED to this conversation in this role?
   *
   * Every fact is read from the candidate's own row by the caller; nothing the
   * client sent is trusted beyond which row to look up and which role is asked
   * for. An unknown candidate and one in another organization get the same
   * answer, so this cannot be used to probe for ids across a tenant boundary.
   *
   * The roles each kind may hold mirror how membership is built
   * (`ensureStudentGroup` / `syncStudentGroup`): a contact is a parent, a
   * teacher is a teacher, staff are admin or observer. A contact belongs only
   * in their own family's conversations; a teacher only in the Student Group of
   * a learner they teach (PD-1: membership "exactly as built"). Class groups and
   * official conversations have no product rules for contacts or teachers yet
   * (Phase 2), so those adds are refused rather than guessed.
   */
  canAddMember(
    conv: {
      type: string;
      organizationId: string;
      familyId: string | null;
      learnerTeacherId: string | null;
    },
    requestedRole: string,
    candidate:
      | { kind: 'contact'; organizationId: string; isActive: boolean; familyId: string; canMessage: boolean }
      | { kind: 'teacher'; actorId: string; organizationId: string; isActive: boolean; leftAt: Date | null }
      | { kind: 'staff'; organizationId: string; isActive: boolean; leftAt: Date | null; staffRole: string }
      | null,
  ): Decision {
    const ineligible = (reason: string) => deny(CommErrorCode.INVALID_PARTICIPANTS, reason);
    if (!candidate || candidate.organizationId !== conv.organizationId) {
      return ineligible('no such member can join this conversation');
    }
    switch (candidate.kind) {
      case 'contact':
        if (requestedRole !== MemberRole.PARENT) return ineligible('a family contact joins as parent');
        if (!candidate.isActive || !candidate.canMessage) return ineligible('this contact may not communicate');
        if (conv.familyId === null || candidate.familyId !== conv.familyId) {
          return ineligible("a contact joins only their own family's conversations");
        }
        return allow();
      case 'teacher':
        if (requestedRole !== MemberRole.TEACHER) return ineligible('a teacher joins as teacher');
        if (!candidate.isActive || candidate.leftAt !== null) return ineligible('this teacher is not active');
        if (conv.type !== ConversationType.STUDENT_GROUP || conv.learnerTeacherId !== candidate.actorId) {
          return ineligible("a teacher joins only the Student Group of a learner they teach");
        }
        return allow();
      case 'staff':
        if (requestedRole !== MemberRole.ADMIN && requestedRole !== MemberRole.OBSERVER) {
          return ineligible('staff join as admin or observer');
        }
        if (!candidate.isActive || candidate.leftAt !== null) return ineligible('this staff member is not active');
        if (!FAMILY_FACING_STAFF_ROLES.has(candidate.staffRole)) {
          return ineligible('this staff role does not take part in family communication');
        }
        return allow();
    }
  }

  /**
   * May this actor write into a record of this organization? (RT-030)
   *
   * Every write that is attributed to a conversation's organization must first
   * establish that the actor belongs to it; otherwise correcting the attribution
   * would turn a write the database used to refuse (default tenant vs the
   * conversation's) into one it accepts. SYSTEM belongs to no organization and
   * acts for all of them; nothing reachable over HTTP is SYSTEM.
   */
  canActInOrganization(actor: Actor, organizationId: string): Decision {
    if (actor.kind === ActorKind.SYSTEM) return allow();
    if (!actor.organizationId || actor.organizationId !== organizationId) {
      return deny(CommErrorCode.CONVERSATION_NOT_FOUND, 'conversation not found');
    }
    return allow();
  }

  /**
   * May this actor provision (create or re-sync) a Student Group at all?
   *
   * Asked BEFORE the learner is looked up, so a refused caller learns nothing
   * about whether the learner id exists: a real id and a random one get the
   * same answer. A Student Group is provisioning, not communication -- its
   * membership is derived from the academy's own relationships -- so a parent
   * or a teacher is its subject and never its author.
   *
   * SYSTEM is allowed because Core ingestion and the fixtures that stand in for
   * it provision with no person behind the call. HTTP cannot reach that branch:
   * every route resolves its actor from a verified bearer token.
   */
  canProvisionStudentGroup(actor: Actor): Decision {
    if (!actor.isActive) return deny(CommErrorCode.ACTOR_INACTIVE, 'actor is inactive');
    if (actor.kind === ActorKind.SYSTEM) return allow();
    if (!isFamilyFacingStaff(actor)) {
      return deny(
        CommErrorCode.CANNOT_PROVISION_STUDENT_GROUP,
        'a Student Group is provisioned by Jawwid staff, never by a family member or a teacher',
      );
    }
    // A staff actor with no tenant cannot be scoped. Every real actor carries
    // one, so this refuses a state the identity layer does not produce -- but
    // the alternative is a comparison that silently passes on undefined.
    if (!actor.organizationId) {
      return deny(
        CommErrorCode.CANNOT_PROVISION_STUDENT_GROUP,
        'an actor with no organization cannot provision a Student Group',
      );
    }
    return allow();
  }

  /**
   * May this actor provision the Student Group of THIS learner?
   *
   * Asked after `canProvisionStudentGroup` has passed and the learner is loaded.
   * The facts are resolved by the caller; this method reads no database.
   *
   * Tenant: a learner in another organization is reported as NOT FOUND, not as
   * forbidden, so a tenant boundary never confirms that an id exists. Both the
   * learner's and the family's organization must match: the database does not
   * yet tie them together (RT-029), so neither is trusted alone.
   *
   * Scope (docs/contracts/API-CONTRACT.md, `conversations.manage` + family
   * scope; docs/architecture/SUPERVISOR-OWNERSHIP.md): a manager provisions for
   * any family in their organization; an admin or coverage admin only for a
   * family they own. Being on duty for a family is NOT scope here -- `on_duty()`
   * is deprecated and nothing new may depend on it (PD-3).
   */
  canProvisionStudentGroupFor(
    actor: Actor,
    target: { learnerOrganizationId: string; familyOrganizationId: string; familyOwnerId: string },
  ): Decision {
    const gate = this.canProvisionStudentGroup(actor);
    if (!gate.allowed) return gate;
    if (actor.kind === ActorKind.SYSTEM) return allow();

    if (
      target.learnerOrganizationId !== actor.organizationId ||
      target.familyOrganizationId !== actor.organizationId
    ) {
      return deny(CommErrorCode.CONVERSATION_NOT_FOUND, 'learner not found');
    }
    if (actor.staffRole === 'manager') return allow();
    if (target.familyOwnerId === actor.actorId) return allow();
    return deny(
      CommErrorCode.CANNOT_PROVISION_STUDENT_GROUP,
      'only the family\'s supervisor or a manager may provision its Student Group',
    );
  }

  /**
   * May this actor publish a story?
   *
   * The family-facing staff roles, and only them: `isFamilyFacingStaff` is the
   * same predicate that decides who may message a family, which is the right
   * comparison -- a story is an academy-to-family communication. Department
   * staff (finance, technical, academic) complete tasks and never address
   * families, so they do not publish either. Teachers and contacts cannot: the
   * mobile client cannot even authenticate as a role that could.
   *
   * NECESSARY, NOT SUFFICIENT. This says "you may publish something"; it says
   * nothing about the audience. StoryAudienceResolver independently refuses
   * every clause outside the author's own organization, so this verdict can
   * never widen anybody's reach on its own.
   *
   * Written as an intent method on this service rather than as a permission-key
   * lookup, because this codebase has exactly one authorization model and adding
   * a second (the abandoned Phase 5 lineage's `chat.role_permission`) would mean
   * two places to read before knowing whether an actor may act.
   */
  canPublishStory(actor: Actor): Decision {
    if (!actor.isActive) {
      return deny(CommErrorCode.ACTOR_INACTIVE, 'an inactive actor may not publish');
    }
    if (!isFamilyFacingStaff(actor)) {
      return deny(
        CommErrorCode.STORY_CANNOT_PUBLISH,
        'only Jawwid admins, coverage admins and managers may publish a story',
      );
    }
    // A publisher with no tenant cannot be scoped, and an unscoped audience
    // clause is not a narrow one -- `all_families` resolved without an
    // organization filter would mean every contact in the database. Every real
    // actor carries an organization (IdentityService requires the column), so
    // this is refusing a state the identity layer does not produce rather than
    // one anybody reaches. It is here because the alternative is a `where`
    // clause that silently omits a filter, which is the wrong shape for a tenant
    // boundary: it fails open.
    if (!actor.organizationId) {
      return deny(
        CommErrorCode.STORY_CANNOT_PUBLISH,
        'an actor with no organization cannot publish: the audience could not be scoped',
      );
    }
    return allow();
  }

  /**
   * May this actor read the stories published to them?
   *
   * Everyone active may. Which stories they then see is not decided here at all:
   * it is the join against their own chat.story_recipient rows. Splitting the two
   * is the point -- "may I read stories" must never be the check that decides
   * WHICH stories, or the answer becomes a filter somebody can forget to apply.
   */
  canReadStories(actor: Actor): Decision {
    if (!actor.isActive) {
      return deny(CommErrorCode.ACTOR_INACTIVE, 'an inactive actor has no story feed');
    }
    if (actor.kind === ActorKind.CONTACT && actor.canMessage === false) {
      return deny(
        CommErrorCode.STORY_CANNOT_READ,
        'this contact is not a communicating contact for the family',
      );
    }
    return allow();
  }

  /**
   * May this actor see WHO viewed a story?
   *
   * Only a publisher, and the service additionally requires the story to belong
   * to their organization. A viewer list is the most privacy-sensitive read in
   * the feature -- it says which named parent opened which publication and when --
   * so it is deliberately not granted to the recipients themselves, however
   * WhatsApp-like that might feel: a parent is not the owner of an academy
   * publication.
   */
  canReadStoryViewers(actor: Actor): Decision {
    return this.canPublishStory(actor);
  }

  /**
   * May this actor inspect the whole organization -- every account, every
   * conversation and its messages, every story -- through the Admin Portal's
   * read-only `/admin` surface?
   *
   * `super_admin` only (PD-5; AUTHORIZATION-MODEL §3 `users.manage`, which no
   * other role holds). A manager also sees every family in the organization by
   * §6, but `/admin` lists ACCOUNTS, and account inspection is user management.
   *
   * READ-ONLY BY CONSTRUCTION. This answers "may you look", never "may you act":
   * no route behind it writes. Acting in a family conversation is still decided
   * by canSend / canPublishStory / canApprove, which do not admit super_admin
   * yet, because the SQL helpers they agree with do not either.
   *
   * The organization is required for the same reason canPublishStory requires
   * it: every query behind this verdict is filtered on it, and a missing tenant
   * would be a `where` clause that silently omits its filter -- failing open.
   */
  canInspectOrganization(actor: Actor): Decision {
    if (!actor.isActive) {
      return deny(CommErrorCode.ACTOR_INACTIVE, 'an inactive actor may not inspect the organization');
    }
    if (actor.kind !== ActorKind.STAFF || actor.staffRole !== StaffRole.SUPER_ADMIN) {
      return deny(
        CommErrorCode.ADMIN_INSPECTION_DENIED,
        'only the super admin may inspect the organization',
      );
    }
    if (!actor.organizationId) {
      return deny(
        CommErrorCode.ADMIN_INSPECTION_DENIED,
        'an actor with no organization cannot be scoped',
      );
    }
    return allow();
  }

  // ------------------------------------------------------------------
  // Staff profiles
  // ------------------------------------------------------------------

  /**
   * What `actor` may do with the profile of `target`.
   *
   * THE RELATION IS AN INPUT, NOT A LOOKUP -- the same arrangement as PD-6.
   * StaffProfileService resolves `target` (role, organization, activity, and
   * whether it reports to the actor) from the database and hands it here; this
   * method compares no ids it fetched itself and has no database dependency.
   *
   * Three relations, checked in order, and nothing else is visible:
   *   self          the actor's own row
   *   organization  the actor holds org_profiles.view (super_admin), same tenant
   *   team          the target reports DIRECTLY to the actor, the actor holds
   *                 team_profiles.view, and the target is not a manager or the
   *                 super admin
   *
   * WHAT NO BRANCH GRANTS: a change to role, permissions, account status, login
   * identity or credentials. Those fields have no setter behind this decision at
   * all. The reporting line is never editable on one's own profile, and a
   * responsibility is never assignable to oneself unless one is the super admin
   * (whom nobody else could assign). An inactive actor gets nothing; an
   * inactive target is viewable by whoever could view it, and editable by
   * nobody but the super admin.
   */
  staffProfileAccess(actor: Actor, target: StaffProfileTarget): StaffProfileAccess {
    if (actor.kind !== ActorKind.STAFF || !actor.isActive || !actor.organizationId) {
      return NO_PROFILE_ACCESS;
    }
    if (target.organizationId !== actor.organizationId) return NO_PROFILE_ACCESS;

    const keys = profilePermissionsFor(actor.staffRole);
    const has = (key: StaffProfilePermission) => keys.has(key);
    const isSelf = target.staffId === actor.actorId;
    const audit = has(StaffProfilePermission.PROFILE_AUDIT_READ);

    if (isSelf) {
      return {
        relation: 'self',
        canView: true,
        canEditProfessional: has(StaffProfilePermission.SELF_EDIT),
        canEditPhoto: has(StaffProfilePermission.SELF_EDIT),
        canEditDisplayName: has(StaffProfilePermission.ORG_EDIT_IDENTITY),
        canManageResponsibilities: has(StaffProfilePermission.ORG_RESPONSIBILITIES_MANAGE),
        // Never one's own: a staff member cannot choose who manages them.
        canManageReportingLine: false,
        canReadAudit: audit,
      };
    }

    if (has(StaffProfilePermission.ORG_VIEW)) {
      const editable = target.isActive;
      return {
        relation: 'organization',
        canView: true,
        canEditProfessional: editable && has(StaffProfilePermission.ORG_EDIT_PROFESSIONAL),
        canEditPhoto: editable && has(StaffProfilePermission.ORG_EDIT_IDENTITY),
        canEditDisplayName: editable && has(StaffProfilePermission.ORG_EDIT_IDENTITY),
        canManageResponsibilities: editable && has(StaffProfilePermission.ORG_RESPONSIBILITIES_MANAGE),
        canManageReportingLine:
          editable &&
          has(StaffProfilePermission.REPORTING_LINES_MANAGE) &&
          target.role !== StaffRole.SUPER_ADMIN,
        canReadAudit: audit,
      };
    }

    if (
      target.reportsToActor &&
      actor.staffRole === StaffRole.MANAGER &&
      !NEVER_A_TEAM_MEMBER.has(target.role) &&
      has(StaffProfilePermission.TEAM_VIEW)
    ) {
      const editable = target.isActive;
      return {
        relation: 'team',
        canView: true,
        canEditProfessional: editable && has(StaffProfilePermission.TEAM_EDIT_PROFESSIONAL),
        // A photo and a name are the person's own; a manager edits neither.
        canEditPhoto: false,
        canEditDisplayName: false,
        canManageResponsibilities: editable && has(StaffProfilePermission.TEAM_RESPONSIBILITIES_MANAGE),
        // Team membership is user management: super admin only.
        canManageReportingLine: false,
        canReadAudit: audit,
      };
    }

    return NO_PROFILE_ACCESS;
  }

  /**
   * May this actor see the organization-wide staff overview (every account,
   * every team, every responsibility, global workload)? `org_profiles.view`,
   * which only the super admin holds.
   */
  canViewOrganizationProfiles(actor: Actor): Decision {
    if (!actor.isActive) {
      return deny(CommErrorCode.ACTOR_INACTIVE, 'an inactive actor may not view the organization');
    }
    if (
      actor.kind !== ActorKind.STAFF ||
      !actor.organizationId ||
      !profilePermissionsFor(actor.staffRole).has(StaffProfilePermission.ORG_VIEW)
    ) {
      return deny(CommErrorCode.STAFF_DIRECTORY_DENIED, 'only the super admin may view the organization overview');
    }
    return allow();
  }

  // ------------------------------------------------------------------
  // Ownership and offboarding (approved policy, 20261014110000)
  // ------------------------------------------------------------------
  //
  // The SQL functions are the enforcement (chat.require_family_assigner /
  // chat.require_super_admin, server-side only); these are the same rules for
  // any API route that offers the action, so the API never offers what the
  // database will refuse. Separate actions, separate rules:
  //   families.assign            manager or super_admin, same organization
  //   move a staff member's families (offboarding, part 1)
  //                              manager (not another manager's or the super
  //                              admin's) or super_admin
  //   deactivate a staff account super_admin only; never the super admin, never self

  canAssignFamilies(actor: Actor, target: { organizationId: string }): Decision {
    return this.ownershipAuthority(actor, target.organizationId, ['manager', 'super_admin'], 'assign families');
  }

  canTransferStaffFamilies(actor: Actor, target: { organizationId: string; role: string }): Decision {
    const base = this.ownershipAuthority(actor, target.organizationId, ['manager', 'super_admin'], 'move families');
    if (!base.allowed) return base;
    if (actor.staffRole === StaffRole.MANAGER && NEVER_A_TEAM_MEMBER.has(target.role)) {
      return deny(CommErrorCode.STAFF_ASSIGNMENT_DENIED, "a manager cannot move another manager's or the super admin's families");
    }
    return base;
  }

  canDeactivateStaff(actor: Actor, target: { staffId: string; organizationId: string; role: string }): Decision {
    const base = this.ownershipAuthority(actor, target.organizationId, ['super_admin'], 'deactivate staff');
    if (!base.allowed) return base;
    if (target.role === StaffRole.SUPER_ADMIN || target.staffId === actor.actorId) {
      return deny(CommErrorCode.STAFF_ASSIGNMENT_DENIED, 'the super admin cannot be deactivated, and nobody deactivates themselves');
    }
    return base;
  }

  private ownershipAuthority(actor: Actor, organizationId: string, roles: string[], what: string): Decision {
    if (!actor.isActive) return deny(CommErrorCode.ACTOR_INACTIVE, `an inactive actor may not ${what}`);
    if (actor.kind !== ActorKind.STAFF || !actor.organizationId || actor.organizationId !== organizationId) {
      return deny(CommErrorCode.STAFF_ASSIGNMENT_DENIED, `only staff of this organization may ${what}`);
    }
    if (!roles.includes(actor.staffRole ?? '')) {
      return deny(CommErrorCode.STAFF_ASSIGNMENT_DENIED, `${actor.staffRole} may not ${what}`);
    }
    return allow();
  }

  /** The approver is the family's active handler, or any manager. */
  canApprove(actor: Actor, activeHandlerId: string | null): Decision {
    // JC-006: every public method is independently safe -- a deactivated
    // manager decides nothing, whichever caller forgot to check first.
    if (!actor.isActive) return deny(CommErrorCode.ACTOR_INACTIVE, 'an inactive actor may not decide approvals');
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
    familyOwnerId: string | null = null,
    /** Live membership for the C-4 admin-presence check on the call path.
     *  Calling is never more permissive than messaging, so it runs the same
     *  check with the same data. */
    liveMembers: LiveMember[] = [],
    /** PD-2: starting a group call is not the same permission as joining one.
     *  Defaults to the stricter INITIATE. */
    intent: CallIntent = CallIntent.INITIATE,
  ): Promise<Decision> {
    const sendable = await this.canSend(
      actor,
      conv,
      membership,
      { visibility: Visibility.CUSTOMER },
      now,
      familyOwnerId,
      participants.map((p) => p.kind),
      liveMembers,
    );
    if (!sendable.allowed) return sendable;

    // BR-1 (PD-7). canSend already refused a direct teacher/parent
    // conversation, so a call cannot be more permissive than a message in the
    // same channel -- which is the property C-2 asks for and the reason calling
    // routes through canSend at all. Restated here on the call's own
    // participant set, because the two are supplied separately and a caller
    // that assembles them inconsistently must not slip through.
    const direct = this.refuseDirectTeacherParent(
      actor,
      conv,
      participants.map((p) => p.kind),
    );
    if (direct) return direct;

    /**
     * PD-2 (closed 2026-09-07). A group call is the official Teacher <-> Parent
     * channel (PRD section 9), and it is opened by Jawwid, not by the family: a
     * parent may join a Student Group or Class Group call but may never start
     * one. Evaluated AFTER the BR-1 checks above so that a constitutional
     * violation always reports its own code rather than this policy one.
     *
     * The parent's 1:1 call to their handler (PRD section 9, "1:1 call |
     * Parent | Parent <-> Admin") is untouched: this rule is scoped to group
     * conversations.
     */
    const isGroup =
      conv.type === ConversationType.STUDENT_GROUP || conv.type === ConversationType.CLASS_GROUP;
    if (intent === CallIntent.INITIATE && isGroup && actor.kind === ActorKind.CONTACT) {
      return deny(
        CommErrorCode.PARENT_CANNOT_START_GROUP_CALL,
        'PD-2: a parent may join a group call but may not start one; a teacher or admin starts it',
      );
    }

    return allow();
  }
}
