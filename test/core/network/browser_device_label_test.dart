import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/network/device_descriptor.dart';

/// PD-28: the web portal names a browser the way Admin Web does (`device.test.ts` there), so
/// Devices & sessions reads "Chrome on macOS" for both.
void main() {
  const macChrome =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) '
      'Chrome/141.0.0.0 Safari/537.36';
  const winEdge =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) '
      'Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0';
  const macSafari =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) '
      'Version/18.0 Safari/605.1.15';
  const linuxFirefox = 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0';

  test('browser on operating system', () {
    expect(browserDeviceLabel(macChrome), 'Chrome on macOS');
    expect(browserDeviceLabel(winEdge), 'Edge on Windows');
    expect(browserDeviceLabel(macSafari), 'Safari on macOS');
    expect(browserDeviceLabel(linuxFirefox), 'Firefox on Linux');
  });

  test('never a version number: a label for a person, not a fingerprint', () {
    expect(browserDeviceLabel(macChrome), isNot(contains('141')));
  });

  test('falls back to navigator.platform, then to the browser alone', () {
    expect(browserDeviceLabel('SomeBrowser/1.0', platform: 'MacIntel'), 'Web browser on macOS');
    expect(browserDeviceLabel(null), 'Web browser');
  });

  test('at most 60 characters', () {
    expect(browserDeviceLabel(macChrome).length, lessThanOrEqualTo(60));
  });
}
