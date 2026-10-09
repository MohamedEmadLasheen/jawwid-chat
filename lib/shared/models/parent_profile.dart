/// The signed-in parent's own account, exactly as `GET /me/profile` returns it.
///
/// ## What this deliberately does not carry
///
/// No phone, no email, no address. `chat.contact` has no such column and the server sends
/// no such field, so modelling one here would be inventing a contact file the product does
/// not have — and a profile that cannot hold a phone number cannot leak one. The privacy
/// guard in `test/design/directionality_guard_test.dart` enforces that for the whole client.
///
/// [signInIdentity] is the one identity-shaped string there is: the account's LOGIN
/// SUBJECT. It is displayed read-only and there is no API that writes it, because changing
/// an authentication identity is not a profile edit.
///
/// ## Why avatars are URLs and never keys
///
/// [avatarUrl] arrives signed and short-lived, minted by the server per request for a
/// person the caller is already permitted to see. The client never holds a bucket name, a
/// storage path or an object key, so it cannot construct a read it was not granted.
class ParentProfile {
  const ParentProfile({
    required this.displayName,
    required this.children,
    this.relationship,
    this.signInIdentity,
    this.avatarUrl,
    this.canMessage = true,
  });

  final String displayName;

  /// "Mother", "Father", "Guardian" — as the academy recorded it. May be absent.
  final String? relationship;

  /// The account's sign-in subject. Read-only, always.
  final String? signInIdentity;

  /// Signed and short-lived. Null means no photo, which is a normal state and not an error.
  final String? avatarUrl;

  final bool canMessage;

  /// The learners of this parent's family. Server-scoped: the client never filters.
  final List<ChildProfile> children;

  bool get hasPhoto => (avatarUrl ?? '').isNotEmpty;
}

/// One child, as their parent may see and manage them.
///
/// Carries no academic field a parent could be tempted to edit — no teacher, no schedule,
/// no subscription. [level] is informational and read-only; [id] exists only so a photo
/// change can name which child it is for, and the server re-checks that against the
/// caller's own family on every call.
class ChildProfile {
  const ChildProfile({
    required this.id,
    required this.displayName,
    this.level,
    this.avatarUrl,
  });

  final String id;
  final String displayName;
  final String? level;
  final String? avatarUrl;

  bool get hasPhoto => (avatarUrl ?? '').isNotEmpty;
}
