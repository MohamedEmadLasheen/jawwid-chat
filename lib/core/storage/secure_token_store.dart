import 'dart:convert';

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

/// LR-46 follow-up: a session the user signed out of while the server could not be reached.
///
/// The user is signed out locally at once; this is only what is needed to end the session on
/// the server later (`POST /auth/logout`, after a `POST /auth/refresh` when the access token
/// has expired). Kept in the Keychain / Keystore beside the live session, never anywhere else.
class PendingSignOut {
  const PendingSignOut({
    required this.session,
    required this.createdAt,
    required this.attempts,
    this.notBefore,
    this.offlineFailures = 0,
    this.refreshStartedAt,
  });

  final AuthSession session;

  /// When the sign-out was made. A server session outlives no more than thirty days.
  final DateTime createdAt;

  /// Server sign-out attempts made so far, the original one included. Only attempts that may
  /// have reached the server count: a phone that is offline does not use the entry up.
  final int attempts;

  /// The next attempt is not due before this (backoff). Null: due now.
  final DateTime? notBefore;

  /// Attempts that provably never left the phone (no connection). They lengthen the backoff
  /// but never count toward the attempt ceiling; the age limit is their backstop.
  final int offlineFailures;

  /// Set, and persisted, BEFORE `POST /auth/refresh` is sent with [session]'s refresh token.
  /// An entry read back with it set may hold a token the server has already rotated, so it is
  /// never refreshed again (presenting a rotated token revokes every session on the account).
  final DateTime? refreshStartedAt;

  /// [refreshStartedAt] is kept unless [clearRefreshStarted] (or a new [session] -- a
  /// successor -- which never carries the old marker).
  PendingSignOut copyWith({
    AuthSession? session,
    int? attempts,
    DateTime? notBefore,
    int? offlineFailures,
    DateTime? refreshStartedAt,
    bool clearRefreshStarted = false,
  }) =>
      PendingSignOut(
        session: session ?? this.session,
        createdAt: createdAt,
        attempts: attempts ?? this.attempts,
        notBefore: notBefore ?? this.notBefore,
        offlineFailures: offlineFailures ?? this.offlineFailures,
        refreshStartedAt: clearRefreshStarted || session != null ? null : refreshStartedAt ?? this.refreshStartedAt,
      );

  Map<String, Object?> toJson() => {
        'refresh': session.refreshToken,
        'access': session.accessToken,
        'accessExpiresAt': session.accessTokenExpiresAt.toIso8601String(),
        'createdAt': createdAt.toIso8601String(),
        'attempts': attempts,
        if (notBefore != null) 'notBefore': notBefore!.toIso8601String(),
        if (offlineFailures != 0) 'offline': offlineFailures,
        if (refreshStartedAt != null) 'refreshStartedAt': refreshStartedAt!.toIso8601String(),
      };

  /// Null for anything unreadable: a corrupt entry is dropped, never carried forward.
  static PendingSignOut? fromJson(Object? json) {
    if (json is! Map) return null;
    final refresh = json['refresh'];
    final access = json['access'];
    final expiresAt = DateTime.tryParse('${json['accessExpiresAt']}');
    final createdAt = DateTime.tryParse('${json['createdAt']}');
    final attempts = json['attempts'];
    final notBefore = json['notBefore'];
    final offline = json['offline'] ?? 0;
    final rawRefreshStarted = json['refreshStartedAt'];
    final refreshStartedAt = rawRefreshStarted == null ? null : DateTime.tryParse('$rawRefreshStarted');
    if (refresh is! String || refresh.isEmpty || access is! String) return null;
    if (expiresAt == null || createdAt == null || attempts is! int || offline is! int) return null;
    // A marker that cannot be read must not be read as "no refresh was started": dropped.
    if (rawRefreshStarted != null && refreshStartedAt == null) return null;
    return PendingSignOut(
      session: AuthSession(accessToken: access, refreshToken: refresh, accessTokenExpiresAt: expiresAt),
      createdAt: createdAt,
      attempts: attempts,
      notBefore: notBefore is String ? DateTime.tryParse(notBefore) : null,
      offlineFailures: offline,
      refreshStartedAt: refreshStartedAt,
    );
  }

  /// Never include token material in diagnostics.
  @override
  String toString() => 'PendingSignOut(createdAt: $createdAt, attempts: $attempts, offline: $offlineFailures, '
      'notBefore: $notBefore, refreshStartedAt: $refreshStartedAt)';
}

/// Where pending sign-outs live. The whole list is one value, written in one write.
abstract interface class PendingSignOutStore {
  Future<List<PendingSignOut>> read();

  /// An empty list removes the entry.
  Future<void> write(List<PendingSignOut> entries);
}

class SecurePendingSignOutStore implements PendingSignOutStore {
  SecurePendingSignOutStore({FlutterSecureStorage? storage}) : _storage = storage ?? _keychain;

  static const _key = 'jawwid.pending_sign_out';

  final FlutterSecureStorage _storage;

  @override
  Future<List<PendingSignOut>> read() async {
    final raw = await _storage.read(key: _key);
    if (raw == null) return const [];
    try {
      final decoded = jsonDecode(raw);
      if (decoded is List) {
        return [
          for (final item in decoded)
            if (PendingSignOut.fromJson(item) case final entry?) entry,
        ];
      }
    } on FormatException {
      // Corrupt: dropped below.
    }
    await _storage.delete(key: _key);
    return const [];
  }

  @override
  Future<void> write(List<PendingSignOut> entries) async {
    if (entries.isEmpty) {
      await _storage.delete(key: _key);
      return;
    }
    await _storage.write(key: _key, value: jsonEncode([for (final e in entries) e.toJson()]));
  }
}

/// In-memory store for tests. Never used in a release build.
class InMemoryPendingSignOutStore implements PendingSignOutStore {
  List<PendingSignOut> _entries = const [];

  @override
  Future<List<PendingSignOut>> read() async => _entries;

  @override
  Future<void> write(List<PendingSignOut> entries) async => _entries = List.unmodifiable(entries);
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
