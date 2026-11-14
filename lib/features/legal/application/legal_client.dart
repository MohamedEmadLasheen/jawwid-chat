import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// PD-58: where an acceptance was given (`chat.terms_acceptance.client`): `android`, `ios`,
/// or `web_portal` for the PD-28 teacher web portal (this app's web build). `admin_web` is the
/// Admin Web's, never this app's.
///
/// Null on any other platform: the evidence must say where it was given, so a build this
/// contract has no name for (desktop development) claims none and cannot accept.
String? legalClientFor({required bool isWeb, required TargetPlatform platform}) {
  if (isWeb) return 'web_portal';
  return switch (platform) {
    TargetPlatform.android => 'android',
    TargetPlatform.iOS => 'ios',
    _ => null,
  };
}

/// This build's client name, from [legalClientFor].
final legalClientProvider = Provider<String?>(
  (ref) => legalClientFor(isWeb: kIsWeb, platform: defaultTargetPlatform),
);
