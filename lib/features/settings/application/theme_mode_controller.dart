import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Where the chosen appearance is remembered.
///
/// A seam, not an abstraction for its own sake: the controller must be testable
/// without a platform channel, and the one rule that matters -- an unreadable or
/// absent preference means Auto, never a guess -- is only provable if a fake can
/// return null and throw.
abstract interface class ThemeModeStore {
  /// The stored choice, or null when nothing has been chosen yet.
  Future<ThemeMode?> read();

  Future<void> write(ThemeMode mode);
}

/// `shared_preferences`, which the project already depends on.
///
/// Appearance is a DEVICE preference, not an account one: it does not belong in
/// the keychain beside the tokens, it is not part of the profile, and it is
/// never sent to the server. Someone signing in on a second phone expects that
/// phone's appearance, not this one's.
class SharedPreferencesThemeModeStore implements ThemeModeStore {
  const SharedPreferencesThemeModeStore();

  static const _key = 'jawwid.appearance';

  @override
  Future<ThemeMode?> read() async {
    final prefs = await SharedPreferences.getInstance();
    return _decode(prefs.getString(_key));
  }

  @override
  Future<void> write(ThemeMode mode) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_key, _encode(mode));
  }

  /// Written as a word rather than an enum index, so reordering `ThemeMode`
  /// upstream cannot silently turn everyone's Dark into Light.
  static String _encode(ThemeMode mode) => switch (mode) {
        ThemeMode.light => 'light',
        ThemeMode.dark => 'dark',
        ThemeMode.system => 'system',
      };

  static ThemeMode? _decode(String? raw) => switch (raw) {
        'light' => ThemeMode.light,
        'dark' => ThemeMode.dark,
        'system' => ThemeMode.system,
        // Absent, or written by a version that meant something else. Either way
        // this is not a value to act on.
        _ => null,
      };
}

/// Holds the choice for a test, and can refuse to answer.
@visibleForTesting
class FakeThemeModeStore implements ThemeModeStore {
  FakeThemeModeStore({this.stored, this.readThrows = false});

  ThemeMode? stored;
  bool readThrows;
  int writes = 0;

  @override
  Future<ThemeMode?> read() async {
    if (readThrows) throw Exception('storage unavailable');
    return stored;
  }

  @override
  Future<void> write(ThemeMode mode) async {
    writes++;
    stored = mode;
  }
}

final themeModeStoreProvider = Provider<ThemeModeStore>(
  (ref) => const SharedPreferencesThemeModeStore(),
);

/// The appearance the app renders in.
///
/// Starts at [ThemeMode.system] -- Auto -- and stays there unless a stored
/// choice says otherwise. That ordering is the whole point: a first launch, a
/// launch before the read completes, and a launch where storage fails all land
/// on Auto, which is the documented default. Nothing here ever decides Light or
/// Dark on its own.
///
/// Auto is not "whichever theme was active at startup": `MaterialApp.themeMode`
/// with [ThemeMode.system] re-resolves against the platform brightness, so
/// flipping the device appearance moves the app with it, live.
class ThemeModeController extends Notifier<ThemeMode> {
  @override
  ThemeMode build() {
    _hydrate();
    return ThemeMode.system;
  }

  Future<void> _hydrate() async {
    try {
      final stored = await ref.read(themeModeStoreProvider).read();
      // A null read is not a correction. Leaving the state alone keeps Auto,
      // and also avoids stamping on a choice the user made while the read was
      // still in flight.
      if (stored != null && stored != state) state = stored;
    } on Exception {
      // Unreadable storage is not a reason to show someone the wrong theme.
      // Auto is already in place.
    }
  }

  /// Choose an appearance. Applies immediately; persistence follows.
  Future<void> set(ThemeMode mode) async {
    state = mode;
    try {
      await ref.read(themeModeStoreProvider).write(mode);
    } on Exception {
      // The choice still holds for this session. Failing to persist a UI
      // preference is not worth interrupting anyone over.
    }
  }
}

final themeModeProvider =
    NotifierProvider<ThemeModeController, ThemeMode>(ThemeModeController.new);
