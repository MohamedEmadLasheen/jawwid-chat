/// The roles this mobile client can be authenticated as.
///
/// The value is always server-asserted (see `docs/mobile/decisions.md` D3); a locally
/// cached role is never trusted for an authorization decision.
enum UserRole {
  parent,
  teacher;

  static UserRole? tryParse(String? raw) => switch (raw) {
        'parent' => UserRole.parent,
        'teacher' => UserRole.teacher,
        _ => null,
      };

  String get wireValue => name;
}

/// Roles that may appear as *other participants* in a conversation the user can see.
///
/// This is display-only. It is deliberately wider than [UserRole] because a parent may
/// see an admin in a group, but the app can never authenticate as one.
enum ParticipantRole {
  parent,
  teacher,
  admin,
  system,
  unknown;

  static ParticipantRole parse(String? raw) => switch (raw) {
        'parent' => ParticipantRole.parent,
        'teacher' => ParticipantRole.teacher,
        'admin' || 'coverage' || 'manager' => ParticipantRole.admin,
        'system' => ParticipantRole.system,
        _ => ParticipantRole.unknown,
      };
}
