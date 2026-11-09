/// LR-09j: the host side of `flutter drive` for the store screenshots.
///
/// The test on the device (`integration_test/store_screenshots_test.dart`) takes
/// each screenshot with `takeScreenshot('<platform>/<lang>/<name>')`; this driver
/// receives the PNG bytes on the host and writes them under
/// `$JAWWID_SCREENSHOT_DIR` (default `build/store_screenshots`, which is not
/// committed). Run it through `scripts/mobile/screenshots/capture.sh`.
library;

import 'dart:io';

import 'package:integration_test/integration_test_driver_extended.dart';

Future<void> main() async {
  final root = Platform.environment['JAWWID_SCREENSHOT_DIR'] ?? 'build/store_screenshots';
  await integrationDriver(
    onScreenshot: (String name, List<int> image, [Map<String, Object?>? args]) async {
      // Only the names the test builds: letters, digits, '_', '-' and '/'. Nothing
      // the device sends can write outside the output folder.
      if (!RegExp(r'^[A-Za-z0-9_\-]+(/[A-Za-z0-9_\-]+)*$').hasMatch(name)) return false;
      final file = File('$root/$name.png');
      await file.parent.create(recursive: true);
      await file.writeAsBytes(image);
      return true;
    },
  );
}
