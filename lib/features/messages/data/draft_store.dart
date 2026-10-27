import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// PD-37: unsent drafts, per account and per conversation, kept on this device
/// only -- they never reach the server. One entry per account, so one person's
/// drafts are never loaded for another on a shared phone.
abstract interface class DraftStore {
  Future<Map<String, String>> load(String principalId);
  Future<void> save(String principalId, Map<String, String> drafts);

  /// Sign-out: forget every account's drafts on this device.
  Future<void> clearAll();
}

class SharedPreferencesDraftStore implements DraftStore {
  const SharedPreferencesDraftStore();

  static const _prefix = 'jawwid.drafts.';
  static String _key(String principalId) => '$_prefix$principalId';

  @override
  Future<Map<String, String>> load(String principalId) async {
    final raw = (await SharedPreferences.getInstance()).getString(_key(principalId));
    if (raw == null) return const {};
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! Map) return const {};
      return {
        for (final e in decoded.entries)
          if (e.key is String && e.value is String) e.key as String: e.value as String,
      };
    } on FormatException {
      return const {}; // a damaged entry is dropped, never shown
    }
  }

  @override
  Future<void> save(String principalId, Map<String, String> drafts) async {
    final prefs = await SharedPreferences.getInstance();
    if (drafts.isEmpty) {
      await prefs.remove(_key(principalId));
    } else {
      await prefs.setString(_key(principalId), jsonEncode(drafts));
    }
  }

  @override
  Future<void> clearAll() async {
    final prefs = await SharedPreferences.getInstance();
    for (final key in prefs.getKeys().where((k) => k.startsWith(_prefix)).toList()) {
      await prefs.remove(key);
    }
  }
}

/// Keeps drafts in memory: the default for a build without storage, and for tests.
@visibleForTesting
class InMemoryDraftStore implements DraftStore {
  final saved = <String, Map<String, String>>{};

  @override
  Future<Map<String, String>> load(String principalId) async => Map.of(saved[principalId] ?? const {});

  @override
  Future<void> save(String principalId, Map<String, String> drafts) async => saved[principalId] = Map.of(drafts);

  @override
  Future<void> clearAll() async => saved.clear();
}
