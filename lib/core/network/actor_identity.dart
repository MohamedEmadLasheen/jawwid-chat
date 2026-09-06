import 'package:flutter/foundation.dart';

/// How the client tells the server who it is.
///
/// ## Why this is not just an auth token
///
/// The backend has **no authentication yet**. `apps/api/src/communication/api/actor.decorator.ts`
/// reads a plaintext `x-actor-id` request header and says so itself:
///
/// > *"Today it is read from a header so the engine is runnable and testable before auth
/// > lands. When AI #1 provides a guard, this decorator reads `request.user.actorId`
/// > instead."*
///
/// A client that asserts its own identity in a header is not authenticated — it is asking to
/// be trusted. That is exactly what "the client must never manufacture authorization
/// decisions" forbids, so this seam is:
///
/// * **off unless explicitly switched on** at build time, and
/// * **compiled out of release builds entirely** by the `kDebugMode` guard below.
///
/// It exists so the transport can be exercised against a locally running engine during
/// bring-up. It is not an authentication mechanism and must never be one.
///
/// When AI #1 publishes the auth contract, [BearerTokenIdentity] becomes the only
/// implementation and this one is deleted.
abstract interface class ActorIdentity {
  /// Headers to attach to every request. Empty when the caller is anonymous.
  Future<Map<String, String>> headers();
}

/// The real mechanism, once auth exists: a bearer token from secure storage.
///
/// `ApiClient` already attaches `Authorization` from the token provider, so this is the
/// no-extra-headers case.
class BearerTokenIdentity implements ActorIdentity {
  const BearerTokenIdentity();

  @override
  Future<Map<String, String>> headers() async => const {};
}

/// Development-only bring-up seam. See the class docs above.
///
/// Guarded twice: the header is emitted only when [enabled] was explicitly set **and** the
/// build is a debug build. In a release build this returns nothing regardless of
/// configuration.
class DebugActorHeaderIdentity implements ActorIdentity {
  const DebugActorHeaderIdentity({required this.actorId, this.enabled = false});

  static const headerName = 'x-actor-id';

  final String actorId;
  final bool enabled;

  bool get isActive => enabled && kDebugMode && actorId.isNotEmpty;

  @override
  Future<Map<String, String>> headers() async =>
      isActive ? {headerName: actorId} : const {};
}
