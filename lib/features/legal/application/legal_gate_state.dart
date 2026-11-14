import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';

import '../../../app/providers.dart';

/// PD-58: the legal gate is up -- a signed-in account with anything but `accepted` (roadmap
/// §7.5: it holds back the lesson-audio notice and the app-lock offer while open). False when
/// nobody is signed in, when the server sends no `legal` block (the API before ENG-10), and
/// in a container with no auth wired (as [principalIdProvider] reads it).
final legalGateShownProvider = Provider<bool>((ref) {
  try {
    return ref.watch(authControllerProvider.select((state) => state.user?.legal?.holdsApp ?? false));
  } catch (error) {
    final cause = error is ProviderException ? error.exception : error;
    if (cause is UnimplementedError) return false;
    rethrow;
  }
});
