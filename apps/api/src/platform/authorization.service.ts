import { Inject, Injectable, Optional } from '@nestjs/common';
import { Conversation, ConversationMember } from '@prisma/client';
import { COVERAGE_SERVICE, STAFF_SCOPE, SUBSCRIPTION_LOCK } from './tokens';
import { NO_SUBSCRIPTION_LOCK, type SubscriptionLockReader } from './subscription-lock';
import type { CoverageService } from './coverage.service';
import { NO_STAFF_SCOPE, StaffAccessBasis, type ActsFor, type StaffScope } from './staff-scope';
import { Actor, isConversationStaff, isFamilyFacingStaff } from './types';
import { CommErrorCode } from './errors';
import {
  NEVER_A_TEAM_MEMBER,
  NO_PROFILE_ACCESS,
  StaffProfilePermission,
  profilePermissionsFor,
  type StaffProfileAccess,
  type StaffProfileTarget,
} from './staff-profile-policy';
import { decideTeacherFileAccess, type TeacherFileAccess, type TeachersDepartmentRole } from './teacher-file-policy';
import {
  ActorKind,
  CONVERSATION_STAFF_ROLES,
  ConversationType,
  GROUP_CALL_CONVERSATION_TYPES,
  GROUP_CONVERSATION_TYPES,
  MemberRole,
  Moderation,
  OnBehalfMode,
  StaffRole,
  Visibility,
} from '../communication/contracts/vocab';

/**
 * PD-21: what an administrator may do to another account. PD-23 adds
 * 'sign_out' (end one or all of its sessions), under the same rule as suspend.
 */
export type AccountAdminAct = 'reset_password' | 'suspend' | 'reactivate' | 'impersonate' | 'sign_out';

/** PD-21: the account an administrator acts on, resolved by the caller. */
export interface AccountAdminTarget {
  accountId: string;
  organizationId: string;
  /** chat.account.kind: staff | family | teacher */
  kind: string;
  /** Present when kind = staff. */
  staffId?: string | null;
  staffRole?: string | null;
}

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
 * PD-9 / PD-11: how an actor stands to one lesson. `manager` -- the super admin
 * or the Teachers department; `supervisor` -- the learner's PD-8 supervisor
 * (an Operations supervisor, their active backup, or the Operations manager
 * through staff_principals); `teacher` -- the lesson's own teacher; `family` --
 * a contact of the learner's family.
 */
export type LessonStanding = 'manager' | 'supervisor' | 'teacher' | 'family';

export type LessonAct =
  | 'report'
  | 'absence'
  | 'apology'
  | 'teacher_apology'
  | 'cancel'
  | 'teacher_no_show'
  | 'late_apology'
  | 'decide_ruling'
  | 'book_makeup'
  | 'request_schedule_change'
  | 'move_lesson'
  | 'decide_schedule_change'
  | 'resolve_makeup'
  | 'read_schedule'
  | 'transfer'
  | 'suspend'
  | 'late_excuse'
  | 'correct_outcome'
  | 'edit_report'
  | 'delete_report'
  | 'manage_enrollment'
  | 'read_profile'
  | 'read_materials'
  | 'correct_memorization';

/**
 * Who may record what (PD-11's table, extended by PD-15). The report is the
 * teacher's own words, so nobody writes it for them; an absence the Teachers
 * department may record when the teacher cannot; a late apology is the
 * family's to file and never the teacher's to judge.
 *
 * PD-15: the child's supervisor (Operations) records excuses from the group --
 * a student's before the start (`apology`) or after it (`late_excuse`, which
 * excuses at once), and a teacher's (`teacher_apology`). Corrections, and
 * editing or deleting any report, are the Teachers department's, Operations'
 * and the super admin's; a teacher edits their own report only.
 */
const LESSON_ACTS: Readonly<Record<LessonAct, readonly LessonStanding[]>> = {
  report: ['teacher'],
  absence: ['teacher', 'manager'],
  apology: ['family', 'manager', 'supervisor'],
  teacher_apology: ['teacher', 'manager', 'supervisor'],
  late_excuse: ['manager', 'supervisor'],
  correct_outcome: ['manager', 'supervisor'],
  edit_report: ['teacher', 'manager', 'supervisor'],
  delete_report: ['manager', 'supervisor'],
  manage_enrollment: ['manager', 'supervisor'],
  cancel: ['manager'],
  teacher_no_show: ['manager'],
  late_apology: ['family'],
  decide_ruling: ['manager'],
  // PD-11 T2: a family books the make-up it is owed itself, instantly; a
  // regular-time change it may only ask for. PD-15: the teacher and the
  // child's supervisor record the make-up time the family and teacher agreed.
  book_makeup: ['family', 'manager', 'supervisor', 'teacher'],
  // PD-31: a teacher may ask for new weekly times too; the Teachers department
  // still decides. Moving ONE lesson is instant for everyone who takes part in
  // it -- the family within its limits (SchedulingService), never a violation.
  request_schedule_change: ['family', 'teacher'],
  move_lesson: ['family', 'teacher', 'manager', 'supervisor'],
  decide_schedule_change: ['manager'],
  resolve_makeup: ['manager'],
  read_schedule: ['manager', 'supervisor', 'teacher', 'family'],
  // PD-11 T3: moving a child between teachers is the Teachers department's; a
  // pause or a stop may also be recorded by the child's own (Operations) supervisor.
  // PD-31: so may the change of teacher -- the child's PD-8 supervisor, their
  // active backup and the Operations Manager (chat.transfer_learner agrees).
  transfer: ['manager', 'supervisor'],
  suspend: ['manager', 'supervisor'],
  // PD-17: the Student Profile -- the administration (the Teachers department,
  // the super admin, the child's supervisor) and the child's own teacher. Not
  // the family: parents see their children on their own profile.
  read_profile: ['manager', 'supervisor', 'teacher'],
  // PD-29: a child's Materials page -- the library, practice this week and the
  // memorization map -- for the family, the child's own teacher and the staff
  // whose PD-8 scope reaches the child. A surah marked in a report rides on
  // `report` / `edit_report`; a correction outside a report names its reason
  // and is the teacher's or the supervisors'.
  read_materials: ['manager', 'supervisor', 'teacher', 'family'],
  correct_memorization: ['manager', 'supervisor', 'teacher'],
};

export interface SendIntent {
  visibility: string;
  /** Only ASSIST / ESCALATION are honoured; OWNER vs COVERAGE is derived. */
  requestedMode?: string;
}

/**
 * Why the actor is being authorized for a call.
 *
 * PD-2 (2026-09-07) once refused a parent STARTING a group call while letting
 * them JOIN one. PD-19 (2026-10-21) superseded it: a member who may speak in a
 * conversation may start a call there, parents included. No rule currently
 * answers the two intents differently; start() and the join path still name
 * theirs, and INITIATE stays the default.
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
  constructor(
    // Kept for the positional construction the harnesses share. Since PD-8 the
    // coverage engine (on_duty) decides NOTHING here: backup access is an
    // explicit, activated chat.supervisor_backup link, read through `scope`.
    @Inject(COVERAGE_SERVICE) private readonly coverage: CoverageService,
    // PD-8: the staff conversation scope. Defaults to nobody-in-scope, so a
    // construction that forgets it narrows staff access instead of widening it.
    @Optional() @Inject(STAFF_SCOPE) private readonly scope: StaffScope = NO_STAFF_SCOPE,
    // PD-30: a child's group locked for payment. REQUIRED from the container --
    // an app without the provider fails to boot rather than run with no lock;
    // only the positional harness constructions get the no-lock default.
    @Inject(SUBSCRIPTION_LOCK) private readonly locks: SubscriptionLockReader = NO_SUBSCRIPTION_LOCK,
  ) {}

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
    /**
     * PD-8: for a Parent <-> staff pair, does the staff side reach the parent's
     * family (chat.staff_reaches_family -- supervises one of its children, or
     * acts for whoever does)? Resolved by the caller. Defaults to false: a
     * caller that does not resolve it cannot open a family channel.
     */
    staffReachesFamily = false,
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

    // Allowed: contact <-> staff, teacher <-> staff. The staff side must take
    // part in conversations: finance / technical / academic staff never do.
    const staff = a.kind === ActorKind.STAFF ? a : b.kind === ActorKind.STAFF ? b : null;
    if (!staff) {
      return deny(CommErrorCode.INVALID_PARTICIPANTS, 'a direct conversation requires a staff participant');
    }
    if (!isConversationStaff(staff)) {
      return deny(
        CommErrorCode.ROLE_CANNOT_MESSAGE_FAMILY,
        `role ${staff.staffRole} may never take part in family communication`,
      );
    }
    // PD-8 / BR-3: a family is reached by the staff in charge of it -- the
    // supervisor of one of its children, their active backup, their department
    // manager, or the super admin. Never an open directory, in either direction.
    if (kinds === 'contact+staff' && !staffReachesFamily) {
      return deny(CommErrorCode.STAFF_OUT_OF_SCOPE, 'this family is outside the staff member\'s charge');
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
   * STAFF SCOPE (PD-8, 2026-10-15). A staff member reads a conversation only on
   * a BASIS chat.staff_conversation_access() returns (see platform/staff-scope):
   * responsible supervisor of the group's learners, a live member who still
   * reaches the family, an active backup of either, their department manager,
   * or the super admin. That arrives here as `staffInScope`, a RESOLVED FACT --
   * the same shape as every other fact this class decides on. It defaults to
   * FALSE, so a call site that forgets to resolve it narrows, never widens.
   *
   * Neither a manager role nor a membership row grants staff access on its own
   * any more: a manager reads their department, and a supervisor whose children
   * were reassigned loses the families' conversations even though the
   * membership rows remain.
   *
   * Another organization's conversation reads as not found, for every staff
   * role, before anything else about it is revealed.
   */
  canRead(actor: Actor, conv: Conv, membership: Member | null, staffInScope = false): Decision {
    if (!actor.isActive) return deny(CommErrorCode.ACTOR_INACTIVE, 'actor is inactive');
    if (actor.kind === ActorKind.SYSTEM) return allow();

    const isLiveMember = !!membership && membership.leftAt === null;

    if (actor.kind === ActorKind.STAFF) {
      if (!isConversationStaff(actor)) {
        return deny(
          CommErrorCode.ROLE_CANNOT_MESSAGE_FAMILY,
          `role ${actor.staffRole} may not access conversations`,
        );
      }
      if (!actor.organizationId || conv.organizationId !== actor.organizationId) {
        return deny(CommErrorCode.CONVERSATION_NOT_FOUND, 'conversation not found');
      }
      if (staffInScope) return allow();
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
   * The basis on which a staff actor may access this conversation, or null.
   * The one place the API asks chat.staff_conversation_access(). Never for a
   * non-staff, inactive or tenant-less actor.
   */
  async staffAccess(
    actor: Actor,
    conv: Pick<Conv, 'id' | 'organizationId'>,
    now: Date,
  ): Promise<StaffAccessBasis | null> {
    if (actor.kind !== ActorKind.STAFF || !actor.isActive || !actor.organizationId) return null;
    if (!isConversationStaff(actor) || conv.organizationId !== actor.organizationId) return null;
    return this.scope.conversationAccess(actor.actorId, conv.id, now);
  }

  /**
   * The staff-scope fact for canRead. Kept under its old name and shape so the
   * call sites that resolve it did not have to move; the family owner argument
   * is no longer an input (PD-8).
   */
  async staffInScope(
    actor: Actor,
    conv: Pick<Conv, 'id' | 'organizationId'>,
    _familyOwnerId: string | null,
    now: Date,
  ): Promise<boolean> {
    return (await this.staffAccess(actor, conv, now)) !== null;
  }

  /** PD-8: how `staff` may act for `principal` ('self' | 'backup' | 'manager'), or null. */
  async actsFor(staff: Actor, principalId: string, now: Date): Promise<ActsFor> {
    if (staff.kind !== ActorKind.STAFF || !staff.isActive) return null;
    return this.scope.actsFor(staff.actorId, principalId, now);
  }

  /**
   * PD-8: does this staff actor reach the family (supervise one of its
   * children, or act for whoever does)? The input canOpenDirect decides a
   * Parent <-> staff channel on.
   */
  async reachesFamily(staff: Actor, familyId: string, now: Date): Promise<boolean> {
    if (staff.kind !== ActorKind.STAFF || !staff.isActive || !isConversationStaff(staff)) return false;
    return (await this.scope.familyReach(staff.actorId, familyId, now)) !== null;
  }

  /** `reachesFamily` for many (staffId, familyId) pairs; keyed `${staffId}:${familyId}`. */
  async reachesFamilyMany(
    pairs: ReadonlyArray<{ staffId: string; familyId: string }>,
    now: Date,
  ): Promise<Set<string>> {
    const reach = await this.scope.familyReachMany(pairs, now);
    return new Set([...reach.entries()].filter(([, v]) => v !== null).map(([k]) => k));
  }

  /**
   * The conversation ids a staff actor may access, for list queries. Computed
   * by the same SQL function as `staffAccess`, so a list can never be wider
   * than the per-conversation check.
   */
  async visibleConversationIds(actor: Actor, now: Date): Promise<string[]> {
    if (actor.kind !== ActorKind.STAFF || !actor.isActive || !actor.organizationId) return [];
    if (!isConversationStaff(actor)) return [];
    return this.scope.visibleConversationIds(actor.actorId, now);
  }

  /** PD-8: the supervisor responsible for a group (who decides its held messages), or null. */
  responsibleSupervisor(conversationId: string): Promise<string | null> {
    return this.scope.responsibleSupervisor(conversationId);
  }

  /** Internal notes are invisible to contacts and to teachers. */
  canReadInternal(actor: Actor): boolean {
    // JC-006 (re-applied, see JC-011): a deactivated or offboarded actor loses
    // access on EVERY path, not only the one that happens to check first. Each
    // public method of this service must be independently safe to call.
    if (!actor.isActive) return false;
    return isConversationStaff(actor);
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
    const basis = await this.staffAccess(actor, conv, now);
    const readable = this.canRead(actor, conv, membership, basis !== null);
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
      const locked = await this.refusePaymentLock(conv);
      if (locked) return locked;
      return allow(null, Moderation.PUBLISHED); // PD-14: never held for approval
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
      const locked = await this.refusePaymentLock(conv);
      if (locked) return locked;
      return allow(null, Moderation.PUBLISHED); // PD-14: never held for approval
    }

    // --- staff ---
    // canRead above admitted the actor on a scope basis (PD-8); what follows
    // decides only the SHAPE of the send and its recorded capacity, which is
    // derived from that basis and never taken from the client.
    if (intent.visibility === Visibility.INTERNAL) {
      return allow(this.modeFor(basis), Moderation.PUBLISHED);
    }

    // DEF-001. A DIRECT staff conversation that is not family-scoped: the
    // Teacher <-> Admin channel (decision C-2, "never family-scoped").
    //
    // MEMBERSHIP IS THE AUTHORITY HERE, and it has to be stated explicitly:
    // `canRead` above admits a department manager or an active backup to READ
    // a supervisor's teacher channel, but neither is a party to it. Without
    // this check such a non-member could SEND into a 1:1 between two other
    // people. This reads nothing the caller sent: `membership` is the server's
    // own chat.conversation_member row.
    if (conv.type === ConversationType.DIRECT && conv.familyId === null) {
      if (membership !== null && membership.leftAt === null) {
        return allow(OnBehalfMode.OWNER, Moderation.PUBLISHED);
      }
      return deny(
        CommErrorCode.NOT_CONVERSATION_MEMBER,
        'a direct staff conversation is answerable only by its members',
      );
    }

    // JC-005 - FAIL CLOSED. A client-supplied mode never grants anything and
    // never chooses an attribution the facts do not support: only a manager or
    // the super admin -- who are stepping in by definition -- may record a
    // message as an escalation. Anyone else asking for ASSIST/ESCALATION is
    // refused by name rather than silently re-attributed.
    const steppingIn = basis === StaffAccessBasis.MANAGER || basis === StaffAccessBasis.SUPER_ADMIN;
    if (intent.requestedMode === OnBehalfMode.ASSIST && !steppingIn) {
      return deny(
        CommErrorCode.ASSIST_NOT_PERMITTED,
        'assist requires a server-evaluated grant; a client-supplied mode never grants access',
      );
    }
    if (intent.requestedMode === OnBehalfMode.ESCALATION && !steppingIn) {
      return deny(
        CommErrorCode.ESCALATION_NOT_PERMITTED,
        'escalation requires a server-evaluated grant; a client-supplied mode never grants access',
      );
    }

    return allow(this.modeFor(basis, intent.requestedMode), Moderation.PUBLISHED);
  }

  /**
   * PD-30 (2026-10-26). A family or student group with a child locked for
   * payment -- lessons used up after the grace lessons, or an instalment
   * overdue, with no exception -- is read-only for the parent and the teacher.
   * One method called from the contact and teacher branches of canSend, and
   * so from canCall too: a locked group refuses a message and a call alike.
   * Staff are never refused (they are not asked), and a DIRECT conversation is
   * never consulted: the parent's chat with their supervisor stays open.
   *
   * Returns a denial, or null when the rule does not apply or enforcement is
   * off (SUBSCRIPTION_LOCK_ENFORCED). refusePaymentLockFor is the same rule for
   * the writes that do not go through canSend (a reaction).
   */
  async refusePaymentLockFor(actor: Actor, conv: Pick<Conv, 'id' | 'type'>): Promise<Decision | null> {
    if (actor.kind !== ActorKind.CONTACT && actor.kind !== ActorKind.TEACHER) return null;
    return this.refusePaymentLock(conv);
  }

  private async refusePaymentLock(conv: Pick<Conv, 'id' | 'type'>): Promise<Decision | null> {
    if (conv.type !== ConversationType.FAMILY_GROUP && conv.type !== ConversationType.STUDENT_GROUP) return null;
    if (!this.locks.enforced) return null;
    const locked = await this.locks.lockedChildren(conv.id);
    if (locked.length === 0) return null;
    return deny(
      CommErrorCode.SUBSCRIPTION_LOCKED,
      'PD-30: this group is read-only until the subscription is renewed or the overdue instalment is paid',
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
    if (!GROUP_CONVERSATION_TYPES.has(conv.type)) return null;

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

  /**
   * PD-14 (2026-10-20): whose sent messages may this staff member edit or
   * delete for everyone, after the fact? Nothing is held for approval any more;
   * moderation happens AFTER sending, by whoever is in charge of the
   * conversation on a PD-8 basis.
   *
   *   teachers and parents   any staff basis: the children's supervisor, their
   *                          active backup or department manager, the super
   *                          admin, or the staff party of a 1:1
   *   other staff            the department manager or the super admin only, so
   *                          a supervisor never rewrites a colleague
   *   system                 never: system messages and cards are records
   *
   * An actor's OWN message is not moderation; the author rules (window) apply.
   * `basis` is chat.staff_conversation_access for this conversation, now.
   */
  moderatableAuthorKinds(actor: Actor, basis: StaffAccessBasis | null): string[] {
    if (actor.kind !== ActorKind.STAFF || !actor.isActive || !isConversationStaff(actor) || basis === null) return [];
    if (basis === StaffAccessBasis.MANAGER || basis === StaffAccessBasis.SUPER_ADMIN) {
      return [ActorKind.TEACHER, ActorKind.CONTACT, ActorKind.STAFF];
    }
    return [ActorKind.TEACHER, ActorKind.CONTACT];
  }

  /**
   * on_behalf_mode is DERIVED from the scope basis, never accepted from the
   * client (PD-8):
   *
   *   owner      the responsible supervisor, or the staff party of a 1:1
   *   coverage   acting for them through an active backup link
   *   escalation a manager / the super admin who asked to record it as such
   *   assist     a manager / the super admin stepping in otherwise (audited)
   */
  private modeFor(basis: StaffAccessBasis | null, requested?: string): string {
    switch (basis) {
      case StaffAccessBasis.RESPONSIBLE:
      case StaffAccessBasis.MEMBER:
        return OnBehalfMode.OWNER;
      case StaffAccessBasis.BACKUP:
        return OnBehalfMode.COVERAGE;
      default:
        return requested === OnBehalfMode.ESCALATION ? OnBehalfMode.ESCALATION : OnBehalfMode.ASSIST;
    }
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
    if (!isConversationStaff(actor)) {
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
   * PD-8: whoever is in charge of it -- the responsible supervisor of a group's
   * learners, their active backup, their department manager, the super admin.
   * A conversation that is neither a group nor a direct one (class group,
   * official) only through live ADMIN membership of it.
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
      /** The actor's resolved scope basis on this conversation (PD-8), or null. */
      actorBasis: StaffAccessBasis | null;
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
    switch (conv.actorBasis) {
      case StaffAccessBasis.RESPONSIBLE:
      case StaffAccessBasis.BACKUP:
      case StaffAccessBasis.MANAGER:
      case StaffAccessBasis.SUPER_ADMIN:
        return allow();
      case StaffAccessBasis.MEMBER:
        if (conv.actorMemberRole === MemberRole.ADMIN) return allow();
        break;
      default:
        break;
    }
    return deny(
      CommErrorCode.CANNOT_MANAGE_MEMBERSHIP,
      "only the children's supervisor, their backup or manager, or the super admin may change this conversation's membership",
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
      /** PD-8: teachers of a family group's learners (chat.conversation_learner). */
      anchorTeacherIds?: readonly string[];
    },
    requestedRole: string,
    candidate:
      | { kind: 'contact'; organizationId: string; isActive: boolean; familyId: string; canMessage: boolean }
      | { kind: 'teacher'; actorId: string; organizationId: string; isActive: boolean; leftAt: Date | null }
      | {
          kind: 'staff';
          organizationId: string;
          isActive: boolean;
          leftAt: Date | null;
          staffRole: string;
          /** PD-8: the candidate's own scope basis on this conversation. */
          access: StaffAccessBasis | null;
        }
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
        if (conv.type === ConversationType.FAMILY_GROUP) {
          if (!(conv.anchorTeacherIds ?? []).includes(candidate.actorId)) {
            return ineligible('a teacher joins a family group only if they teach one of its children');
          }
          return allow();
        }
        if (conv.type !== ConversationType.STUDENT_GROUP || conv.learnerTeacherId !== candidate.actorId) {
          return ineligible("a teacher joins only the Student Group of a learner they teach");
        }
        return allow();
      case 'staff':
        if (requestedRole !== MemberRole.ADMIN && requestedRole !== MemberRole.OBSERVER) {
          return ineligible('staff join as admin or observer');
        }
        if (!candidate.isActive || candidate.leftAt !== null) return ineligible('this staff member is not active');
        if (!CONVERSATION_STAFF_ROLES.has(candidate.staffRole)) {
          return ineligible('this staff role does not take part in family communication');
        }
        // PD-8: a staff member joins only a conversation they are already in
        // charge of. Adding another supervisor would hand them a family that
        // is not theirs -- exactly what the scope exists to prevent.
        if (candidate.access === null) {
          return ineligible('this staff member is not in charge of this conversation');
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
    if (!isConversationStaff(actor)) {
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
   * May this actor provision a group about THESE learners -- a Student Group
   * (one learner) or a supervisor-created family group (PD-8)?
   *
   * Asked after `canProvisionStudentGroup` has passed and the learners are
   * loaded. The facts are resolved by the caller; this method reads no database.
   *
   * Tenant: a learner in another organization is reported as NOT FOUND, not as
   * forbidden, so a tenant boundary never confirms that an id exists.
   *
   * Scope (PD-8): the learners' supervisor, their active backup, their
   * department manager, or the super admin. A learner nobody supervises has no
   * group: there would be no admin to satisfy BR-1.
   */
  canProvisionStudentGroupFor(
    actor: Actor,
    target: {
      learnerOrganizationId: string;
      familyOrganizationId: string;
      /** chat.learner_supervision.supervisor_id, or null when unassigned. */
      supervisorId: string | null;
      /** How the actor acts for that supervisor (chat.staff_acts_for), or null. */
      actorActsFor: ActsFor;
    },
  ): Decision {
    const gate = this.canProvisionStudentGroup(actor);
    if (!gate.allowed) return gate;

    if (
      actor.kind !== ActorKind.SYSTEM &&
      (target.learnerOrganizationId !== actor.organizationId ||
        target.familyOrganizationId !== actor.organizationId)
    ) {
      return deny(CommErrorCode.CONVERSATION_NOT_FOUND, 'learner not found');
    }
    if (target.supervisorId === null) {
      return deny(
        CommErrorCode.LEARNER_UNSUPERVISED,
        'this learner has no supervisor yet; the Operations Manager assigns one first',
      );
    }
    if (actor.kind === ActorKind.SYSTEM || actor.staffRole === StaffRole.SUPER_ADMIN) return allow();
    if (target.actorActsFor !== null) return allow();
    return deny(
      CommErrorCode.CANNOT_PROVISION_STUDENT_GROUP,
      "only the learner's supervisor, their backup or manager, or the super admin may provision its group",
    );
  }

  /**
   * May this actor REVIEW a teacher's professional profile?
   *
   * The same staff set that publishes stories (family-facing staff and the
   * super admin). Deciding what a
   * family may read ABOUT a teacher is the same kind of authority as deciding
   * what a family is told, so it does not get a looser rule of its own.
   *
   * Says nothing about whose profile it is. "A teacher may not review their own"
   * is a separate fact the service checks against the resolved owner, and the
   * database enforces independently -- a role predicate cannot express it,
   * because the reviewer's role is identical either way.
   */
  canReviewTeacherProfile(actor: Actor): Decision {
    if (!actor.isActive) {
      return deny(CommErrorCode.ACTOR_INACTIVE, 'an inactive actor may not review');
    }
    // The super admin reviews too: PD-8 gave it full write, and canPublishStory
    // already admits it for the same family-facing reason.
    if (!isFamilyFacingStaff(actor) && actor.staffRole !== StaffRole.SUPER_ADMIN) {
      return deny(
        CommErrorCode.TEACHER_PROFILE_CANNOT_REVIEW,
        'only Jawwid admins, coverage admins, managers and the super admin may review a teacher profile',
      );
    }
    return allow();
  }

  /**
   * May this actor own a professional profile at all?
   *
   * Only a teacher. Staff and family contacts have no professional profile in
   * this product, and answering "no" here is what stops `/me/...` from quietly
   * creating one for an admin.
   */
  canOwnTeacherProfile(actor: Actor): Decision {
    if (!actor.isActive) {
      return deny(CommErrorCode.ACTOR_INACTIVE, 'an inactive actor may not edit a profile');
    }
    if (actor.kind !== 'teacher') {
      return deny(
        CommErrorCode.TEACHER_PROFILE_NOT_A_TEACHER,
        'only a teacher has a professional profile',
      );
    }
    return allow();
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
    // 2026-10-17: the super admin publishes too -- the Admin Portal is its
    // publishing surface, and PD-8 already gave it full write.
    if (!isFamilyFacingStaff(actor) && actor.staffRole !== StaffRole.SUPER_ADMIN) {
      return deny(
        CommErrorCode.STORY_CANNOT_PUBLISH,
        'only Jawwid admins, coverage admins, managers and the super admin may publish a story',
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
   * May this actor read and set a family's targeting attributes (country,
   * subscription plan)?
   *
   * The super admin and managers. These are organization-wide customer facts
   * that Jawwid Core owns, and a supervisor editing them for the families they
   * happen to supervise would make targeting depend on who typed what. A
   * supervisor still TARGETS by them: estimating and publishing a segment is
   * canPublishStory, and the estimate returns counts, never a family list.
   */
  canManageStoryAudienceData(actor: Actor): Decision {
    if (!actor.isActive) {
      return deny(CommErrorCode.ACTOR_INACTIVE, 'an inactive actor may not edit audience data');
    }
    if (
      actor.kind !== ActorKind.STAFF ||
      (actor.staffRole !== StaffRole.SUPER_ADMIN && actor.staffRole !== StaffRole.MANAGER)
    ) {
      return deny(
        CommErrorCode.STORY_AUDIENCE_DATA_DENIED,
        'only the super admin and managers may manage family audience data',
      );
    }
    if (!actor.organizationId) {
      return deny(CommErrorCode.STORY_AUDIENCE_DATA_DENIED, 'an actor with no organization cannot be scoped');
    }
    return allow();
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

  // ------------------------------------------------------------------
  // PD-21: account administration
  // ------------------------------------------------------------------

  /**
   * May `actor` reset the password of, suspend, reactivate or impersonate the
   * account `target`? Owner decision 2026-10-22 (PD-21), which widens
   * AUTHORIZATION-MODEL §3 `users.manage` from the super admin to every staff
   * role -- for PARENT and TEACHER accounts:
   *
   *   - any active staff member, any role, of the same organization;
   *   - a STAFF account only by the super admin, and never the super admin's
   *     own (its only credential writer is the bootstrap CLI);
   *   - never one's own account;
   *   - impersonation: parent (family) and teacher accounts only, never staff.
   *
   * Another tenant's account is answered as NOT FOUND, never as forbidden, so
   * the status does not reveal that the id exists elsewhere. Like the other
   * rules here this takes the target as an input and reads nothing itself.
   * The account's STATE (already suspended, ...) is the service's to check.
   *
   * An impersonation session cannot reach this at all: its actor is the
   * parent or teacher, never staff.
   */
  canAdministerAccount(actor: Actor, target: AccountAdminTarget, act: AccountAdminAct): Decision {
    if (!actor.isActive) return deny(CommErrorCode.ACTOR_INACTIVE, 'an inactive actor may not administer accounts');
    if (actor.kind !== ActorKind.STAFF || !actor.organizationId) {
      return deny(CommErrorCode.ACCOUNT_ADMIN_DENIED, 'only staff administer accounts');
    }
    if (target.organizationId !== actor.organizationId) {
      return deny(CommErrorCode.ACCOUNT_ADMIN_NOT_FOUND, 'no such account');
    }
    if (target.kind === 'staff') {
      if (target.staffId === actor.actorId) {
        return deny(CommErrorCode.ACCOUNT_ADMIN_DENIED, 'nobody administers their own account this way');
      }
      if (target.staffRole === StaffRole.SUPER_ADMIN) {
        return deny(CommErrorCode.ACCOUNT_ADMIN_DENIED, "the super admin's account is never administered from the portal");
      }
      if (actor.staffRole !== StaffRole.SUPER_ADMIN) {
        return deny(CommErrorCode.ACCOUNT_ADMIN_DENIED, "only the super admin administers a staff member's account");
      }
      if (act === 'impersonate') {
        return deny(CommErrorCode.ACCOUNT_ADMIN_DENIED, 'a staff account is never impersonated');
      }
      return allow();
    }
    if (target.kind !== 'family' && target.kind !== 'teacher') {
      return deny(CommErrorCode.ACCOUNT_ADMIN_DENIED, 'unknown account kind');
    }
    return allow();
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

  /**
   * May this actor decide held messages in a conversation? PD-8: whoever is in
   * charge of it -- the responsible supervisor, their active backup, their
   * department manager, the super admin. `basis` is the actor's resolved scope
   * basis on the conversation; `undefined` asks only "may you decide at all"
   * (the queue gate), which every conversation-staff member passes.
   */
  canApprove(actor: Actor, basis?: StaffAccessBasis | null): Decision {
    // JC-006: every public method is independently safe -- a deactivated
    // manager decides nothing, whichever caller forgot to check first.
    if (!actor.isActive) return deny(CommErrorCode.ACTOR_INACTIVE, 'an inactive actor may not decide approvals');
    if (!isConversationStaff(actor)) {
      return deny(CommErrorCode.CANNOT_APPROVE, 'only Jawwid admins may decide approvals');
    }
    if (basis === undefined) return allow();
    if (
      basis === StaffAccessBasis.RESPONSIBLE ||
      basis === StaffAccessBasis.BACKUP ||
      basis === StaffAccessBasis.MANAGER ||
      basis === StaffAccessBasis.SUPER_ADMIN
    ) {
      return allow();
    }
    return deny(CommErrorCode.CANNOT_APPROVE, "only the children's supervisor, their backup or manager may decide");
  }

  // ------------------------------------------------------------------
  // Organization structure (PD-8)
  // ------------------------------------------------------------------

  /**
   * Departments: creating them, naming their manager, placing supervisors in
   * them. That is the shape of the organization itself -- super admin only.
   */
  canManageDepartments(actor: Actor, target: { organizationId: string }): Decision {
    return this.orgAuthority(actor, target.organizationId, (a) => a.staffRole === StaffRole.SUPER_ADMIN, 'change departments');
  }

  /**
   * Assigning a child to a supervisor. The super admin, or the manager of the
   * department BOTH supervisors belong to -- the new one and, if the child has
   * one, the current one -- so a manager can neither pull a child out of
   * another department nor push one into it. `actsForNew` / `actsForCurrent`
   * are chat.staff_acts_for(actor, supervisor), resolved by the caller.
   */
  canAssignSupervision(
    actor: Actor,
    target: { organizationId: string; actsForNew: ActsFor; currentSupervisorId: string | null; actsForCurrent: ActsFor },
  ): Decision {
    return this.orgAuthority(
      actor,
      target.organizationId,
      (a) =>
        a.staffRole === StaffRole.SUPER_ADMIN ||
        (a.staffRole === StaffRole.MANAGER &&
          target.actsForNew === 'manager' &&
          (target.currentSupervisorId === null || target.actsForCurrent === 'manager')),
      'assign learners to supervisors',
    );
  }

  /**
   * Creating, activating, deactivating or ending a backup link for `primary`.
   * The super admin, or the manager of the primary's department.
   */
  canConfigureBackup(actor: Actor, target: { organizationId: string; actsForPrimary: ActsFor }): Decision {
    return this.orgAuthority(
      actor,
      target.organizationId,
      (a) => a.staffRole === StaffRole.SUPER_ADMIN || (a.staffRole === StaffRole.MANAGER && target.actsForPrimary === 'manager'),
      'configure backup supervisors',
    );
  }

  /** Reading the structure: the super admin (all of it) and managers (their department). */
  /**
   * PD-10: what this actor may see and change in a Teacher File. The caller
   * resolves the actor's relation to the Teachers department; the matrix is in
   * teacher-file-policy.ts.
   */
  teacherFileAccess(
    actor: Actor,
    target: { organizationId: string; teachersDepartmentRole: TeachersDepartmentRole },
  ): TeacherFileAccess {
    return decideTeacherFileAccess(actor, target);
  }

  canViewOrgStructure(actor: Actor): Decision {
    if (!actor.isActive) return deny(CommErrorCode.ACTOR_INACTIVE, 'an inactive actor may not view the structure');
    if (
      actor.kind !== ActorKind.STAFF ||
      !actor.organizationId ||
      (actor.staffRole !== StaffRole.SUPER_ADMIN && actor.staffRole !== StaffRole.MANAGER)
    ) {
      return deny(CommErrorCode.ORG_STRUCTURE_DENIED, 'only managers and the super admin may view the organization structure');
    }
    return allow();
  }

  // ------------------------------------------------------------------
  // PD-9 / PD-11: lessons
  // ------------------------------------------------------------------

  /**
   * How `actor` stands to one lesson, or null when they may not see it at all
   * (which the caller answers as not found). Facts are resolved by
   * LessonService: `teachersDepartment` -- the actor manages or belongs to the
   * organization's Teachers department; `supervisesLearner` -- the learner's
   * PD-8 supervisor is one of the actor's principals.
   */
  lessonStanding(
    actor: Actor,
    lesson: { organizationId: string; teacherId: string; familyId: string },
    facts: { teachersDepartment: boolean; supervisesLearner: boolean },
  ): LessonStanding | null {
    if (!actor.isActive || !actor.organizationId || actor.organizationId !== lesson.organizationId) return null;
    switch (actor.kind) {
      case ActorKind.STAFF:
        if (actor.staffRole === StaffRole.SUPER_ADMIN || facts.teachersDepartment) return 'manager';
        return facts.supervisesLearner ? 'supervisor' : null;
      case ActorKind.TEACHER:
        return actor.actorId === lesson.teacherId ? 'teacher' : null;
      case ActorKind.CONTACT:
        return actor.familyId === lesson.familyId ? 'family' : null;
      default:
        return null;
    }
  }

  /**
   * Whether `standing` may record `act` on a lesson. WHO, never WHEN: whether
   * the lesson's state and the clock allow it is LessonService's pre-check and,
   * authoritatively, chat.guard_lesson's.
   */
  canRecordLessonAct(actor: Actor, standing: LessonStanding | null, act: LessonAct): Decision {
    if (standing === null) return deny(CommErrorCode.LESSON_NOT_FOUND, 'lesson not found');
    if (!LESSON_ACTS[act].includes(standing)) {
      return deny(CommErrorCode.LESSON_DENIED, `${standing} may not record ${act} on a lesson`);
    }
    if (standing === 'family' && actor.canMessage === false) {
      return deny(CommErrorCode.LESSON_DENIED, 'this contact may not act for the family');
    }
    return allow();
  }

  /** Scheduling lessons and reading the needs-action list: the super admin and the Teachers department. */
  canManageLessons(actor: Actor, organizationId: string, facts: { teachersDepartment: boolean }): Decision {
    return this.orgAuthority(
      actor,
      organizationId,
      (a) => a.staffRole === StaffRole.SUPER_ADMIN || facts.teachersDepartment,
      'manage lessons',
    );
  }

  private orgAuthority(actor: Actor, organizationId: string, permitted: (a: Actor) => boolean, what: string): Decision {
    if (!actor.isActive) return deny(CommErrorCode.ACTOR_INACTIVE, `an inactive actor may not ${what}`);
    if (actor.kind !== ActorKind.STAFF || !actor.organizationId || actor.organizationId !== organizationId) {
      return deny(CommErrorCode.ORG_STRUCTURE_DENIED, `only staff of this organization may ${what}`);
    }
    if (!permitted(actor)) return deny(CommErrorCode.ORG_STRUCTURE_DENIED, `${actor.staffRole} may not ${what}`);
    return allow();
  }

  /**
   * D1 (PD-A, ported from 33a347a). Whoever STARTS a call must be one of the
   * participants it rings -- a live member of the conversation. Since PD-8 a
   * department manager, an active backup or the super admin may send into a
   * conversation without being a member; through canCall they could otherwise
   * start a call that rings everyone else while they hold no seat in it (a
   * phantom call). Joining is unaffected: it already requires a participant row.
   *
   * PD-19 amendment (2026-10-21): the SUPER ADMIN may start a GROUP call in a
   * conversation they are not a member of, and CallService then gives them a
   * seat on that call -- a call participant row, not chat membership. That keeps
   * D1's point (the caller is on the call they start). A 1:1 between two other
   * people stays refused: a direct call has exactly two seats (the database
   * enforces it). Managers and backups are unchanged.
   *
   * Second amendment (2026-10-22): "group" here means every conversation whose
   * call is a GROUP call (GROUP_CALL_CONVERSATION_TYPES), so the teacher's trial
   * group and supervision conversation are included.
   */
  canStartCallAsParticipant(
    actor: Pick<Actor, 'actorId' | 'kind' | 'staffRole'>,
    participants: ReadonlyArray<Pick<Actor, 'actorId'>>,
    conv: Pick<Conv, 'type'>,
  ): Decision {
    if (participants.some((p) => p.actorId === actor.actorId)) return allow();
    if (
      actor.kind === ActorKind.STAFF &&
      actor.staffRole === StaffRole.SUPER_ADMIN &&
      GROUP_CALL_CONVERSATION_TYPES.has(conv.type)
    ) {
      return allow();
    }
    return deny(CommErrorCode.NOT_CONVERSATION_MEMBER, 'the caller would not be a participant of this call');
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
    /** Which question the caller is asking: start a call, or join one. Since
     *  PD-19 no rule answers them differently; callers still say which, so a
     *  future start-only rule has exactly one place to go. */
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
     * PD-19 (2026-10-21, supersedes PD-2). Every member who may speak in a
     * conversation may also start a call in it -- a parent included, in their
     * family's group. There is no start-only refusal any more: whoever reaches
     * this point has passed canSend (membership, scope, C-4 admin presence) and
     * the BR-1 refusal above, and D1 in CallService still requires the caller
     * to be a live member. Chats a person is not a member of are unchanged.
     */
    return allow();
  }
}
