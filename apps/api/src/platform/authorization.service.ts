import { Inject, Injectable } from '@nestjs/common';
import { Conversation, ConversationMember } from '@prisma/client';
import { COVERAGE_SERVICE } from './tokens';
import type { CoverageService } from './coverage.service';
import { Actor, actorHasPermission, isFamilyFacingStaff } from './types';
import { Permission } from './rbac/permissions';
import { CommErrorCode } from './errors';
import {
  ActorKind,
  ConversationType,
  MemberRole,
  Moderation,
  OnBehalfMode,
  ORGANIZATION_WIDE_STAFF_ROLES,
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

/**
 * The caller's resolved answer to "is this conversation's family inside this
 * actor's scope right now?".
 *
 * Supplied rather than fetched, for the same reason familyOwnerId,
 * participantKinds and liveMembers are: this service stays pure and
 * synchronously testable, and the one place scope is COMPUTED is
 * ScopeService. What this service owns is what scope MEANS for a decision.
 *
 * `undefined` is not "no restriction" -- it is "not established", and every
 * path below treats it as a denial for staff. A caller that cannot say whether
 * a family is in scope has not earned an allow.
 */
export interface ScopeState {
  readonly familyInScope: boolean;
  /** The actor's organization matches the record's. Defaults to true when the
   *  caller does not distinguish tenants (single-tenant paths). */
  readonly sameOrganization?: boolean;
}

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
  // Permission keys
  // ------------------------------------------------------------------

  /**
   * The generic permission check -- THE single entry point for every surface
   * that is not a conversation decision (families, assignment, staff, audit,
   * config, user management).
   *
   * Controllers call this. They never compare roles: `actor.staffRole ===
   * 'manager'` scattered through controllers is how a role rename becomes a
   * privilege escalation, and how a per-person exception becomes impossible to
   * express. The effective set already has the account's ALLOW/DENY overrides
   * applied (rbac/permissions.ts), so a DENY here really does restrict a
   * permission the role grants.
   */
  can(actor: Actor, permission: Permission | string): Decision {
    if (!actor.isActive) {
      return deny(CommErrorCode.ACTOR_INACTIVE, 'actor is inactive');
    }
    if (!actorHasPermission(actor, permission)) {
      return deny(
        CommErrorCode.PERMISSION_DENIED,
        `this actor does not hold ${permission}`,
      );
    }
    return allow();
  }

  /** Convenience for call sites that only need the boolean. */
  hasPermission(actor: Actor, permission: Permission | string): boolean {
    return this.can(actor, permission).allowed;
  }

  // ------------------------------------------------------------------
  // Opening a 1:1 channel
  // ------------------------------------------------------------------

  /**
   * The complete allow-list for direct conversations. Anything not named here
   * is denied, so a new actor kind is denied by default rather than allowed by
   * accident.
   */
  canOpenDirect(a: Actor, b: Actor, scope?: ScopeState): Decision {
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
        staff.department
          ? `departmental staff (${staff.department}) never take part in family communication`
          : `role ${staff.staffRole} may never take part in family communication`,
      );
    }

    // Tenancy. Two people in different organizations are not colleagues.
    if (a.organizationId && b.organizationId && a.organizationId !== b.organizationId) {
      return deny(
        CommErrorCode.CROSS_TENANT,
        'these actors belong to different organizations',
      );
    }

    // Scope. Opening a channel with a family contact is reaching that family;
    // a supervisor may only do it for a family they supervise. Checked here
    // rather than only on the first message, because creating the channel is
    // already an act against that family.
    const contact = a.kind === ActorKind.CONTACT ? a : b.kind === ActorKind.CONTACT ? b : null;
    if (contact && scope?.familyInScope !== true) {
      return deny(
        CommErrorCode.OUT_OF_SCOPE,
        'this family is not within the actor\'s authorized scope',
      );
    }

    return allow();
  }

  // ------------------------------------------------------------------
  // Reading
  // ------------------------------------------------------------------

  /**
   * SCOPE BEFORE ROLE.
   *
   * What this used to be: `if (staff) return allow()`. Any family-facing staff
   * member could read any conversation of any family in the system (red-team
   * A-1 / RT-011). A role is a statement about what KIND of action someone may
   * take; it has never been a statement about which records, and treating it
   * as one is how a supervisor of eight families reads eight hundred.
   *
   * What it is now, in order:
   *   1. the actor is active;
   *   2. the actor holds `conversations.read`;
   *   3. staff: the conversation's family is inside their CURRENT scope --
   *      or, for a family-less conversation (Teacher <-> Admin direct), they are
   *      a live member of it;
   *   4. everyone else: they are a live member.
   *
   * `scope` is supplied by the caller and `undefined` means NOT ESTABLISHED,
   * which denies. A conversation that names a family the caller could not
   * resolve is not readable on the strength of a job title.
   */
  canRead(actor: Actor, conv: Conv, membership: Member | null, scope?: ScopeState): Decision {
    if (!actor.isActive) return deny(CommErrorCode.ACTOR_INACTIVE, 'actor is inactive');
    if (actor.kind === ActorKind.SYSTEM) return allow();

    if (actor.permissions && !actor.permissions.has(Permission.CONVERSATIONS_READ)) {
      return deny(
        CommErrorCode.PERMISSION_DENIED,
        'this actor does not hold conversations.read',
      );
    }

    if (scope?.sameOrganization === false) {
      return deny(CommErrorCode.CROSS_TENANT, 'this record belongs to another organization');
    }

    const live = membership !== null && membership.leftAt === null;

    if (actor.kind === ActorKind.STAFF) {
      if (!isFamilyFacingStaff(actor)) {
        return deny(
          CommErrorCode.ROLE_CANNOT_MESSAGE_FAMILY,
          actor.department
            ? `departmental staff (${actor.department}) may not access conversations`
            : `role ${actor.staffRole} may not access conversations`,
        );
      }
      if (conv.familyId === null) {
        // No family to be in scope of. Membership is the only thing that can
        // make a staff-to-staff or teacher-to-admin channel theirs.
        if (!live) {
          return deny(
            CommErrorCode.NOT_CONVERSATION_MEMBER,
            'actor is not a member of this conversation',
          );
        }
        return allow();
      }
      if (scope?.familyInScope !== true) {
        return deny(
          CommErrorCode.OUT_OF_SCOPE,
          'this family is not within the actor\'s authorized scope',
        );
      }
      return allow();
    }

    if (!live) {
      return deny(CommErrorCode.NOT_CONVERSATION_MEMBER, 'actor is not a member of this conversation');
    }
    return allow();
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
    /** Supervisor scope, resolved by the caller. Undefined denies for staff. */
    scope?: ScopeState,
  ): Promise<Decision> {
    const readable = this.canRead(actor, conv, membership, scope);
    if (!readable.allowed) return readable;

    if (conv.archivedAt) {
      return deny(CommErrorCode.CONVERSATION_ARCHIVED, 'conversation is archived');
    }

    if (actor.kind === ActorKind.SYSTEM) return allow(null, Moderation.PUBLISHED);

    // The permission key for speaking to a family, checked for every kind of
    // actor. Role defaults with the account's ALLOW/DENY overrides already
    // applied, so a DENY on messages.send silences one person without
    // inventing a role for them.
    //
    // Only the CUSTOMER-visibility key is checked here. Internal notes are
    // checked inside each branch below, so a contact or a teacher attempting
    // one still gets the specific, documented code
    // (CONTACT_CANNOT_WRITE_INTERNAL / TEACHER_CANNOT_WRITE_INTERNAL) rather
    // than a generic permission denial: the client renders those differently,
    // and a vaguer error is not a safer one.
    if (
      intent.visibility !== Visibility.INTERNAL &&
      actor.permissions &&
      !actor.permissions.has(Permission.MESSAGES_SEND)
    ) {
      return deny(
        CommErrorCode.PERMISSION_DENIED,
        `this actor does not hold ${Permission.MESSAGES_SEND}`,
      );
    }

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
      const presence = this.requireAdminPresence(conv, liveMembers, participantKinds);
      if (presence) return presence;
      return allow(null, this.moderationFor(conv, MemberRole.PARENT));
    }

    // --- teacher ---
    if (actor.kind === ActorKind.TEACHER) {
      if (intent.visibility === Visibility.INTERNAL) {
        return deny(CommErrorCode.TEACHER_CANNOT_WRITE_INTERNAL, 'teachers cannot write internal notes');
      }
      // BR-1 backstop. A teacher may speak in a group, and in a 1:1 whose other
      // side is Jawwid staff. What they may never do is share a direct channel
      // with a family contact, so the check is on the participant set, not on
      // the conversation type: Teacher <-> Admin is a permitted 1:1 and must
      // not be caught here.
      if (
        conv.type === ConversationType.DIRECT &&
        participantKinds.includes(ActorKind.CONTACT)
      ) {
        return deny(
          CommErrorCode.BR1_TEACHER_PARENT_DIRECT,
          'BR-1: a teacher may not message a parent outside the student group',
        );
      }
      if (membership?.isSilent) {
        return deny(CommErrorCode.MEMBER_IS_SILENT, 'this member is present but may not post');
      }
      const presence = this.requireAdminPresence(conv, liveMembers, participantKinds);
      if (presence) return presence;
      return allow(null, this.moderationFor(conv, MemberRole.TEACHER));
    }

    // --- staff ---
    if (
      intent.visibility === Visibility.INTERNAL &&
      actor.permissions &&
      !actor.permissions.has(Permission.MESSAGES_INTERNAL)
    ) {
      return deny(
        CommErrorCode.PERMISSION_DENIED,
        `this actor does not hold ${Permission.MESSAGES_INTERNAL}`,
      );
    }

    // Internal notes: any family-facing admin, on a family in scope, any time.
    // The capacity is still derived from facts, never asserted by the client.
    if (intent.visibility === Visibility.INTERNAL) {
      const mode = await this.deriveMode(actor, conv, familyOwnerId, now);
      return allow(mode, Moderation.PUBLISHED);
    }

    // A manager may act on anything, but may not choose their own attribution:
    // only assist/escalation are honourable requests, everything else is derived.
    if (ORGANIZATION_WIDE_STAFF_ROLES.has(actor.staffRole ?? '')) {
      const mode = await this.deriveMode(actor, conv, familyOwnerId, now, intent.requestedMode);
      return allow(mode, Moderation.PUBLISHED);
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

  /** Group approval policy. Staff messages are never held. */
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
   */
  canManageMembership(actor: Actor, scope?: ScopeState): Decision {
    if (!actor.isActive) return deny(CommErrorCode.ACTOR_INACTIVE, 'actor is inactive');
    if (!isFamilyFacingStaff(actor)) {
      return deny(CommErrorCode.CANNOT_MANAGE_MEMBERSHIP, 'only Jawwid admins may change membership');
    }
    if (actor.permissions && !actor.permissions.has(Permission.CONVERSATIONS_MANAGE)) {
      return deny(CommErrorCode.PERMISSION_DENIED, 'this actor does not hold conversations.manage');
    }
    // Changing who is in a family's group is an act against that family.
    if (scope !== undefined && !scope.familyInScope) {
      return deny(
        CommErrorCode.OUT_OF_SCOPE,
        'this family is not within the actor\'s authorized scope',
      );
    }
    return allow();
  }

  /** The approver is the family's active handler, or any manager. */
  canApprove(actor: Actor, activeHandlerId: string | null, scope?: ScopeState): Decision {
    if (!actor.isActive) return deny(CommErrorCode.ACTOR_INACTIVE, 'actor is inactive');
    if (!isFamilyFacingStaff(actor)) {
      return deny(CommErrorCode.CANNOT_APPROVE, 'only Jawwid admins may decide approvals');
    }
    if (actor.permissions && !actor.permissions.has(Permission.MESSAGES_MODERATE)) {
      return deny(CommErrorCode.PERMISSION_DENIED, 'this actor does not hold messages.moderate');
    }
    // A manager's reach is the organization, but it is still a scope: a
    // manager of one academy does not moderate another's.
    if (scope !== undefined && !scope.familyInScope) {
      return deny(
        CommErrorCode.OUT_OF_SCOPE,
        'this family is not within the actor\'s authorized scope',
      );
    }
    if (ORGANIZATION_WIDE_STAFF_ROLES.has(actor.staffRole ?? '')) return allow();
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
    /** Supervisor scope, resolved by the caller. Undefined denies for staff. */
    scope?: ScopeState,
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
      scope,
    );
    if (!sendable.allowed) return sendable;

    const requiredCallKey =
      intent === CallIntent.INITIATE ? Permission.CALLS_START : Permission.CALLS_ACCEPT;
    if (actor.permissions && !actor.permissions.has(requiredCallKey)) {
      return deny(CommErrorCode.PERMISSION_DENIED, `this actor does not hold ${requiredCallKey}`);
    }

    const kinds = new Set(participants.map((p) => p.kind));
    if (conv.type === ConversationType.DIRECT && kinds.has(ActorKind.TEACHER) && kinds.has(ActorKind.CONTACT)) {
      return deny(
        CommErrorCode.BR1_TEACHER_PARENT_DIRECT,
        'BR-1: a teacher and a parent may not share a 1:1 call',
      );
    }

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
