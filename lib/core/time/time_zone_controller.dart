import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/providers.dart';
import '../../features/auth/presentation/web_portal_gate.dart';
import '../../shared/utils/app_clock.dart';
import 'time_zone_api.dart';

/// What Settings -> Date & time shows.
class TimeZoneState {
  const TimeZoneState({required this.deviceZone, required this.setting});

  /// The phone's OS zone right now, or null when the platform did not say.
  final String? deviceZone;

  /// The account's setting on the server, or null in a build without one.
  final TimeZoneSetting? setting;

  bool get automatic => setting?.automatic ?? true;

  /// The zone this device shows times in.
  String? get effectiveZone => automatic ? deviceZone : setting?.timeZone;
}

/// Bumped whenever the zone times are shown in changes, so screens that cached
/// already-converted times load them again (see `SessionScoped.bindToSession`).
final appZoneRevisionProvider = NotifierProvider<AppZoneRevision, int>(AppZoneRevision.new);

class AppZoneRevision extends Notifier<int> {
  @override
  int build() => 0;

  void bump() => state++;
}

/// PD-22: keeps the account's time zone in step with the phone, like a phone does.
///
/// * a session begins, or the app returns to the foreground
///     -> read the phone's OS zone and report it; the server keeps it while the
///        setting is automatic, and answers with the setting either way
/// * the person turns "Set automatically" off and picks a zone, or back on
///     -> PUT the choice
///
/// The answer decides [AppClock]: automatic follows the phone (`toLocal`), manual
/// pins the picked zone. No location is read -- the OS zone is what a phone itself
/// uses, and it changes on its own when the person lands somewhere else.
final timeZoneControllerProvider =
    AsyncNotifierProvider<TimeZoneController, TimeZoneState>(TimeZoneController.new);

class TimeZoneController extends AsyncNotifier<TimeZoneState> {
  AppLifecycleListener? _lifecycle;

  @override
  Future<TimeZoneState> build() async {
    final principal = ref.watch(principalIdProvider);
    _lifecycle?.dispose();
    _lifecycle = null;
    ref.onDispose(() => _lifecycle?.dispose());

    // PD-28: an account the web portal turned away is not reported for: the browser it opened
    // is not where it lives.
    final refused = ref.watch(webPortalRefusedProvider);
    final api = principal == null || refused ? null : ref.watch(timeZoneApiProvider);
    final device = await _deviceZone();
    if (api == null) {
      _apply(null);
      return TimeZoneState(deviceZone: device, setting: null);
    }

    _lifecycle = AppLifecycleListener(onResume: () => unawaited(refreshFromDevice()));
    return _report(api, device);
  }

  /// The app came back: the phone may be in another country now.
  Future<void> refreshFromDevice() async {
    final api = ref.read(timeZoneApiProvider);
    if (api == null || ref.read(principalIdProvider) == null) return;
    final device = await _deviceZone();
    final before = state.value?.deviceZone;
    final next = await _report(api, device);
    state = AsyncData(next);
    // Automatic times follow the OS by themselves; cached lists reload so day
    // headings ("today") match the new place too.
    if (before != device && next.automatic) ref.read(appZoneRevisionProvider.notifier).bump();
  }

  /// "Set automatically" on (follow this phone) or off (keep showing [zone]).
  Future<void> setAutomatic(bool automatic) async {
    final current = state.value;
    final zone = automatic ? current?.deviceZone : current?.effectiveZone;
    if (zone == null) return;
    await _set(automatic: automatic, zone: zone);
  }

  /// A zone picked by hand. Turns "Set automatically" off.
  Future<void> pick(String zone) => _set(automatic: false, zone: zone);

  Future<void> _set({required bool automatic, required String zone}) async {
    final api = ref.read(timeZoneApiProvider);
    if (api == null) return;
    final device = state.value?.deviceZone;
    final setting = await api.set(automatic: automatic, timeZone: zone);
    _apply(setting);
    state = AsyncData(TimeZoneState(deviceZone: device, setting: setting));
  }

  Future<TimeZoneState> _report(TimeZoneApi api, String? device) async {
    TimeZoneSetting? setting;
    try {
      setting = device == null ? await api.get() : await api.reportDevice(device);
    } on Object {
      // Offline or refused: keep showing the phone's time; the next resume retries.
      ref.read(loggerProvider).warn('time zone: the setting could not be synced');
    }
    _apply(setting);
    return TimeZoneState(deviceZone: device, setting: setting);
  }

  Future<String?> _deviceZone() async {
    try {
      return await ref.read(deviceTimeZoneProvider).current();
    } on Object {
      return null;
    }
  }

  void _apply(TimeZoneSetting? setting) {
    final manual = setting != null && !setting.automatic ? setting.timeZone : null;
    if (manual == AppClock.manualZone) return;
    AppClock.useZone(manual);
    ref.read(appZoneRevisionProvider.notifier).bump();
  }
}

/// Starts the sync for the life of the app. Called once, from `main`; listened, not
/// read, for the reason `startPushRegistration` gives.
ProviderSubscription<AsyncValue<TimeZoneState>> startTimeZoneSync(ProviderContainer container) {
  AppClock.ensureInitialized();
  return container.listen<AsyncValue<TimeZoneState>>(timeZoneControllerProvider, (_, _) {});
}
