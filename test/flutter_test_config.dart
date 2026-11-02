import 'dart:async';

import 'package:jawwid_chat/shared/utils/western_digits.dart';

/// Every test runs with the app's digit policy (DD-09: Western digits 0-9 in both
/// locales), as `main()` sets it, so a test reads what the app shows.
Future<void> testExecutable(FutureOr<void> Function() testMain) async {
  useWesternDigits();
  await testMain();
}
