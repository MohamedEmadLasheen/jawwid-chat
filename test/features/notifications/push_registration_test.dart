import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/features/notifications/push_messaging.dart';
import 'package:jawwid_chat/features/notifications/push_registrar.dart';

/// Device-token lifecycle.
///
/// A push token identifies a DEVICE, not a person, and that is the whole reason
/// this class is careful. Two things go wrong if it is not:
///
/// * a token registered once at startup silently stops working after the first
///   rotation, which presents as "notifications used to work";
/// * a token left registered after a sign-out keeps delivering one account's
///   notifications — message previews included — to whoever signs in next on
///   the same handset.
///
/// Both are tested here against a fake transport, because neither depends on
/// Firebase being reachable.
class _FakeMessaging implements PushMessaging {
  final _tokens = StreamController<String>.broadcast();
  bool started = false;
  Map<String, Object?>? launchTap;

  void emitToken(String token) => _tokens.add(token);

  @override
  Future<void> start() async => started = true;

  @override
  Stream<String> get tokens => _tokens.stream;

  @override
  Stream<Map<String, Object?>> get taps => const Stream.empty();

  @override
  Stream<Map<String, Object?>> get foregroundMessages => const Stream.empty();

  @override
  Future<Map<String, Object?>?> initialTap() async => launchTap;

  @override
  Future<void> stop() async => _tokens.close();
}

class _RecordingRepository implements NotificationRepository {
  final registered = <String>[];
  final unregistered = <String>[];
  bool failNext = false;

  @override
  Future<void> registerDevice({
    required String token,
    required String platform,
    bool isVoip = false,
    String? locale,
  }) async {
    if (failNext) {
      failNext = false;
      throw StateError('network');
    }
    registered.add(token);
  }

  @override
  Future<void> unregisterDevice(String token) async => unregistered.add(token);
}

void main() {
  late _FakeMessaging messaging;
  late _RecordingRepository repository;
  late bool signedIn;

  PushRegistrar registrar() => PushRegistrar(
        messaging: messaging,
        repository: () => repository,
        isSignedIn: () => signedIn,
        platform: 'android',
      );

  setUp(() {
    messaging = _FakeMessaging();
    repository = _RecordingRepository();
    signedIn = true;
  });

  /// The token stream is asynchronous; let it be delivered.
  Future<void> settle() => Future<void>.delayed(Duration.zero);

  test('registers a token once a session exists', () async {
    final r = registrar();
    await r.start();
    messaging.emitToken('tok-1');
    await settle();

    expect(repository.registered, ['tok-1']);
    await r.stop();
  });

  test('a token that arrives before sign-in is held, not attached to nobody', () async {
    signedIn = false;
    final r = registrar();
    await r.start();

    // The platform hands the token over at launch, while the user is still at
    // the login screen. Registering it now would bind the device to no account
    // — or, worse, to the previous one.
    messaging.emitToken('tok-1');
    await settle();
    expect(repository.registered, isEmpty);

    signedIn = true;
    await r.onSignedIn();
    expect(repository.registered, ['tok-1']);
    await r.stop();
  });

  test('a refreshed token replaces the old registration', () async {
    final r = registrar();
    await r.start();
    messaging.emitToken('tok-1');
    await settle();
    messaging.emitToken('tok-2');
    await settle();

    expect(repository.registered, ['tok-1', 'tok-2']);
    // The old one is retired rather than left behind, or the account
    // accumulates dead registrations that every future notification spends an
    // attempt on.
    expect(repository.unregistered, ['tok-1']);
    await r.stop();
  });

  test('the same token is not registered twice', () async {
    final r = registrar();
    await r.start();
    messaging.emitToken('tok-1');
    await settle();
    messaging.emitToken('tok-1');
    await settle();

    expect(repository.registered, ['tok-1']);
    await r.stop();
  });

  test('signing out retires the token', () async {
    final r = registrar();
    await r.start();
    messaging.emitToken('tok-1');
    await settle();

    await r.forget();

    // This is the account-switch guarantee: the next person to sign in on this
    // handset must not receive the previous account's notifications.
    expect(repository.unregistered, ['tok-1']);
    await r.stop();
  });

  test('signing out and back in on the same device re-registers', () async {
    final r = registrar();
    await r.start();
    messaging.emitToken('tok-1');
    await settle();
    await r.forget();

    // Same physical device, new session. The platform does not re-emit, so the
    // token arrives again only on refresh — but a fresh registration must be
    // possible when it does.
    messaging.emitToken('tok-1');
    await settle();
    expect(repository.registered, ['tok-1', 'tok-1']);
    await r.stop();
  });

  test('a failed registration is retried rather than lost', () async {
    final r = registrar();
    await r.start();
    repository.failNext = true;
    messaging.emitToken('tok-1');
    await settle();

    expect(repository.registered, isEmpty);

    // Kept as pending, so the next sign-in retries it. Surfacing this to the
    // user would be an error for something they did not do.
    await r.onSignedIn();
    expect(repository.registered, ['tok-1']);
    await r.stop();
  });

  test('a build with push disabled never touches the repository', () async {
    final r = PushRegistrar(
      messaging: const DisabledPushMessaging(),
      // Would throw if reached. It must not be: no transport, no token, no
      // registration.
      repository: () => throw StateError('must not be reached'),
      isSignedIn: () => true,
      platform: 'android',
    );
    await r.start();
    await r.onSignedIn();
    await r.forget();
    await r.stop();
  });
}
