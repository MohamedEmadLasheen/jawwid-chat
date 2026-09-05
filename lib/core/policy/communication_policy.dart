import '../../shared/models/user_role.dart';

/// Client-side expression of the product's hard communication rule.
///
/// > Teacher and Parent communicate ONLY inside the official Student Group.
///
/// This exists so that no forbidden affordance is ever rendered. It is **defence in depth
/// only**: the backend remains the authority and must reject a forbidden action even if a
/// client somehow requests it (see `docs/mobile/backend-dependencies.md` §1).
///
/// Deliberately written as a total function over the pair of roles rather than as scattered
/// `if` checks in widgets, so that the rule has exactly one home and can be exhaustively
/// tested.
abstract final class CommunicationPolicy {
  /// Whether [viewer] may hold a 1:1 conversation with a participant of role [other].
  static bool allowsDirectConversation(UserRole viewer, ParticipantRole other) {
    return switch ((viewer, other)) {
      // The forbidden pairing, in both directions.
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
