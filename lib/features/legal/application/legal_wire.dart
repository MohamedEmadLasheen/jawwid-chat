import 'dart:async';

import '../../../core/errors/app_error.dart';
import '../../../shared/models/legal.dart';

/// PD-58: the one wire along which the transport tells the session about the Terms of Use.
///
/// Like `SessionTermination`, it exists because the transport (built in the composition root)
/// learns first and `AuthController` (built inside the Riverpod container) is what holds the
/// identity the legal gate reads. The root builds this, hands the write end to `ApiClient`,
/// `StoredTokenProvider` and the password change, and the controller binds itself on build.
///
/// Two things travel on it:
///  * [report] -- a token pair's `legal` block (refresh, password change);
///  * [refused] -- a 403 `COMM.TERMS_NOT_ACCEPTED` from ANY route. The controller refreshes
///    the identity, and the gate appears: one place, not one per screen.
///
/// It holds no state of its own, and anything arriving before a controller is bound is
/// dropped -- there is no identity to correct yet.
class LegalWire {
  void Function(LegalStatus legal)? _report;
  Future<void> Function(AppError error)? _refused;

  bool get isBound => _report != null || _refused != null;

  /// Called by `AuthController` on build. A rebuilt controller supersedes the old one.
  void bind({required void Function(LegalStatus legal) report, required Future<void> Function(AppError error) refused}) {
    _report = report;
    _refused = refused;
  }

  /// Only the current holder may release it (tear-offs compared with `==`, as in
  /// `SessionTermination.unbind`).
  void unbind(void Function(LegalStatus legal) report) {
    if (_report == report) {
      _report = null;
      _refused = null;
    }
  }

  void report(LegalStatus legal) => _report?.call(legal);

  /// Never awaited by the transport: the refused request fails to its caller as before.
  void refused(AppError error) {
    final handler = _refused;
    if (handler != null) unawaited(handler(error));
  }
}
