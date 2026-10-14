import '../../shared/models/user_role.dart';

/// Client-side expression of which affordances this build offers, by role pair.
///
/// **PD-7 (2026-10-14) restored BR-1 and superseded PD-6:**
///
/// > Teacher and Parent communicate ONLY inside the official Student Group.
///
/// The server refuses every direct teacher<->parent conversation and call with
/// `COMM.BR1_TEACHER_PARENT_DIRECT`, whatever the relationship, so the two refusals
/// below again mean "the product forbids this". The rest of this note is the PD-6
/// reasoning, kept because the code it explains did not have to change:
///
/// Under PD-6 (2026-09-23, superseded) an authorized parent and teacher could hold a direct
/// conversation and a direct call — but *authorized* is a property of the relationship
/// between two specific people, resolved by the server from Jawwid Core data. **A pair of
/// roles cannot express it.** `(parent, teacher)` is no longer a decidable question at this
/// altitude, and any answer this function invents would be a guess.
///
/// So the refusals below are kept exactly as they were, and their meaning changes from
/// "the product forbids this" to "this client cannot establish that it is allowed, and
/// therefore does not offer it". That is the same fail-closed behaviour and none of the
/// false confidence.
///
/// **A client that wants to offer the parent<->teacher affordance must be told, per
/// conversation, by the server** — `ConversationKind.teacherParentDirect`, which is set
/// only when the payload states the participants. It must not be derived from a role pair,
/// a conversation type, a title or an id. That work belongs with the call UI; until then
/// this build offers nothing, which is correct and merely incomplete.
///
/// It remains **defence in depth only**: the backend is the authority and refuses the
/// pairing (`COMM.BR1_TEACHER_PARENT_DIRECT` since PD-7) whatever any client believes or
/// requests.
///
/// Deliberately written as a total function over the pair of roles rather than as scattered
/// `if` checks in widgets, so that the rule has exactly one home and can be exhaustively
/// tested.
abstract final class CommunicationPolicy {
  /// Whether [viewer] may hold a 1:1 conversation with a participant of role [other].
  static bool allowsDirectConversation(UserRole viewer, ParticipantRole other) {
    return switch ((viewer, other)) {
      // PD-7: forbidden (BR-1). Under PD-6 this was "undecidable from roles alone";
      // either way this client offers nothing. See the class doc.
      (UserRole.parent, ParticipantRole.teacher) => false,
      (UserRole.teacher, ParticipantRole.parent) => false,

      // Both roles may talk 1:1 to Jawwid staff.
      (_, ParticipantRole.admin) => true,

      // Never a 1:1 with the system actor, another parent, or an unknown role.
      (_, ParticipantRole.system) => false,
      (_, ParticipantRole.parent) => false,
      (_, ParticipantRole.teacher) => false,
      (_, ParticipantRole.unknown) => false,
    };
  }

  /// Whether [viewer] may place a 1:1 call to a participant of role [other].
  ///
  /// Calling is never more permissive than messaging.
  static bool allowsDirectCall(UserRole viewer, ParticipantRole other) =>
      allowsDirectConversation(viewer, other);

  /// Whether a "message this member" affordance may be shown for a member of a student
  /// group. Group membership must never become a directory (§25), so this is the same
  /// rule — being in a group together grants no 1:1 channel.
  static bool allowsDirectContactFromGroupMember(
    UserRole viewer,
    ParticipantRole member,
  ) =>
      allowsDirectConversation(viewer, member);
}
