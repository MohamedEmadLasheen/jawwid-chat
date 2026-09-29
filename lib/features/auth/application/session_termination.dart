import 'dart:async';

import '../../../core/errors/app_error.dart';

/// The one wire along which "this session is over" travels from the transport to the app.
///
/// ## Why a wire rather than a direct call
///
/// The transport learns first. `ApiClient` is what sees `AUTH.SESSION_REVOKED` on a
/// background refresh of the conversation list, and a refusal seen there has to end the
/// session as completely as one seen at launch — tokens cleared, principal forgotten, state
/// moved, router evicted.
///
/// But the transport is built in the composition root, and [AuthController] lives inside the
/// Riverpod container that is constructed *with* that root's overrides. Neither can hold a
/// reference to the other at construction time. So the root builds this, hands the
/// write-end to `StoredTokenProvider` and the read-end to the controller, and the controller
/// binds itself when Riverpod first builds it.
///
/// ## What it is not
///
/// It is not a second session authority and it holds no state of its own. It owns one
/// nullable function. Everything destructive still happens in exactly one place,
/// `AuthController`, which is what makes "who ends a session?" answerable with one name.
class SessionTermination {
  Future<void> Function(AppError error)? _handler;

  /// True once a listener exists. Used by tests and by nothing else.
  bool get isBound => _handler != null;

  /// Called by [AuthController] on build. Replacing an existing binding is intentional: a
  /// rebuilt controller must supersede the old one rather than leave the wire pointing at a
  /// disposed notifier.
  void bind(Future<void> Function(AppError error) handler) => _handler = handler;

  void unbind(Future<void> Function(AppError error) handler) {
    // Only the current holder may release it, so a late dispose from a superseded controller
    // cannot silently disconnect the live one.
    if (identical(_handler, handler)) _handler = null;
  }

  /// Report that the backend has ended this session.
  ///
  /// Safe before anything is bound — a terminal refusal that arrives before the controller
  /// exists is dropped rather than thrown, because there is no session state to correct yet
  /// and an error path must never itself throw.
  Future<void> end(AppError error) async => _handler?.call(error);
}
