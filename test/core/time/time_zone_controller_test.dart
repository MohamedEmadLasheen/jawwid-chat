/// PD-22: the account's time zone follows the phone like a phone does, and a zone picked
/// by hand wins until "Set automatically" is turned back on.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/time/time_zone_api.dart';
import 'package:jawwid_chat/core/time/time_zone_controller.dart';
import 'package:jawwid_chat/shared/utils/app_clock.dart';

/// The server's rule, in memory: device reports are kept only while automatic.
class FakeTimeZoneApi implements TimeZoneApi {
  TimeZoneSetting stored = const TimeZoneSetting(timeZone: null, automatic: true);
  final reports = <String>[];

  @override
  Future<TimeZoneSetting> get() async => stored;

  @override
  Future<TimeZoneSetting> reportDevice(String timeZone) async {
    reports.add(timeZone);
    if (stored.automatic) stored = TimeZoneSetting(timeZone: timeZone, automatic: true);
    return stored;
  }

  @override
  Future<TimeZoneSetting> set({required bool automatic, required String timeZone}) async =>
      stored = TimeZoneSetting(timeZone: timeZone, automatic: automatic);
}

class FakeDevice implements DeviceTimeZone {
  FakeDevice(this.zone);
  String zone;

  @override
  Future<String> current() async => zone;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(AppClock.ensureInitialized);
  tearDown(() => AppClock.useZone(null));

  late FakeTimeZoneApi api;
  late FakeDevice device;
  late ProviderContainer container;

  ProviderContainer build({String? principal = 'acct-1'}) => ProviderContainer(
        overrides: [
          principalIdProvider.overrideWithValue(principal),
          timeZoneApiProvider.overrideWithValue(api),
          deviceTimeZoneProvider.overrideWithValue(device),
        ],
      );

  setUp(() {
    api = FakeTimeZoneApi();
    device = FakeDevice('Asia/Kuwait');
  });
  tearDown(() => container.dispose());

  test('a session reports the phone\'s zone and keeps following the phone', () async {
    container = build();
    final state = await container.read(timeZoneControllerProvider.future);
    expect(api.reports, ['Asia/Kuwait']);
    expect(state.automatic, isTrue);
    expect(state.effectiveZone, 'Asia/Kuwait');
    expect(AppClock.manualZone, isNull);

    // Landed in Cairo; the app comes back to the foreground.
    device.zone = 'Africa/Cairo';
    await container.read(timeZoneControllerProvider.notifier).refreshFromDevice();
    expect(api.reports, ['Asia/Kuwait', 'Africa/Cairo']);
    expect(container.read(timeZoneControllerProvider).value!.effectiveZone, 'Africa/Cairo');
  });

  test('a zone picked by hand pins the clock and survives device reports', () async {
    container = build();
    await container.read(timeZoneControllerProvider.future);
    final revision = container.read(appZoneRevisionProvider);

    await container.read(timeZoneControllerProvider.notifier).pick('Africa/Cairo');
    expect(AppClock.manualZone, 'Africa/Cairo');
    expect(container.read(appZoneRevisionProvider), greaterThan(revision));
    expect(container.read(timeZoneControllerProvider).value!.effectiveZone, 'Africa/Cairo');

    device.zone = 'Asia/Dubai';
    await container.read(timeZoneControllerProvider.notifier).refreshFromDevice();
    expect(api.stored, const TimeZoneSetting(timeZone: 'Africa/Cairo', automatic: false));
    expect(AppClock.manualZone, 'Africa/Cairo');

    await container.read(timeZoneControllerProvider.notifier).setAutomatic(true);
    expect(api.stored, const TimeZoneSetting(timeZone: 'Asia/Dubai', automatic: true));
    expect(AppClock.manualZone, isNull);
  });

  test('a manual choice made on another device is adopted at sign-in', () async {
    api.stored = const TimeZoneSetting(timeZone: 'Asia/Riyadh', automatic: false);
    container = build();
    final state = await container.read(timeZoneControllerProvider.future);
    expect(state.automatic, isFalse);
    expect(state.effectiveZone, 'Asia/Riyadh');
    expect(AppClock.manualZone, 'Asia/Riyadh');
  });

  test('signed out, nothing is reported and times follow the phone', () async {
    AppClock.useZone('Asia/Riyadh');
    container = build(principal: null);
    final state = await container.read(timeZoneControllerProvider.future);
    expect(api.reports, isEmpty);
    expect(state.setting, isNull);
    expect(AppClock.manualZone, isNull);
  });
}
