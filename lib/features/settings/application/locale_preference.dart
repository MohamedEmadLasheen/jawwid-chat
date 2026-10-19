import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../../app/app.dart';

/// Where the chosen language is remembered.
///
/// `LocaleController` says the settings feature persists the choice; until this existed
/// nothing did, so someone who chose English on an Arabic phone was back in Arabic on every
/// launch. Same shape and the same rules as `ThemeModeStore`: a device preference, kept in
/// `shared_preferences`, never sent to the server, and an unreadable or unknown value means
/// "follow the device", never a guess.
abstract interface class LocaleStore {
  /// The stored language code, or null when the device language is followed.
  Future<String?> read();

  /// Null clears the choice: follow the device again.
  Future<void> write(String? languageCode);
}

class SharedPreferencesLocaleStore implements LocaleStore {
  const SharedPreferencesLocaleStore();

  static const _key = 'jawwid.language';

  @override
  Future<String?> read() async =>
      (await SharedPreferences.getInstance()).getString(_key);

  @override
  Future<void> write(String? languageCode) async {
    final prefs = await SharedPreferences.getInstance();
    if (languageCode == null) {
      await prefs.remove(_key);
    } else {
      await prefs.setString(_key, languageCode);
    }
  }
}

/// Holds the choice for a test, and can refuse to answer.
@visibleForTesting
class FakeLocaleStore implements LocaleStore {
  FakeLocaleStore({this.stored, this.readThrows = false});

  String? stored;
  bool readThrows;
  int writes = 0;

  @override
  Future<String?> read() async {
    if (readThrows) throw Exception('storage unavailable');
    return stored;
  }

  @override
  Future<void> write(String? languageCode) async {
    writes++;
    stored = languageCode;
  }
}

final localeStoreProvider = Provider<LocaleStore>(
  (ref) => const SharedPreferencesLocaleStore(),
);

/// [LocaleController] with memory. Installed by the composition root in place of the
/// in-memory one, so `app.dart` keeps reading the same provider.
class PersistedLocaleController extends LocaleController {
  /// Set once the user chooses during this launch, so a slow read cannot overwrite a choice
  /// made while it was in flight.
  bool _chosen = false;

  @override
  Locale? build() {
    unawaited(_hydrate());
    return null;
  }

  Future<void> _hydrate() async {
    try {
      final stored = decode(await ref.read(localeStoreProvider).read());
      if (!_chosen && ref.mounted && stored != null) state = stored;
    } on Exception {
      // Unreadable storage: follow the device, which is already in place.
    }
  }

  @override
  void set(Locale? locale) {
    _chosen = true;
    super.set(locale);
    unawaited(_persist(locale));
  }

  Future<void> _persist(Locale? locale) async {
    try {
      await ref.read(localeStoreProvider).write(locale?.languageCode);
    } on Exception {
      // The choice still holds for this session.
    }
  }

  /// Only the languages the app ships. Anything else -- a value written by a later version
  /// that knows more languages -- is not one to act on.
  @visibleForTesting
  static Locale? decode(String? code) => switch (code) {
        'ar' => const Locale('ar'),
        'en' => const Locale('en'),
        _ => null,
      };
}
