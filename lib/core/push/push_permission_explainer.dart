import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// LR-11 (explain-first): the in-app explanation that comes BEFORE the system
/// notification prompt.
///
/// The native `start` on the push channel is what makes the OS ask: Android 13+
/// requests POST_NOTIFICATIONS and iOS requests notification authorization. Called
/// cold, straight after sign-in, the person meets a system dialog with no idea why
/// Jawwid wants it. So [PushRegistrar] asks [PushExplainer.clearToStart] first, and
/// only a "Continue" on the explanation lets it call `start`.
///
/// Token registration is NOT gated: the registrar calls the native `register` (the
/// same as `start` minus the permission request) as soon as a session begins, so a
/// "Not now", an unanswered explanation, or a start with no screen at all still
/// leaves this device registered. Without the permission the OS shows no banners;
/// calls on iOS still ring through PushKit and CallKit. And where `register` reports
/// that there is no prompt left to show (Android before 13, already granted, iOS
/// already answered), the explanation is skipped entirely.
///
/// ## What is remembered, and for whom
///
/// The channel exposes no permission status, so this keeps its own memory, on the
/// DEVICE (`shared_preferences`, like the language and theme choices), never on the
/// server:
///
///  * **Continue, once** -> never shown again on this device. The OS has asked by
///    then and owns the answer; a second account signing in on the same phone is not
///    shown it either, because the permission belongs to the app, not to the account.
///  * **Not now** -> the permission is not asked for the rest of this session (tokens
///    are still registered), and the
///    explanation is not shown again for [pushExplainerSnooze]: the next app start or
///    sign-in after that asks again. At most once a day.
///
/// The Settings row (LR-11b, `notification_permission.dart`) reuses this same
/// question for its first ask (`askFromSettings`); it never shows a second one.
///
/// An unreadable store means "never answered" (explain again), never "continued": the
/// point of this is that the system prompt never comes first.
///
/// ## What it does NOT change
///
/// Who receives pushes, how and when tokens are registered or retired, and every
/// server call stay exactly as they were; this only decides WHEN the notification
/// permission is first asked for.
abstract interface class PushExplainerStore {
  /// Whether anybody on this device pressed Continue.
  Future<bool> continued();

  Future<void> markContinued();

  /// When "Not now" was last pressed on this device, or null.
  Future<DateTime?> declinedAt();

  Future<void> markDeclined(DateTime at);
}

class SharedPreferencesPushExplainerStore implements PushExplainerStore {
  const SharedPreferencesPushExplainerStore();

  static const _continuedKey = 'jawwid.push_explainer.continued';
  static const _declinedKey = 'jawwid.push_explainer.declined_at';

  @override
  Future<bool> continued() async =>
      (await SharedPreferences.getInstance()).getBool(_continuedKey) ?? false;

  @override
  Future<void> markContinued() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_continuedKey, true);
    await prefs.remove(_declinedKey);
  }

  @override
  Future<DateTime?> declinedAt() async {
    final ms = (await SharedPreferences.getInstance()).getInt(_declinedKey);
    return ms == null ? null : DateTime.fromMillisecondsSinceEpoch(ms, isUtc: true);
  }

  @override
  Future<void> markDeclined(DateTime at) async =>
      (await SharedPreferences.getInstance()).setInt(_declinedKey, at.millisecondsSinceEpoch);
}

/// Holds the answers for a test, and can refuse to read or write.
@visibleForTesting
class FakePushExplainerStore implements PushExplainerStore {
  FakePushExplainerStore({
    this.hasContinued = false,
    this.lastDeclined,
    this.readThrows = false,
    this.writeThrows = false,
  });

  bool hasContinued;
  DateTime? lastDeclined;
  bool readThrows;
  bool writeThrows;

  @override
  Future<bool> continued() async {
    if (readThrows) throw Exception('storage unavailable');
    return hasContinued;
  }

  @override
  Future<void> markContinued() async {
    if (writeThrows) throw Exception('storage unavailable');
    hasContinued = true;
    lastDeclined = null;
  }

  @override
  Future<DateTime?> declinedAt() async {
    if (readThrows) throw Exception('storage unavailable');
    return lastDeclined;
  }

  @override
  Future<void> markDeclined(DateTime at) async {
    if (writeThrows) throw Exception('storage unavailable');
    lastDeclined = at;
  }
}

final pushExplainerStoreProvider = Provider<PushExplainerStore>(
  (ref) => const SharedPreferencesPushExplainerStore(),
);

/// The clock "Not now" is measured with. Overridden in tests.
final pushExplainerClockProvider = Provider<DateTime Function()>((ref) => DateTime.now);

/// How long a "Not now" holds on this device: at most one explanation a day.
const pushExplainerSnooze = Duration(hours: 24);

/// Where the explanation is.
enum PushExplainerPhase {
  /// Nothing to show: never asked, already answered, or snoozed.
  idle,

  /// A session is waiting for an answer; the host shows the dialog when it may.
  waiting,

  /// A host has the dialog on screen.
  onScreen,
}

/// The one question for this device, and its answer.
///
/// One question, however many sessions wait on it: if an account signs out with the
/// dialog open and another signs in, both registrars wait on the same answer, and
/// [PushRegistrar] lets only the live session act on it.
class PushExplainer extends Notifier<PushExplainerPhase> {
  Completer<bool>? _pending;

  /// The Settings row's dialog while it is on screen ([askFromSettings]).
  Object? _settingsDialog;

  @override
  PushExplainerPhase build() => PushExplainerPhase.idle;

  DateTime _now() => ref.read(pushExplainerClockProvider)();

  /// Resolves true when the platform may be asked now, false when it may not
  /// (this session). Waits for the person's answer when one is needed.
  Future<bool> clearToStart() async {
    final store = ref.read(pushExplainerStoreProvider);
    var continued = false;
    DateTime? declined;
    try {
      continued = await store.continued();
      declined = await store.declinedAt();
    } catch (_) {
      // Unreadable: treated as never answered. Explaining twice is harmless;
      // a cold system prompt is what this exists to prevent.
    }
    if (!ref.mounted) return false;
    if (continued) return true;
    // `abs`: a clock set back must not snooze the question for a year.
    if (declined != null && _now().difference(declined).abs() < pushExplainerSnooze) {
      return false;
    }

    final pending = _pending ??= Completer<bool>();
    if (state == PushExplainerPhase.idle) state = PushExplainerPhase.waiting;
    return pending.future;
  }

  /// A host takes the screen. False when another host already has, or nothing is
  /// waiting: a second dialog is never stacked on the first.
  bool claim() {
    if (state != PushExplainerPhase.waiting) return false;
    state = PushExplainerPhase.onScreen;
    return true;
  }

  /// The dialog went away without an answer (its screen was removed under it, a
  /// sign-out). Still waiting: the next host to mount asks again.
  void release() {
    // Called a microtask after a host is disposed: the app may be gone by then.
    if (!ref.mounted) return;
    if (state == PushExplainerPhase.onScreen && _pending != null) {
      state = PushExplainerPhase.waiting;
    }
  }

  /// The person's answer: Continue ([proceed] true) or Not now. Persisted, then
  /// handed to every waiting session. A second answer is ignored.
  Future<void> answer({required bool proceed}) async {
    final pending = _pending;
    if (pending == null) return;
    _pending = null;
    state = PushExplainerPhase.idle;

    await _remember(proceed);
    pending.complete(proceed);
  }

  Future<void> _remember(bool proceed) async {
    final store = ref.read(pushExplainerStoreProvider);
    try {
      if (proceed) {
        await store.markContinued();
      } else {
        await store.markDeclined(_now());
      }
    } catch (_) {
      // Not remembered: the next app start explains again. This session still
      // gets what the person chose.
    }
  }

  /// LR-11b: the FIRST ask from the Settings row ("Notifications on this device")
  /// goes through this same explanation -- there is no second card or prompt.
  ///
  /// [show] puts `PushPermissionExplainerDialog` on screen and returns its answer: true
  /// (Continue), false (Not now) or null (removed unanswered). Resolves true when
  /// the CALLER should now ask the platform (`PushTokens.start`); false when it
  /// should not -- Not now, no answer, a dialog already on screen, or a signed-in
  /// session was already waiting on this question and now asks itself (so the
  /// platform is asked exactly once).
  ///
  /// Already continued on this device: nothing to explain, so true at once. A
  /// "Not now" snooze does not hold here: the person tapped the row to turn
  /// notifications on.
  Future<bool> askFromSettings(Future<bool?> Function() show) async {
    if (state == PushExplainerPhase.onScreen) return false;
    var continued = false;
    try {
      continued = await ref.read(pushExplainerStoreProvider).continued();
    } catch (_) {
      // Unreadable: explain, exactly as `clearToStart` does.
    }
    if (!ref.mounted) return false;
    if (continued) return true;
    // Re-checked after the await: the host may have claimed the screen meanwhile.
    if (state == PushExplainerPhase.onScreen) return false;

    // On screen: the host's `claim` now fails, so its dialog never stacks on this one.
    final dialog = _settingsDialog = Object();
    state = PushExplainerPhase.onScreen;
    bool? proceed;
    try {
      proceed = await show();
    } catch (_) {
      proceed = null;
    }
    if (!ref.mounted) return false;
    // Handed back while open (`releaseFromSettings`): no longer this dialog's
    // question; whatever holds the screen now is left alone.
    if (!identical(_settingsDialog, dialog)) return false;
    _settingsDialog = null;

    if (proceed == null) {
      // Unanswered: anything that was waiting still is.
      state = _pending != null ? PushExplainerPhase.waiting : PushExplainerPhase.idle;
      return false;
    }

    final pending = _pending;
    _pending = null;
    state = PushExplainerPhase.idle;
    await _remember(proceed);
    if (pending != null) {
      // A session was waiting on this question: the answer is its, and on Continue
      // it calls `start` itself.
      pending.complete(proceed);
      return false;
    }
    return proceed;
  }

  /// The Settings row's dialog ([askFromSettings]) was torn down unanswered: the
  /// row was removed with it open, and its future may never complete (its whole
  /// navigator went). The claim is handed back as the host's `release` does:
  /// whatever was waiting still is, and the next host to mount asks; nothing
  /// waiting, nothing to show. That dialog's answer, if it ever comes, is ignored.
  void releaseFromSettings() {
    // Called a microtask after the row is disposed: the app may be gone by then.
    if (!ref.mounted) return;
    if (_settingsDialog == null) return;
    _settingsDialog = null;
    if (state == PushExplainerPhase.onScreen) {
      state = _pending != null ? PushExplainerPhase.waiting : PushExplainerPhase.idle;
    }
  }
}

final pushExplainerProvider =
    NotifierProvider<PushExplainer, PushExplainerPhase>(PushExplainer.new);
