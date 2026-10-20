/// The signed-in parent's own profile, and their children's.
///
/// ## What is NOT in here
///
/// No phone and no email. `chat.contact` has never had a contact file, and a profile that
/// cannot render a phone number is one that cannot leak one — see the privacy guard in
/// `test/design/directionality_guard_test.dart`. Adding a photo and an About must not become
/// the moment that boundary quietly moves.
///
/// ## The name is not duplicated here either
///
/// [displayName] is read from the server's authoritative identity row on every fetch, never
/// cached separately and never written back from a local copy. The server owns it, so a
/// rename made here is visible to the chat list and the message author the moment it saves,
/// and this model cannot drift from them.
class ParentProfile {
  const ParentProfile({
    required this.displayName,
    required this.children,
    this.relationship,
    this.signInIdentity,
    this.about,
    this.avatarUrl,
    this.canMessage = true,
  });

  final String displayName;

  /// "Mother", "Father", "Guardian" — as the academy recorded it. May be absent.
  final String? relationship;

  /// The account's sign-in subject. Read-only, always: changing how somebody authenticates
  /// is not a profile edit, and no route here can write it.
  final String? signInIdentity;

  /// The parent's own words about themselves. Null means they have written none — which is
  /// different from an empty string, and is why a cleared About comes back as null.
  final String? about;

  /// A short-lived SIGNED url, or null for "no photo".
  ///
  /// Never persisted and never treated as identity: it expires, and the next read of the
  /// profile brings a freshly signed one. Null draws the initials, which is what every
  /// parent looked like before this feature.
  final String? avatarUrl;

  final bool canMessage;

  final List<ChildProfile> children;

  bool get hasPhoto => (avatarUrl ?? '').isNotEmpty;
  bool get hasAbout => (about ?? '').trim().isNotEmpty;
}

/// One child of the signed-in parent's family.
class ChildProfile {
  const ChildProfile({
    required this.id,
    required this.displayName,
    this.level,
    this.about,
    this.avatarUrl,
  });

  /// Addressable so the screen can target an edit at the right child. Not a secret, and not
  /// an authority: the server resolves it only inside the caller's own family.
  final String id;
  final String displayName;
  final String? level;
  final String? about;
  final String? avatarUrl;

  bool get hasPhoto => (avatarUrl ?? '').isNotEmpty;
  bool get hasAbout => (about ?? '').trim().isNotEmpty;
}
