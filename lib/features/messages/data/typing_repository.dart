import '../../../core/network/api_client.dart';

/// PD-37: "this person is typing here" -- over HTTP, because the app's realtime
/// transport only receives. The server applies exactly the socket's rules: a
/// seated member only, never in a direct teacher<->parent conversation, heard
/// by seated members only.
abstract interface class TypingRepository {
  bool get isAvailable;

  /// `true` while the draft changes (throttled by TypingSender), `false` to stop.
  Future<void> typing(String conversationId, bool typing);
}

/// A harmless default: a build without the route says nothing.
class NoTypingRepository implements TypingRepository {
  const NoTypingRepository();

  @override
  bool get isAvailable => false;

  @override
  Future<void> typing(String conversationId, bool typing) async {}
}

class HttpTypingRepository implements TypingRepository {
  HttpTypingRepository({required ApiClient client}) : _client = client;

  final ApiClient _client;

  @override
  bool get isAvailable => true;

  @override
  Future<void> typing(String conversationId, bool typing) =>
      _client.post<Object?>('/conversations/$conversationId/typing', data: {'typing': typing});
}
