import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/bootstrap.dart';
import 'package:jawwid_chat/core/network/api_config.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

/// A release build must never run on fixtures.
///
/// `bootstrap()` chooses the stack from build-time configuration. Unconfigured, it
/// used to fall through to `FakeBackend` silently — so a release build that simply
/// forgot `--dart-define=JAWWID_API_BASE_URL` would ship real screens filled with
/// invented families and invented messages, with nothing on screen to say so. CI
/// cannot catch it either: the mobile job runs no Flutter at all (gate G-37).
///
/// The release branch itself cannot be exercised from a test — `kReleaseMode` is a
/// compile-time constant and `flutter test` is always debug — so this asserts the
/// two things that ARE checkable: the guard exists in the source, and the debug
/// path it must not disturb still works.
void main() {
  test('this test process is unconfigured and in debug, which is the premise', () {
    expect(ApiConfig.isConfigured, isFalse);
  });

  test('debug still boots on fixtures, so developing without a backend works', () async {
    final overrides = await bootstrap(developmentRole: UserRole.teacher);

    // The fixture stack is a non-empty set of overrides. Asserting the count would
    // be asserting the wiring, which is not what this test is about.
    expect(overrides, isNotEmpty);
  });

  test('the release branch refuses rather than falling through to fixtures', () {
    final source = File('lib/app/bootstrap.dart').readAsStringSync();

    // The vulnerable form is a bare conditional with no release branch between the
    // two stacks.
    expect(
      source,
      isNot(contains(
        'return ApiConfig.isConfigured ? _httpOverrides() : _fakeOverrides(developmentRole);',
      )),
    );

    // It throws, and it throws BEFORE the fixture stack is built.
    final guard = source.indexOf('kReleaseMode');
    final fixtures = source.indexOf('return _fakeOverrides(developmentRole);');
    expect(guard, isNonNegative, reason: 'no release-mode guard in bootstrap()');
    expect(fixtures, isNonNegative);
    expect(
      guard,
      lessThan(fixtures),
      reason: 'the guard must precede the fixture fallback, or it guards nothing',
    );
    expect(source, contains('throw StateError('));
  });
}
