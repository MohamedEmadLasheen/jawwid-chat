import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/bootstrap.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/features/calls/application/call_session.dart';
import 'package:jawwid_chat/features/conversations/application/chat_realtime.dart';
import 'package:jawwid_chat/features/conversations/application/realtime_keeper.dart';

/// The realtime transport belongs to ONE session.
///
/// It used to be a single app-lifetime object. The session's client disposes
/// its socket on sign-out, and `dispose()` is terminal, so every later session
/// in the same process connected to nothing: chat and call signalling were
/// silently dead until the app was restarted. The bootstrap now keys the
/// socket on the signed-in account, exactly as the client is keyed.
void main() {
  // The keeper listens to the app's lifecycle.
  TestWidgetsFlutterBinding.ensureInitialized();
  late ProviderContainer container;

  setUp(() async {
    container = ProviderContainer(overrides: await bootstrap());
  });

  tearDown(() => container.dispose());

  Future<void> signIn() => container
      .read(authControllerProvider.notifier)
      .signIn(username: 'parent', password: 'secret');

  test('signed out: no socket is needed and no live chat exists', () {
    expect(container.read(callRealtimeClientProvider), isNull);
    expect(container.read(chatRealtimeProvider), isNull);
  });

  test('each session gets its own socket; a second session is not handed the first one', () async {
    await signIn();
    final first = container.read(realtimeSocketProvider);
    expect(container.read(callRealtimeClientProvider), isNotNull);
    expect(container.read(chatRealtimeProvider), isNotNull);

    await container.read(authControllerProvider.notifier).signOut();
    expect(container.read(callRealtimeClientProvider), isNull);

    await signIn();
    final second = container.read(realtimeSocketProvider);

    expect(identical(first, second), isFalse);
    expect(container.read(callRealtimeClientProvider), isNotNull);
  });

  test('each session gets its own realtime keeper; a sign-out stops it, with no try left waiting (PARENT-015)', () async {
    expect(container.read(realtimeKeeperProvider), isNull);
    await signIn();
    final first = container.read(realtimeKeeperProvider)!;

    await container.read(authControllerProvider.notifier).signOut();
    expect(container.read(realtimeKeeperProvider), isNull);
    expect(first.waiting, isFalse);

    await signIn();
    final second = container.read(realtimeKeeperProvider);
    expect(second, isNotNull);
    expect(identical(first, second), isFalse);
  });
}
