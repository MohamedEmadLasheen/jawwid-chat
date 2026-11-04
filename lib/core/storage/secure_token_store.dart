import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../../shared/models/auth.dart';

/// Where session tokens live.
///
/// Tokens go to the iOS keychain and the Android EncryptedSharedPreferences/keystore and
/// **nowhere else** — never to `shared_preferences`, never to the sqlite cache, never to a
/// log (§8, §50, §56). The password is never persisted in any form.
abstract interface class TokenStore {
  Future<AuthSession?> read();

  Future<void> write(AuthSession session);

  /// Called on sign-out and whenever the backend ends the session (§7).
  Future<void> clear();
}

/// The device keychain, configured once for everything this app keeps there.
const _keychain = FlutterSecureStorage(
  // Defaults on Android 11+ of this plugin are AES-GCM data encryption with
  // RSA-OAEP key wrapping in the platform keystore.
  aOptions: AndroidOptions(),
  // Readable only after first unlock, and never migrated to a new device.
  iOptions: IOSOptions(
    accessibility: KeychainAccessibility.first_unlock_this_device,
  ),
);

class SecureTokenStore implements TokenStore {
  SecureTokenStore({FlutterSecureStorage? storage}) : _storage = storage ?? _keychain;

  static const _accessKey = 'jawwid.access_token';
  static const _refreshKey = 'jawwid.refresh_token';
  static const _expiryKey = 'jawwid.access_expires_at';

  final FlutterSecureStorage _storage;

  @override
  Future<AuthSession?> read() async {
    final access = await _storage.read(key: _accessKey);
    final refresh = await _storage.read(key: _refreshKey);
    final expiry = await _storage.read(key: _expiryKey);

    if (access == null || refresh == null || expiry == null) return null;

    final expiresAt = DateTime.tryParse(expiry);
    if (expiresAt == null) {
      // Corrupt entry — drop it rather than carry an unusable session forward.
      await clear();
      return null;
    }

    return AuthSession(
      accessToken: access,
      refreshToken: refresh,
      accessTokenExpiresAt: expiresAt,
    );
  }

  /// The refresh token is written FIRST. These are three separate keychain writes, and a
  /// process killed between them leaves a mix of old and new. After a rotation the old
  /// refresh token is already retired server-side, and presenting it is read as theft and
  /// revokes every session on the account -- so it must never be the one left behind. A new
  /// refresh token beside an old access token only costs one 401 and a refresh.
  @override
  Future<void> write(AuthSession session) async {
    await _storage.write(key: _refreshKey, value: session.refreshToken);
    await _storage.write(key: _accessKey, value: session.accessToken);
    await _storage.write(
      key: _expiryKey,
      value: session.accessTokenExpiresAt.toIso8601String(),
    );
  }

  @override
  Future<void> clear() async {
    await _storage.delete(key: _accessKey);
    await _storage.delete(key: _refreshKey);
    await _storage.delete(key: _expiryKey);
  }
}

/// In-memory store for tests and the fake backend. Never used in a release build.
class InMemoryTokenStore implements TokenStore {
  AuthSession? _session;

  @override
  Future<AuthSession?> read() async => _session;

  @override
  Future<void> write(AuthSession session) async => _session = session;

  @override
  Future<void> clear() async => _session = null;
}

/// PD-37: the keychain for anything else this app must keep as carefully as
/// its tokens -- a child's unsent chat drafts. Through this file, so the
/// keychain keeps ONE door to audit (auth_token_leakage_test). Same options:
/// this device only, never in a backup, readable after first unlock.
abstract interface class DeviceKeychain {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<void> delete(String key);

  /// Every key this app holds there -- to clear one family of them.
  Future<Iterable<String>> keys();
}

class SecureDeviceKeychain implements DeviceKeychain {
  const SecureDeviceKeychain();

  @override
  Future<String?> read(String key) => _keychain.read(key: key);

  @override
  Future<void> write(String key, String value) => _keychain.write(key: key, value: value);

  @override
  Future<void> delete(String key) => _keychain.delete(key: key);

  @override
  Future<Iterable<String>> keys() async => (await _keychain.readAll()).keys;
}
