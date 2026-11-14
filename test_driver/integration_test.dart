/// LR-09j: the host side of `flutter drive` for the store screenshots.
///
/// Each screen is saved as `$JAWWID_SCREENSHOT_DIR/<platform>/<lang>/<name>.png`
/// (default folder `build/store_screenshots`, not committed), in one of two ways:
///
/// * **platform** (normal): when the test reaches a screen it waits there, this
///   driver captures the whole device screen with the platform tool --
///   `xcrun simctl io <udid> screenshot` or `adb -s <serial> exec-out screencap -p`
///   -- and tells the test it is done. This includes the system status bar.
///   `scripts/store-screenshots/capture.sh` turns it on by setting
///   `JAWWID_SHOT_TOOL` (`ios` | `android`), `JAWWID_SHOT_DEVICE` (the simulator
///   UDID or the emulator serial) and, for Android, `JAWWID_ADB`.
/// * **in-app** (fallback): if the platform capture fails, or those variables are
///   not set (a run by hand), the test takes `integration_test`'s own screenshot
///   (the app's view only, no status bar) and this driver saves its bytes.
///
/// Which one was used for each file is appended to
/// `<platform>/capture-methods.txt` as `<file>\t<platform|in-app>`.
/// The handshake is described in `integration_test/host_capture.dart`.
library;

import 'dart:async';
import 'dart:io';

// flutter_driver comes with the SDK through integration_test (it is in
// pubspec.lock); the FlutterDriver is needed to reach the test's extension.
// ignore: depend_on_referenced_packages
import 'package:flutter_driver/flutter_driver.dart';
import 'package:integration_test/integration_test_driver_extended.dart';

/// Must match `HostCapture.extension` in `integration_test/host_capture.dart`.
const _extension = 'ext.jawwid.storeShots';

/// Only the names the test builds: letters, digits, '_', '-' and '/'. Nothing the
/// device sends can write outside the output folder.
final _validName = RegExp(r'^[A-Za-z0-9_\-]+(/[A-Za-z0-9_\-]+)*$');

Future<void> main() async {
  final root = Platform.environment['JAWWID_SCREENSHOT_DIR'] ?? 'build/store_screenshots';
  final driver = await FlutterDriver.connect();
  final capture = _PlatformCapture.fromEnvironment();

  // Runs beside integrationDriver, which exits the process when the tests end.
  unawaited(_serveHostCaptures(driver, capture, root));

  await integrationDriver(
    driver: driver,
    onScreenshot: (String name, List<int> image, [Map<String, Object?>? args]) async {
      if (!_validName.hasMatch(name)) return false;
      final file = File('$root/$name.png');
      await file.parent.create(recursive: true);
      await file.writeAsBytes(image);
      await _record(root, name, 'in-app');
      return true;
    },
  );
}

/// Answers the test's "this screen is ready" with a platform capture.
Future<void> _serveHostCaptures(FlutterDriver driver, _PlatformCapture? capture, String root) async {
  Future<Map<String, Object?>> call(Map<String, String> args) async {
    final response = await driver.serviceClient.callServiceExtension(
      _extension,
      isolateId: driver.appIsolate.id,
      args: args,
    );
    return response.json ?? const <String, Object?>{};
  }

  // The app registers the extension at start; retry briefly in case it is not
  // there yet.
  for (var attempt = 0; ; attempt++) {
    try {
      await call({'command': 'hello', 'capture': capture == null ? 'none' : 'platform'});
      break;
    } on Object catch (error) {
      if (attempt >= 30) {
        stderr.writeln('screenshots: the test did not answer ($error); it will use the in-app capture');
        return;
      }
      await Future<void>.delayed(const Duration(seconds: 1));
    }
  }
  if (capture == null) {
    stdout.writeln('screenshots: no platform tool configured; using the in-app capture (no status bar)');
    return;
  }
  stdout.writeln('screenshots: capturing with ${capture.describe()}');

  while (true) {
    final Map<String, Object?> next;
    try {
      next = await call({'command': 'next'});
    } on Object {
      return; // The app is gone: the tests have ended.
    }
    final name = next['name'];
    if (name is! String) continue;

    var ok = false;
    if (_validName.hasMatch(name)) {
      ok = await capture.take(File('$root/$name.png'));
      if (ok) await _record(root, name, 'platform');
    } else {
      stderr.writeln('screenshots: refused the name "$name"');
    }
    if (!ok) stderr.writeln('screenshots: $name: platform capture failed; the test falls back to the in-app capture');
    try {
      await call({'command': 'done', 'name': name, 'ok': '$ok'});
    } on Object {
      return;
    }
  }
}

/// Appends `<name>.png<TAB><method>` to `<root>/<platform>/capture-methods.txt`.
Future<void> _record(String root, String name, String method) async {
  final slash = name.indexOf('/');
  final platform = slash < 0 ? name : name.substring(0, slash);
  final file = File('$root/$platform/capture-methods.txt');
  await file.parent.create(recursive: true);
  await file.writeAsString('$name.png\t$method\n', mode: FileMode.append, flush: true);
}

/// The platform tool that captures the whole device screen.
class _PlatformCapture {
  _PlatformCapture._(this._tool, this._device, this._adb);

  final String _tool;
  final String _device;
  final String _adb;

  static _PlatformCapture? fromEnvironment() {
    final env = Platform.environment;
    final tool = env['JAWWID_SHOT_TOOL'] ?? '';
    final device = env['JAWWID_SHOT_DEVICE'] ?? '';
    if (device.isEmpty) return null;
    if (tool == 'ios') return _PlatformCapture._(tool, device, '');
    final adb = env['JAWWID_ADB'] ?? '';
    if (tool == 'android' && adb.isNotEmpty) return _PlatformCapture._(tool, device, adb);
    return null;
  }

  String describe() => _tool == 'ios'
      ? 'xcrun simctl io $_device screenshot (status bar included)'
      : 'adb -s $_device exec-out screencap -p (status bar included)';

  /// Writes a PNG of the whole screen to [target]. False (and [target] untouched)
  /// if the tool fails or what it returns is not a PNG.
  Future<bool> take(File target) async {
    await target.parent.create(recursive: true);
    // Written next to the target, then renamed, so a failed capture never leaves
    // a half-written PNG under the final name.
    final part = File('${target.path}.part');
    try {
      if (_tool == 'ios') {
        final result = await Process.run('xcrun', ['simctl', 'io', _device, 'screenshot', '--type=png', part.path]);
        if (result.exitCode != 0) {
          stderr.writeln('screenshots: simctl exited ${result.exitCode}: ${result.stderr}');
          return false;
        }
      } else {
        final result = await Process.run(
          _adb,
          ['-s', _device, 'exec-out', 'screencap', '-p'],
          stdoutEncoding: null,
        );
        if (result.exitCode != 0) {
          stderr.writeln('screenshots: screencap exited ${result.exitCode}: ${result.stderr}');
          return false;
        }
        await part.writeAsBytes(result.stdout as List<int>, flush: true);
      }
      if (!await _isPng(part)) {
        stderr.writeln('screenshots: the platform tool did not return a PNG');
        return false;
      }
      await part.rename(target.path);
      return true;
    } on Object catch (error) {
      stderr.writeln('screenshots: platform capture error: $error');
      return false;
    } finally {
      // Only the temporary file this capture created, inside the output folder.
      if (await part.exists()) await part.delete();
    }
  }

  static Future<bool> _isPng(File file) async {
    if (!await file.exists()) return false;
    const signature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    final raf = await file.open();
    try {
      final head = await raf.read(signature.length);
      if (head.length != signature.length) return false;
      for (var i = 0; i < signature.length; i++) {
        if (head[i] != signature[i]) return false;
      }
      return await file.length() > 1024;
    } finally {
      await raf.close();
    }
  }
}
