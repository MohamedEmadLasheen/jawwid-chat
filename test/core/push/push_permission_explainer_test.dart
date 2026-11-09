/// LR-11 (explain-first): the system notification prompt is never the first thing a
/// person sees. Before the native `start` (which asks Android 13+ for POST_NOTIFICATIONS
/// and iOS for notification authorization) the app explains what it notifies about, and
/// only "Continue" lets the registrar ask the platform.
///
/// These drive the registrar and the explainer together, without a widget: the screen
/// half (the dialog and when it may appear) is `push_permission_explainer_host_test.dart`.
///
/// THE DEVICE-LEVEL CHOICE (documented for the second-account case). The OS permission
/// belongs to the app on this device, not to an account, so the explainer's memory does
/// too: once anybody pressed Continue on this phone, the next account to sign in is never
/// shown it; a "Not now" holds for this device for a day, whoever signs in during it.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/push/push_permission_explainer.dart';
import 'package:jawwid_chat/core/push/push_registration.dart';
import 'package:jawwid_chat/features/auth/domain/auth_state.dart';
import 'package:jawwid_chat/shared/models/auth.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

import 'push_registration_test.dart' as h;

void main() {
  // A fixed instant, and offsets from it: never "today + N" (AGENTS.md).
  final t0 = DateTime.utc(2026, 3, 10, 12);

  late h.FakeTokens tokens;
  late h.RecordingApi api;
  late h.ScriptedAuth auth;
  late FakePushExplainerStore store;
  late DateTime now;

  ProviderContainer build({AuthState? initial, FakePushExplainerStore? reuse}) {
    tokens = h.FakeTokens();
    api = h.RecordingApi();
    auth = h.ScriptedAuth(
      initial ??
          const AuthAuthenticated(
            AuthUser(id: 'account_1', displayName: 'a', role: UserRole.parent),
          ),
    );
    store = reuse ?? FakePushExplainerStore();
    final container = ProviderContainer(overrides: [
      authControllerProvider.overrideWith(() => auth),
      pushTokensProvider.overrideWithValue(tokens),
      pushRegistrationApiProvider.overrideWithValue(api),
      pushExplainerStoreProvider.overrideWithValue(store),
      pushExplainerClockProvider.overrideWithValue(() => now),
    ]);
    addTearDown(container.dispose);
    addTearDown(tokens.close);
    container.read(authControllerProvider);
    return container;
  }

  setUp(() => now = t0);

  PushExplainer explainer(ProviderContainer c) => c.read(pushExplainerProvider.notifier);

  test('first sign-in: the explanation is asked for BEFORE the platform is', () async {
    final c = build();
    c.read(pushRegistrarProvider);
    await h.settle();

    expect(c.read(pushExplainerProvider), PushExplainerPhase.waiting);
    expect(tokens.starts, 0, reason: 'the system prompt must not come first');
  });

  test('Continue calls start exactly once, and is remembered', () async {
    final c = build();
    c.read(pushRegistrarProvider);
    await h.settle();

    await explainer(c).answer(proceed: true);
    await h.settle();
    expect(tokens.starts, 1);
    expect(store.hasContinued, isTrue);
    expect(c.read(pushExplainerProvider), PushExplainerPhase.idle);

    // A second answer (a double tap) changes nothing.
    await explainer(c).answer(proceed: true);
    await h.settle();
    expect(tokens.starts, 1);
  });

  test('a token is still registered once Continue has started the platform', () async {
    final c = build();
    c.read(pushRegistrarProvider);
    await h.settle();
    await explainer(c).answer(proceed: true);
    await h.settle();

    tokens.emit(h.voipToken);
    await h.settle();
    expect(api.registered, [h.voipToken]);
  });

  test('Not now: start is not called this session, and the answer is persisted', () async {
    final c = build();
    c.read(pushRegistrarProvider);
    await h.settle();

    await explainer(c).answer(proceed: false);
    await h.settle();

    expect(tokens.starts, 0);
    expect(store.hasContinued, isFalse);
    expect(store.lastDeclined, t0);
    expect(c.read(pushExplainerProvider), PushExplainerPhase.idle);
  });

  test('after Not now, the next app start within a day does not ask again', () async {
    final first = build();
    first.read(pushRegistrarProvider);
    await h.settle();
    await explainer(first).answer(proceed: false);
    await h.settle();
    final kept = store;

    now = t0.add(const Duration(hours: 5));
    final second = build(reuse: kept);
    second.read(pushRegistrarProvider);
    await h.settle();

    expect(second.read(pushExplainerProvider), PushExplainerPhase.idle);
    expect(tokens.starts, 0);
  });

  test('after Not now, an app start a day later asks again', () async {
    final first = build();
    first.read(pushRegistrarProvider);
    await h.settle();
    await explainer(first).answer(proceed: false);
    await h.settle();
    final kept = store;

    now = t0.add(const Duration(hours: 25));
    final second = build(reuse: kept);
    second.read(pushRegistrarProvider);
    await h.settle();

    expect(second.read(pushExplainerProvider), PushExplainerPhase.waiting);
    expect(tokens.starts, 0);

    await explainer(second).answer(proceed: true);
    await h.settle();
    expect(tokens.starts, 1);
  });

  test('a person who already pressed Continue never sees it again', () async {
    final c = build(reuse: FakePushExplainerStore(hasContinued: true));
    c.read(pushRegistrarProvider);
    await h.settle();

    expect(c.read(pushExplainerProvider), PushExplainerPhase.idle);
    expect(tokens.starts, 1);
  });

  test('second account on the same device after Continue: not shown, start called for it',
      () async {
    final c = build();
    c.read(pushRegistrarProvider);
    await h.settle();
    await explainer(c).answer(proceed: true);
    await h.settle();
    expect(tokens.starts, 1);

    auth.endSession();
    await h.settle();
    auth.authenticate('account_2');
    c.read(pushRegistrarProvider);
    await h.settle();

    expect(c.read(pushExplainerProvider), PushExplainerPhase.idle);
    expect(tokens.starts, 2, reason: 'each session still asks the platform for its tokens');
  });

  test('signing out with the question open: the old session never starts; the next one does',
      () async {
    final c = build();
    c.read(pushRegistrarProvider);
    await h.settle();
    expect(c.read(pushExplainerProvider), PushExplainerPhase.waiting);

    auth.endSession();
    await h.settle();
    auth.authenticate('account_2');
    c.read(pushRegistrarProvider);
    await h.settle();

    // One question for the device, still open, now answered by whoever is signed in.
    expect(c.read(pushExplainerProvider), PushExplainerPhase.waiting);
    await explainer(c).answer(proceed: true);
    await h.settle();
    expect(tokens.starts, 1, reason: 'only the live session asks the platform');
  });

  test('signed out at the answer: nothing is started', () async {
    final c = build();
    c.read(pushRegistrarProvider);
    await h.settle();

    auth.endSession();
    await h.settle();
    await explainer(c).answer(proceed: true);
    await h.settle();

    expect(tokens.starts, 0);
  });

  test('an unreadable store still explains first rather than prompting cold', () async {
    final c = build(reuse: FakePushExplainerStore(readThrows: true));
    c.read(pushRegistrarProvider);
    await h.settle();

    expect(c.read(pushExplainerProvider), PushExplainerPhase.waiting);
    expect(tokens.starts, 0);
  });

  test('a store that cannot write still honours Continue for this session', () async {
    final c = build(reuse: FakePushExplainerStore(writeThrows: true));
    c.read(pushRegistrarProvider);
    await h.settle();

    await explainer(c).answer(proceed: true);
    await h.settle();
    expect(tokens.starts, 1);
  });

  test('claim/release: one dialog at a time, and a lost dialog is asked again', () async {
    final c = build();
    c.read(pushRegistrarProvider);
    await h.settle();

    expect(explainer(c).claim(), isTrue);
    expect(c.read(pushExplainerProvider), PushExplainerPhase.onScreen);
    expect(explainer(c).claim(), isFalse, reason: 'a second host must not stack a second dialog');

    explainer(c).release();
    expect(c.read(pushExplainerProvider), PushExplainerPhase.waiting);
    expect(tokens.starts, 0);
  });
}
