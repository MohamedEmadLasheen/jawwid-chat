import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/storage/secure_token_store.dart';
import 'package:jawwid_chat/shared/models/auth.dart';

/// A keychain that records the order of writes, and can "die" after N of them -- the
/// process killed mid-save.
class _Keychain extends FlutterSecureStorage {
  _Keychain({this.dieAfter});

  final int? dieAfter;
  final Map<String, String> values = {};
  final List<String> order = [];

  @override
  Future<void> write({
    required String key,
    required String? value,
    AppleOptions? iOptions,
    AndroidOptions? aOptions,
    LinuxOptions? lOptions,
    WebOptions? webOptions,
    AppleOptions? mOptions,
    WindowsOptions? wOptions,
  }) async {
    if (dieAfter != null && order.length >= dieAfter!) throw StateError('process killed');
    order.add(key);
    if (value != null) values[key] = value;
  }

  @override
  Future<String?> read({
    required String key,
    AppleOptions? iOptions,
    AndroidOptions? aOptions,
    LinuxOptions? lOptions,
    WebOptions? webOptions,
    AppleOptions? mOptions,
    WindowsOptions? wOptions,
  }) async =>
      values[key];

  @override
  Future<void> delete({
    required String key,
    AppleOptions? iOptions,
    AndroidOptions? aOptions,
    LinuxOptions? lOptions,
    WebOptions? webOptions,
    AppleOptions? mOptions,
    WindowsOptions? wOptions,
  }) async =>
      values.remove(key);
}

AuthSession session(String n) => AuthSession(
      accessToken: 'access-$n',
      refreshToken: 'refresh-$n',
      accessTokenExpiresAt: DateTime.utc(2030),
    );

void main() {
  test('the refresh token is written first', () async {
    final keychain = _Keychain();
    await SecureTokenStore(storage: keychain).write(session('1'));

    expect(keychain.order.first, 'jawwid.refresh_token');
  });

  test('killed after one write during a rotation: the RETIRED refresh token is not what is left',
      () async {
    // The state after a launch-time refresh rotated refresh-1 into refresh-2 server-side.
    final keychain = _Keychain();
    await SecureTokenStore(storage: keychain).write(session('1'));
    final dying = _Keychain(dieAfter: 1)..values.addAll(keychain.values);

    await expectLater(SecureTokenStore(storage: dying).write(session('2')), throwsStateError);

    // refresh-1 is retired; presenting it again is reuse and revokes the whole account.
    final left = await SecureTokenStore(storage: dying).read();
    expect(left?.refreshToken, 'refresh-2');
  });
}
