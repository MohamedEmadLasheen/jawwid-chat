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

class SecureTokenStore implements TokenStore {
  SecureTokenStore({FlutterSecureStorage? storage})
      : _storage = storage ??
            const FlutterSecureStorage(
              // Defaults on Android 11+ of this plugin are AES-GCM data encryption with
              // RSA-OAEP key wrapping in the platform keystore.
              aOptions: AndroidOptions(),
              // Readable only after first unlock, and never migrated to a new device.
              iOptions: IOSOptions(
                accessibility: KeychainAccessibility.first_unlock_this_device,
              ),
            );

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

  @override
  Future<void> write(AuthSession session) async {
    await _storage.write(key: _accessKey, value: session.accessToken);
    await _storage.write(key: _refreshKey, value: session.refreshToken);
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
