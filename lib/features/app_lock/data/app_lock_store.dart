import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../domain/app_lock_settings.dart';

/// Where each account's app-lock preference is remembered on this device.
///
/// Keyed by actor id, so two people who share a phone each keep their own choice, and a
/// sign-out never touches anybody's preference -- signing back in finds it where it was.
abstract interface class AppLockStore {
  /// Null when this account has never stored a preference on this device.
  Future<AppLockSettings?> read(String actorId);

  Future<void> write(String actorId, AppLockSettings settings);
}

/// `shared_preferences`, like the language and appearance choices: a device preference, not
/// a secret. It never goes near the keychain entries that hold the session's tokens.
class SharedPreferencesAppLockStore implements AppLockStore {
  const SharedPreferencesAppLockStore();

  static String keyFor(String actorId) => 'jawwid.app_lock.v1.$actorId';

  @override
  Future<AppLockSettings?> read(String actorId) async {
    final raw = (await SharedPreferences.getInstance()).getString(keyFor(actorId));
    if (raw == null) return null;
    try {
      final decoded = jsonDecode(raw);
      if (decoded is Map<String, Object?>) return AppLockSettings.fromJson(decoded);
    } on FormatException {
      // Written by something else, or truncated. Not a value to act on.
    }
    return null;
  }

  @override
  Future<void> write(String actorId, AppLockSettings settings) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(keyFor(actorId), jsonEncode(settings.toJson()));
  }
}

/// In memory, for tests.
class InMemoryAppLockStore implements AppLockStore {
  InMemoryAppLockStore([Map<String, AppLockSettings>? initial])
      : stored = {...?initial};

  final Map<String, AppLockSettings> stored;
  bool readThrows = false;
  int writes = 0;

  @override
  Future<AppLockSettings?> read(String actorId) async {
    if (readThrows) throw Exception('storage unavailable');
    return stored[actorId];
  }

  @override
  Future<void> write(String actorId, AppLockSettings settings) async {
    writes++;
    stored[actorId] = settings;
  }
}

final appLockStoreProvider = Provider<AppLockStore>(
  (ref) => const SharedPreferencesAppLockStore(),
);
