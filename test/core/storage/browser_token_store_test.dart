import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/storage/browser_token_store.dart';
import 'package:jawwid_chat/shared/models/auth.dart';

/// One of a browser's key-value stores, in memory. Shared between "tabs" by passing the same
/// instance to two stores, as two tabs of one browser share localStorage.
class FakeKeyValue implements BrowserKeyValue {
  final values = <String, String>{};
  bool blocked = false;

  @override
  String? read(String key) {
    if (blocked) throw StateError('storage blocked');
    return values[key];
  }

  @override
  void write(String key, String value) {
    if (blocked) throw StateError('storage blocked');
    values[key] = value;
  }

  @override
  void remove(String key) {
    if (blocked) throw StateError('storage blocked');
    values.remove(key);
  }
}

/// The Web Locks API, recording which lock each body ran under.
class FakeLocks {
  final held = <String>[];

  Future<T> call<T>(String name, Future<T> Function() body) async {
    held.add(name);
    return body();
  }
}

AuthSession session(String refresh, {bool? remembered, String access = 'access'}) => AuthSession(
      accessToken: access,
      refreshToken: refresh,
      accessTokenExpiresAt: DateTime.utc(2030),
      remembered: remembered,
    );

/// PD-28: the web portal keeps its session the way Admin Web does (PD-23 §4).
void main() {
  late FakeKeyValue tab;
  late FakeKeyValue device;
  late FakeLocks locks;

  setUp(() {
    tab = FakeKeyValue();
    device = FakeKeyValue();
    locks = FakeLocks();
  });

  BrowserTokenStore store({bool withLocks = true, FakeKeyValue? tabStore}) => BrowserTokenStore(
        BrowserBindings(tab: tabStore ?? tab, device: device, lock: withLocks ? locks.call : null),
      );

  group('where the refresh token goes', () {
    test('a login the server did not remember goes to sessionStorage only', () async {
      await store().write(session('r1', remembered: false));

      expect(tab.values, {BrowserTokenStore.tabRefreshKey: 'r1'});
      expect(device.values, isEmpty);
    });

    test('a remembered login goes to localStorage only', () async {
      final s = store();
      await s.write(session('r1', remembered: true));

      expect(device.values, {BrowserTokenStore.deviceRefreshKey: 'r1'});
      expect(tab.values, isEmpty);
      expect(s.mode, BrowserPersistence.device);
    });

    test('a remembered login without Web Locks stays in this tab: a shared token could be replayed',
        () async {
      final s = store(withLocks: false);
      expect(s.persistenceSupported, isFalse);

      await s.write(session('r1', remembered: true));

      expect(tab.values, {BrowserTokenStore.tabRefreshKey: 'r1'});
      expect(device.values, isEmpty);
    });

    test('the access token is never written to storage', () async {
      await store().write(session('r1', remembered: true, access: 'secret-access'));
      await store().write(session('r2', remembered: false, access: 'secret-access'));

      expect([...tab.values.values, ...device.values.values], isNot(contains('secret-access')));
    });

    test('a refresh (remembered: null) puts the rotated token back where it was', () async {
      final s = store();
      await s.write(session('r1', remembered: true));
      await s.write(session('r2'));

      expect(device.values[BrowserTokenStore.deviceRefreshKey], 'r2');
      expect(tab.values, isEmpty);
    });

    test("a refresh in tab mode leaves another tab's remembered token alone", () async {
      device.values[BrowserTokenStore.deviceRefreshKey] = 'other-tab';
      final s = store();
      await s.write(session('r1', remembered: false));
      device.values[BrowserTokenStore.deviceRefreshKey] = 'other-tab-again';
      await s.write(session('r2'));

      expect(device.values[BrowserTokenStore.deviceRefreshKey], 'other-tab-again');
      expect(tab.values[BrowserTokenStore.tabRefreshKey], 'r2');
    });

    test('a non-remembered LOGIN replaces a remembered one on this browser', () async {
      device.values[BrowserTokenStore.deviceRefreshKey] = 'old';
      await store().write(session('r1', remembered: false));

      expect(device.values, isEmpty);
    });
  });

  group('reading it back', () {
    test('after a reload there is a refresh token and no access token', () async {
      await store().write(session('r1', remembered: false, access: 'a1'));

      final reloaded = await store().read();
      expect(reloaded!.refreshToken, 'r1');
      expect(reloaded.accessToken, isEmpty);
    });

    test('a new tab of a remembered browser joins device mode', () async {
      await store().write(session('r1', remembered: true));

      final secondTab = store(tabStore: FakeKeyValue());
      expect((await secondTab.read())!.refreshToken, 'r1');
      expect(secondTab.mode, BrowserPersistence.device);
    });

    test('the refresh token is re-read every time: another tab may have rotated it', () async {
      final s = store();
      await s.write(session('r1', remembered: true, access: 'a1'));
      device.values[BrowserTokenStore.deviceRefreshKey] = 'rotated-elsewhere';

      final read = await s.read();
      expect(read!.refreshToken, 'rotated-elsewhere');
      expect(read.accessToken, 'a1');
    });

    test('nothing stored is no session', () async {
      expect(await store().read(), isNull);
    });

    test('blocked storage is no session, not a crash', () async {
      tab.blocked = true;
      device.blocked = true;
      final s = store();

      await s.write(session('r1', remembered: true));
      expect(await s.read(), isNull);
      expect(s.persistenceSupported, isFalse);
    });
  });

  group('signing out', () {
    test('clears this tab, and the shared token in device mode', () async {
      final s = store();
      await s.write(session('r1', remembered: true));
      await s.clear();

      expect(device.values, isEmpty);
      expect(await s.read(), isNull);
    });

    test("in tab mode it leaves another tab's remembered token alone", () async {
      final s = store();
      await s.write(session('r1', remembered: false));
      device.values[BrowserTokenStore.deviceRefreshKey] = 'other-tab';
      await s.clear();

      expect(tab.values, isEmpty);
      expect(device.values[BrowserTokenStore.deviceRefreshKey], 'other-tab');
    });
  });

  group('the refresh lock', () {
    test('device mode runs the exchange under the one Web Lock', () async {
      final s = store();
      await s.write(session('r1', remembered: true));

      expect(await s.exclusive(() async => 'done'), 'done');
      expect(locks.held, [BrowserTokenStore.refreshLock]);
    });

    test('tab mode needs no lock: one tab, one token', () async {
      final s = store();
      await s.write(session('r1', remembered: false));

      await s.exclusive(() async => null);
      expect(locks.held, isEmpty);
    });
  });
}
