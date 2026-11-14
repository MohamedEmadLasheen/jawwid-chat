/// LR-09j: the device side of the host capture handshake.
///
/// `integration_test`'s own screenshot copies only the app's view, so it has no
/// system status bar. The store shots are therefore taken on the HOST by the
/// platform tool (`xcrun simctl io <udid> screenshot`, `adb exec-out screencap -p`),
/// which captures the whole screen, status bar included.
///
/// The test and the host driver (`test_driver/integration_test.dart`) talk over a
/// VM service extension, [HostCapture.extension]:
///
/// 1. `hello` (driver -> device, once): says whether the driver captures with the
///    platform tool (`capture=platform`) or not (`capture=none`, e.g. a run by hand).
/// 2. `next` (driver -> device, a long poll): answers with the name of the screen
///    that is ready and waiting to be captured, or no name after a few seconds.
/// 3. `done` (driver -> device): the capture of that name finished, `ok=true` or
///    `ok=false`.
///
/// [HostCapture.capture] publishes a name and waits (drawing nothing new) for its
/// `done`. It returns false -- and the test then takes the in-app screenshot as
/// the fallback -- when the driver does not capture, the capture failed, or no
/// answer came in time.
library;

import 'dart:async';
import 'dart:convert';
import 'dart:developer' as developer;

class HostCapture {
  HostCapture._();

  static final HostCapture instance = HostCapture._();

  /// Must match `test_driver/integration_test.dart`.
  static const String extension = 'ext.jawwid.storeShots';

  bool _registered = false;

  /// True once the driver said it captures with the platform tool; false once it
  /// said it does not, or stopped answering. Null until then.
  bool? _hostCaptures;
  _Pending? _pending;

  /// Registers the service extension. Once per isolate; safe to call again.
  void register() {
    if (_registered) return;
    _registered = true;
    developer.registerExtension(extension, _handle);
  }

  /// Waits for the host to capture [name] (`<platform>/<lang>/<screen>`).
  /// True if it did; false if the caller must fall back to the in-app capture.
  Future<bool> capture(
    String name, {
    Duration helloTimeout = const Duration(seconds: 60),
    Duration timeout = const Duration(seconds: 60),
  }) async {
    // The test starts before the driver connects: give it time to say hello.
    final helloBy = DateTime.now().add(helloTimeout);
    while (_hostCaptures == null && DateTime.now().isBefore(helloBy)) {
      await Future<void>.delayed(const Duration(milliseconds: 100));
    }
    if (_hostCaptures != true) {
      _hostCaptures = false;
      return false;
    }

    final pending = _Pending(name);
    _pending = pending;
    try {
      return await pending.result.future.timeout(timeout);
    } on TimeoutException {
      // The host stopped answering: every later shot goes straight to the fallback.
      _hostCaptures = false;
      return false;
    } finally {
      if (identical(_pending, pending)) _pending = null;
    }
  }

  Future<developer.ServiceExtensionResponse> _handle(String method, Map<String, String> params) async {
    switch (params['command']) {
      case 'hello':
        _hostCaptures ??= params['capture'] == 'platform';
        return _ok(<String, Object?>{'hostCaptures': _hostCaptures});
      case 'next':
        final until = DateTime.now().add(const Duration(seconds: 5));
        while (_waiting == null && DateTime.now().isBefore(until)) {
          await Future<void>.delayed(const Duration(milliseconds: 100));
        }
        return _ok(<String, Object?>{'name': _waiting?.name});
      case 'done':
        final pending = _waiting;
        if (pending != null && pending.name == params['name']) {
          _pending = null;
          pending.result.complete(params['ok'] == 'true');
        }
        return _ok(const <String, Object?>{});
      default:
        return developer.ServiceExtensionResponse.error(
          developer.ServiceExtensionResponse.invalidParams,
          'unknown command ${params['command']}',
        );
    }
  }

  /// The published name, unless its wait already ended (answered or timed out).
  _Pending? get _waiting {
    final pending = _pending;
    return pending != null && !pending.result.isCompleted ? pending : null;
  }

  static developer.ServiceExtensionResponse _ok(Map<String, Object?> body) =>
      developer.ServiceExtensionResponse.result(jsonEncode(body));
}

class _Pending {
  _Pending(this.name);

  final String name;
  final Completer<bool> result = Completer<bool>();
}
