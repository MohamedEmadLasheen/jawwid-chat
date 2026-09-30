/// A system event, as the backend now publishes it.
///
/// ## Why this type exists
///
/// A system message used to arrive as a `body` containing the backend's own
/// payload — `{"kind":"group.created","learner":"Adam QA"}` — and the chat
/// screen rendered `body` the way it renders every other message. So a parent
/// opening their child's group was shown a JSON object.
///
/// The payload was never the problem; presenting it as prose was. The contract
/// now carries `systemEvent: { kind, params }` and nulls the body, so there is
/// no longer a field through which a payload can reach a screen. This type is
/// the client half of that: structured data in, a localised sentence out.
///
/// ## Why the kind is a String and not an enum
///
/// The backend may add an event kind at any time, and a client that models
/// kinds as a closed set has two bad options when it meets a new one — crash,
/// or silently drop a message the group can see happened. Keeping it open lets
/// [SystemEventText] answer "I do not know this one" explicitly, which is a
/// rendering decision rather than a parsing failure.
class SystemEvent {
  const SystemEvent({required this.kind, this.params = const {}});

  /// The backend's event name, e.g. `group.created`. Never shown to a user.
  final String kind;

  /// The event's parameters, already stringified by the server.
  final Map<String, String> params;

  /// Read one parameter, or null when it is absent or blank.
  ///
  /// Null rather than an empty string because a missing parameter must be able
  /// to change the sentence — "2 people joined" and "somebody joined" are
  /// different sentences, and an empty string would silently produce neither.
  String? param(String key) {
    final value = params[key]?.trim();
    return (value == null || value.isEmpty) ? null : value;
  }

  /// Parse one, or null when the payload is not a system event.
  ///
  /// Total and forgiving, exactly like the server-side parser it mirrors: a
  /// malformed payload costs one unrendered line, never an exception on the
  /// whole conversation.
  static SystemEvent? fromJson(Object? json) {
    if (json is! Map) return null;
    final kind = json['kind'];
    if (kind is! String || kind.trim().isEmpty) return null;

    final raw = json['params'];
    final params = <String, String>{};
    if (raw is Map) {
      for (final entry in raw.entries) {
        final key = entry.key;
        final value = entry.value;
        if (key is String && value is String) params[key] = value;
      }
    }
    return SystemEvent(kind: kind, params: params);
  }
}
