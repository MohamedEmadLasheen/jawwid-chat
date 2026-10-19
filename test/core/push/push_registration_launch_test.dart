import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/push/push_registration.dart';
import 'package:jawwid_chat/features/auth/domain/auth_state.dart';

import 'push_registration_test.dart' as h;

/// W8-W1 reopen, 2026-10-19 (docs/release/REOPEN-W8W1-PUSH-REGISTRATION-2026-10-19.md).
///
/// The sequence `main()` actually runs: registration is started while the stored session is
/// still being read (AuthUnknown), and the session arrives afterwards. The existing suite
/// only ever built the registrar with the account ALREADY signed in, which is the one order
/// a real launch never produces -- so it passed while no device ever registered.
void main() {
  late h.FakeTokens tokens;
  late h.RecordingApi api;
  late h.ScriptedAuth auth;
  late ProviderContainer container;

  setUp(() {
    tokens = h.FakeTokens();
    api = h.RecordingApi();
    auth = h.ScriptedAuth(const AuthUnknown());
    container = ProviderContainer(overrides: [
      authControllerProvider.overrideWith(() => auth),
      pushTokensProvider.overrideWithValue(tokens),
      pushRegistrationApiProvider.overrideWithValue(api),
    ]);
    addTearDown(container.dispose);
    addTearDown(tokens.close);
    container.read(authControllerProvider);
  });

  test('started before the session is restored, it registers once the session arrives',
      () async {
    startPushRegistration(container);
    await h.settle();
    expect(tokens.starts, 0, reason: 'no session yet: the platform is not asked');

    auth.authenticate('account_1');
    await h.settle();
    tokens.emit(h.voipToken);
    await h.settle();

    expect(tokens.starts, 1);
    expect(api.registered, [h.voipToken]);
  });

  test('a sign-in after a signed-out launch registers', () async {
    auth.endSession();
    startPushRegistration(container);
    await h.settle();

    auth.authenticate('account_1');
    await h.settle();
    tokens.emit(h.standardToken);
    await h.settle();

    expect(api.registered, [h.standardToken]);
  });

  test('sign-out retires the tokens; the next session registers again', () async {
    startPushRegistration(container);
    auth.authenticate('account_1');
    await h.settle();
    tokens.emit(h.voipToken);
    await h.settle();

    auth.endSession();
    await h.settle();
    expect(api.unregistered, [h.voipToken]);

    auth.authenticate('account_2');
    await h.settle();
    tokens.emit(h.voipToken);
    await h.settle();

    expect(api.registered, [h.voipToken, h.voipToken],
        reason: 'the second account registers this device too');
  });
}
