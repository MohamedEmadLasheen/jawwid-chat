import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';

import '../../../app/providers.dart';
import '../../../shared/models/auth.dart';
import '../../../shared/models/user_role.dart';
import '../../auth/domain/auth_state.dart';
import '../data/app_lock_authenticator.dart';
import '../data/app_lock_store.dart';
import '../domain/app_lock_settings.dart';

/// Where the lock is.
enum AppLockPhase {
  /// Nothing over the app.
  unlocked,

  /// A restored session whose preference is still being read. Covered -- blank, not the
  /// lock screen -- so a protected screen cannot flash before the answer is known.
  pending,

  /// The lock screen is up.
  locked,
}

/// What the gate renders.
@immutable
class AppLockState {
  const AppLockState({
    this.actorId,
    this.settings = AppLockSettings.initial,
    this.available = false,
    this.phase = AppLockPhase.unlocked,
    this.obscured = false,
    this.offerVisible = false,
    this.authenticating = false,
    this.lastAttemptFailed = false,
  });

  /// Whose preference [settings] is. Null when nobody is signed in.
  final String? actorId;

  final AppLockSettings settings;

  /// The device can authenticate its owner (biometrics or a passcode).
  final bool available;

  final AppLockPhase phase;

  /// The app is not in the foreground and the lock is on: the privacy cover hides the
  /// content from the app switcher's snapshot.
  final bool obscured;

  /// The one-time "lock the app?" offer is on screen.
  final bool offerVisible;

  /// A system prompt is up.
  final bool authenticating;

  /// The last unlock attempt did not succeed.
  final bool lastAttemptFailed;

  /// The lock is on AND can work on this device.
  bool get active => actorId != null && settings.enabled && available;

  bool get covered => phase != AppLockPhase.unlocked;

  AppLockState copyWith({
    AppLockSettings? settings,
    bool? available,
    AppLockPhase? phase,
    bool? obscured,
    bool? offerVisible,
    bool? authenticating,
    bool? lastAttemptFailed,
  }) =>
      AppLockState(
        actorId: actorId,
        settings: settings ?? this.settings,
        available: available ?? this.available,
        phase: phase ?? this.phase,
        obscured: obscured ?? this.obscured,
        offerVisible: offerVisible ?? this.offerVisible,
        authenticating: authenticating ?? this.authenticating,
        lastAttemptFailed: lastAttemptFailed ?? this.lastAttemptFailed,
      );
}

/// The clock the background timeout is measured with. Overridden in tests.
final appLockClockProvider = Provider<DateTime Function()>((ref) => DateTime.now);

/// PD-23 app lock.
///
/// ## What it is
///
/// A screen over the EXISTING session -- not a credential, and not a re-encryption of the
/// tokens. The refresh token stays in `SecureTokenStore` exactly as before, because
/// background refresh, push registration and answering an incoming call (possibly from a
/// cold start) must all keep working while the lock is up.
///
/// ## When it locks
///
/// * On a cold start that RESTORES a session (never straight after a password sign-in --
///   the user has just proved who they are).
/// * When the app comes back to the foreground after being in the background for at least
///   the chosen timeout.
///
/// ## Defaults (owner decisions)
///
/// * Staff ([UserRole.sales], which includes the super admin) have it ON by default, unless
///   the device can authenticate nobody -- then the default silently does not apply.
/// * Parents and teachers opt in: a one-time offer after the first password sign-in on this
///   device, never shown again once answered.
class AppLockController extends Notifier<AppLockState> {
  /// Bumped whenever the signed-in account changes, so an in-flight read for the previous
  /// account cannot land on the next one.
  int _generation = 0;

  /// When the app last left the foreground, or null while it is in it.
  DateTime? _backgroundedAt;

  /// Guards the window the system prompt itself takes the app out of the foreground (the
  /// Android device-credential screen pauses the activity; Face ID makes iOS inactive). A
  /// background spent INSIDE the prompt must never re-lock the app it just unlocked.
  bool _prompting = false;

  /// The last lifecycle state seen. Leaving the foreground is a step DOWN into hidden or
  /// paused; the same states are passed again on the way back UP, and those must not start
  /// a fresh "away since" -- or coming back from the system prompt would lock at once.
  AppLifecycleState _lifecycle = AppLifecycleState.resumed;

  @override
  AppLockState build() {
    _generation++;
    _backgroundedAt = null;
    _prompting = false;

    // The controller itself, not a provider derived from it: a derived provider is
    // recomputed on Riverpod's next flush, which both coalesces AuthSigningIn away (making a
    // password sign-in look like a restore) and lands after the frame that could have shown
    // a protected route. A Notifier's own listeners hear every change, synchronously.
    //
    // A container with no auth wired (a screen test that never needed one) is "nobody is
    // signed in", the same judgement `principalIdProvider` makes.
    ref.listen<AuthState>(
      authControllerProvider,
      _onAuthChanged,
      onError: (_, _) {},
    );

    // Built after a session already exists -- the restore finished before anything read
    // this. That is still a cold start.
    AuthState? auth;
    try {
      auth = ref.read(authControllerProvider);
    } catch (error) {
      final cause = error is ProviderException ? error.exception : error;
      if (cause is! UnimplementedError) rethrow;
    }
    if (auth case AuthAuthenticated(:final principal)) {
      final generation = _generation;
      Future.microtask(() {
        if (ref.mounted && generation == _generation) {
          _adopt(principal, restored: true);
        }
      });
      return AppLockState(actorId: principal.id, phase: AppLockPhase.pending);
    }
    return const AppLockState();
  }

  AppLockStore get _store => ref.read(appLockStoreProvider);
  AppLockAuthenticator get _authenticator => ref.read(appLockAuthenticatorProvider);
  DateTime _now() => ref.read(appLockClockProvider)();

  void _onAuthChanged(AuthState? previous, AuthState? next) {
    if (next is AuthAuthenticated) {
      // A re-read of the same principal (a rename) is not a new session.
      if (previous is AuthAuthenticated && previous.principal.id == next.principal.id) return;
      // A password sign-in is the one path through AuthSigningIn. Anything else that lands
      // on Authenticated -- AuthUnknown, AuthUnreachable's retry -- is a restore.
      _adopt(next.principal, restored: previous is! AuthSigningIn);
      return;
    }
    if (next is AuthSignedOut || next == null) {
      // The session is over: nothing to lock. The preference itself is kept -- signing out
      // must never delete anybody's choice, this account's or another's.
      _generation++;
      _backgroundedAt = null;
      state = const AppLockState();
    }
  }

  Future<void> _adopt(AuthUser principal, {required bool restored}) async {
    final generation = ++_generation;
    _backgroundedAt = null;
    state = AppLockState(
      actorId: principal.id,
      phase: restored ? AppLockPhase.pending : AppLockPhase.unlocked,
    );

    final available = await _authenticator.isAvailable();
    AppLockSettings? stored;
    try {
      stored = await _store.read(principal.id);
    } catch (_) {
      // Unreadable: treated as "never chosen" below. For a parent or teacher that means
      // unlocked; for staff it means the default applies.
      stored = null;
    }
    if (!ref.mounted || generation != _generation) return;

    var settings = stored ?? AppLockSettings.initial;
    final isStaff = principal.role == UserRole.sales;
    if (stored == null && isStaff && available) {
      // Staff: on by default. Recorded as answered so no offer is ever shown to them.
      settings = settings.copyWith(enabled: true, offerAnswered: true);
      unawaited(_persist(principal.id, settings));
    }

    final offer = !restored && !isStaff && available && !settings.enabled && !settings.offerAnswered;
    // A lock the device cannot open would be a lock-out, so "enabled" without a way to
    // authenticate does not lock.
    final lock = restored && settings.enabled && available;

    state = state.copyWith(
      settings: settings,
      available: available,
      phase: lock ? AppLockPhase.locked : AppLockPhase.unlocked,
      offerVisible: offer,
    );
  }

  /// From the gate's lifecycle observer.
  void onLifecycle(AppLifecycleState lifecycle) {
    final previous = _lifecycle;
    _lifecycle = lifecycle;
    final goingDown = previous == AppLifecycleState.resumed ||
        previous == AppLifecycleState.inactive;
    switch (lifecycle) {
      case AppLifecycleState.resumed:
        final since = _backgroundedAt;
        _backgroundedAt = null;
        var phase = state.phase;
        if (since != null && state.active && phase == AppLockPhase.unlocked) {
          final away = _now().difference(since);
          if (away >= state.settings.timeout.duration) phase = AppLockPhase.locked;
        }
        state = state.copyWith(
          obscured: false,
          phase: phase,
          // A fresh lock starts without the previous attempt's failure line.
          lastAttemptFailed: phase != state.phase ? false : null,
        );
      case AppLifecycleState.inactive:
        if (state.active && !state.obscured) state = state.copyWith(obscured: true);
      case AppLifecycleState.hidden:
      case AppLifecycleState.paused:
        if (goingDown && !_prompting && state.actorId != null) _backgroundedAt ??= _now();
        if (state.active && !state.obscured) state = state.copyWith(obscured: true);
      case AppLifecycleState.detached:
        break;
    }
  }

  /// The lock screen's Unlock (and its one automatic prompt). [reason] is the localized line
  /// the system prompt shows.
  Future<void> unlock({required String reason}) async {
    if (_prompting || state.phase != AppLockPhase.locked) return;
    final generation = _generation;
    final ok = await _prompt(reason);
    if (!ref.mounted || generation != _generation) return;
    state = ok
        ? state.copyWith(phase: AppLockPhase.unlocked, lastAttemptFailed: false)
        : state.copyWith(lastAttemptFailed: true);
  }

  /// Settings' toggle. Turning the lock ON requires a successful prompt first -- it proves
  /// the device can open what is about to be locked. Returns whether the change was made.
  Future<bool> setEnabled(bool enabled, {required String reason}) async {
    final actorId = state.actorId;
    if (actorId == null) return false;
    if (enabled && !state.available) return false;
    if (enabled == state.settings.enabled) return true;
    if (enabled) {
      final generation = _generation;
      final ok = await _prompt(reason);
      if (!ok || !ref.mounted || generation != _generation) return false;
    }
    final settings = state.settings.copyWith(enabled: enabled, offerAnswered: true);
    state = state.copyWith(settings: settings, offerVisible: false);
    await _persist(actorId, settings);
    return true;
  }

  Future<void> setTimeout(AppLockTimeout timeout) async {
    final actorId = state.actorId;
    if (actorId == null || timeout == state.settings.timeout) return;
    final settings = state.settings.copyWith(timeout: timeout);
    state = state.copyWith(settings: settings);
    await _persist(actorId, settings);
  }

  /// The one-time offer, answered. Either answer -- including dismissing it -- records it
  /// as answered, so it is never shown again for this account on this device. Accepting
  /// still has to pass the system prompt before the lock turns on.
  Future<void> answerOffer({required bool accept, required String reason}) async {
    final actorId = state.actorId;
    if (actorId == null || !state.offerVisible) return;
    final answered = state.settings.copyWith(offerAnswered: true);
    state = state.copyWith(settings: answered, offerVisible: false);
    await _persist(actorId, answered);
    if (accept) await setEnabled(true, reason: reason);
  }

  Future<bool> _prompt(String reason) async {
    _prompting = true;
    state = state.copyWith(authenticating: true, lastAttemptFailed: false);
    try {
      return await _authenticator.authenticate(reason: reason);
    } finally {
      _prompting = false;
      // Anything the prompt itself caused is not time the user spent away.
      _backgroundedAt = null;
      if (ref.mounted) state = state.copyWith(authenticating: false);
    }
  }

  Future<void> _persist(String actorId, AppLockSettings settings) async {
    try {
      await _store.write(actorId, settings);
    } catch (_) {
      // The choice still holds for this launch.
    }
  }
}

final appLockControllerProvider =
    NotifierProvider<AppLockController, AppLockState>(AppLockController.new);
