import 'dart:ui';

import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/features/sessions/domain/account_session.dart';
import 'package:jawwid_chat/features/sessions/presentation/devices_screen.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';

/// PD-23: a row in Devices & sessions is named so a person recognises the device.
void main() {
  final l10n = lookupL10n(const Locale('en'));
  AccountSession session(String? name, SessionPlatform? platform) => AccountSession(
        id: 's',
        current: false,
        platform: platform,
        deviceName: name,
        signedInAt: DateTime(2026, 10, 22),
        expiresAt: DateTime(2026, 11, 21),
      );

  test('an iOS model code is shown as its family, not as the code', () {
    expect(deviceLabel(session('iPhone18,1', SessionPlatform.ios), l10n), 'iPhone');
    expect(deviceLabel(session('iPad13,4', SessionPlatform.ios), l10n), 'iPad');
  });

  test('a real name is shown as the device gave it', () {
    expect(deviceLabel(session('Galaxy A54', SessionPlatform.android), l10n), 'Galaxy A54');
    expect(deviceLabel(session('iPhone 17 Pro', SessionPlatform.ios), l10n), 'iPhone 17 Pro');
  });

  test('no name, or a blank one, falls back to the kind of device', () {
    expect(deviceLabel(session(null, SessionPlatform.android), l10n), l10n.devicesPlatformAndroid);
    expect(deviceLabel(session('  ', SessionPlatform.ios), l10n), l10n.devicesPlatformIphone);
  });
}
