import 'dart:convert';

import 'package:collection/collection.dart';

import '../../../core/storage/browser_storage.dart';
import '../../../core/storage/secure_token_store.dart';
import '../domain/mentions.dart';

/// PD-37: one conversation's unsent message -- its text, and the people or
/// roles picked from the @ list in it, so a restored "@Name" is still a
/// mention when it is sent.
class Draft {
  const Draft(this.text, {this.mentions = const []});

  final String text;
  final List<PickedMention> mentions;

  bool get isBlank => text.trim().isEmpty;

  Map<String, Object?> toJson() => {
        'text': text,
        if (mentions.isNotEmpty)
          'mentions': [
            for (final m in mentions)
              {'label': m.label, if (m.actorId != null) 'actorId': m.actorId, if (m.role != null) 'role': m.role},
          ],
      };

  /// Null for anything that is not a draft: a damaged entry is dropped, never shown.
  static Draft? fromJson(Object? json) {
    if (json is! Map || json['text'] is! String) return null;
    final mentions = <PickedMention>[];
    final raw = json['mentions'];
    if (raw is List) {
      for (final m in raw) {
        if (m is! Map || m['label'] is! String) continue;
        final label = m['label'] as String;
        if (m['actorId'] is String) {
          mentions.add(PickedMention.person(label, m['actorId'] as String));
        } else if (m['role'] is String) {
          mentions.add(PickedMention.role(label, m['role'] as String));
        }
      }
    }
    return Draft(json['text'] as String, mentions: mentions);
  }

  @override
  bool operator ==(Object other) =>
      other is Draft &&
      other.text == text &&
      const ListEquality<String>().equals(_keys(other.mentions), _keys(mentions));

  @override
  int get hashCode => Object.hash(text, Object.hashAll(_keys(mentions)));

  static List<String> _keys(List<PickedMention> ms) => [for (final m in ms) '${m.label}|${m.actorId}|${m.role}'];
}

/// PD-37: unsent drafts, per account and per conversation, kept on this device
/// only -- they never reach the server. One entry per account, so one person's
/// drafts are never loaded for another on a shared phone.
abstract interface class DraftStore {
  Future<Map<String, Draft>> load(String principalId);

  /// Writes [drafts] -- unless the store was cleared since [generation] was
  /// read, so a save that was already waiting when the person signed out can
  /// never bring their drafts back.
  Future<void> save(String principalId, Map<String, Draft> drafts, {required int generation});

  /// Sign-out: forget every account's drafts on this device.
  Future<void> clearAll();

  /// Moves on at every [clearAll]; read it when the text is typed.
  int get generation;

  /// Called at the start of every [clearAll]. Returns the unsubscribe.
  void Function() onCleared(void Function() listener);
}

/// The generation and the clear listeners, shared by both stores.
mixin _ClearGenerations {
  int _generation = 0;
  final _listeners = <void Function()>[];

  int get generation => _generation;

  void Function() onCleared(void Function() listener) {
    _listeners.add(listener);
    return () => _listeners.remove(listener);
  }

  /// First, and synchronously: from here no earlier save may write.
  void _markCleared() {
    _generation++;
    for (final l in List.of(_listeners)) {
      l();
    }
  }
}

Map<String, Draft> _decode(String? raw) {
  if (raw == null) return const {};
  try {
    final decoded = jsonDecode(raw);
    if (decoded is! Map) return const {};
    return {
      for (final e in decoded.entries)
        if (e.key is String && Draft.fromJson(e.value) != null) e.key as String: Draft.fromJson(e.value)!,
    };
  } on FormatException {
    return const {}; // a damaged entry is dropped, never shown
  }
}

String _encode(Map<String, Draft> drafts) => jsonEncode({for (final e in drafts.entries) e.key: e.value.toJson()});

/// The phone's secure storage: the Keychain (this device only, never in a
/// backup) and Android's Keystore-backed storage -- where the session tokens
/// already live, and through the same one door (DeviceKeychain). A child's
/// unsent words are kept no less carefully.
class SecureDraftStore with _ClearGenerations implements DraftStore {
  SecureDraftStore({DeviceKeychain keychain = const SecureDeviceKeychain()}) : _keychain = keychain;

  static const _prefix = 'jawwid.drafts.';
  static String _key(String principalId) => '$_prefix$principalId';

  final DeviceKeychain _keychain;

  @override
  Future<Map<String, Draft>> load(String principalId) async => _decode(await _keychain.read(_key(principalId)));

  @override
  Future<void> save(String principalId, Map<String, Draft> drafts, {required int generation}) async {
    if (generation != _generation) return;
    if (drafts.isEmpty) {
      await _keychain.delete(_key(principalId));
    } else {
      await _keychain.write(_key(principalId), _encode(drafts));
    }
  }

  @override
  Future<void> clearAll() async {
    _markCleared();
    final keys = (await _keychain.keys()).where((k) => k.startsWith(_prefix)).toList();
    for (final key in keys) {
      await _keychain.delete(key);
    }
  }
}

/// Drafts in memory only: the web (a browser profile is not a place for a
/// child's unsent words), fixture builds and tests. Lost when the app closes.
class InMemoryDraftStore with _ClearGenerations implements DraftStore {
  final saved = <String, Map<String, Draft>>{};

  @override
  Future<Map<String, Draft>> load(String principalId) async => Map.of(saved[principalId] ?? const {});

  @override
  Future<void> save(String principalId, Map<String, Draft> drafts, {required int generation}) async {
    if (generation != _generation) return;
    saved[principalId] = Map.of(drafts);
  }

  @override
  Future<void> clearAll() async {
    _markCleared();
    saved.clear();
  }
}

/// The store this platform keeps drafts in.
DraftStore platformDraftStore() => browserBindings() == null ? SecureDraftStore() : InMemoryDraftStore();
