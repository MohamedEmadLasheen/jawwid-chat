/// PD-23: one live sign-in of the signed-in account, as `GET /me/sessions` reports it.
///
/// A row in "Devices & sessions". It describes a device the account is signed in on; it
/// carries no credential and nothing here can act on the session except by its [id], which
/// the server re-authorizes on every request (it only ever revokes the caller's own rows).
class AccountSession {
  const AccountSession({
    required this.id,
    required this.current,
    required this.platform,
    required this.signedInAt,
    required this.expiresAt,
    this.deviceName,
    this.appVersion,
    this.lastSeenAt,
    this.remembered = false,
  });

  final String id;

  /// The session this very request was made with: "This device".
  final bool current;

  /// Null when the device never described itself (an old build, a web sign-in that sent
  /// nothing). Never guessed.
  final SessionPlatform? platform;

  /// What the device called itself at sign-in ("iPhone 17 Pro"). Null when it said nothing.
  final String? deviceName;

  final String? appVersion;
  final DateTime signedInAt;

  /// Null when the session has not been used since it was issued.
  final DateTime? lastSeenAt;

  final DateTime expiresAt;

  /// Signed in with "remember this device" (a long-lived session).
  final bool remembered;
}

/// `SessionDto.platform`. Anything else the server might add later is read as null --
/// "unknown device" -- rather than as one of these.
enum SessionPlatform {
  ios,
  android,
  web;

  static SessionPlatform? tryParse(Object? raw) => switch (raw) {
        'ios' => SessionPlatform.ios,
        'android' => SessionPlatform.android,
        'web' => SessionPlatform.web,
        _ => null,
      };
}

/// The contract's order: the current session first, then the most recently used. Applied on
/// the client too, so a server that sends them in another order cannot bury "This device".
List<AccountSession> orderSessions(Iterable<AccountSession> sessions) {
  final list = sessions.toList();
  list.sort((a, b) {
    if (a.current != b.current) return a.current ? -1 : 1;
    final aSeen = a.lastSeenAt ?? a.signedInAt;
    final bSeen = b.lastSeenAt ?? b.signedInAt;
    return bSeen.compareTo(aSeen);
  });
  return list;
}
