import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_timezone/flutter_timezone.dart';

import '../network/api_client.dart';

/// PD-22: the account's time-zone setting, as the server stores it.
class TimeZoneSetting {
  const TimeZoneSetting({required this.timeZone, required this.automatic});

  factory TimeZoneSetting.fromJson(Map<String, Object?> json) => TimeZoneSetting(
        timeZone: json['timeZone'] as String?,
        automatic: json['automatic'] != false,
      );

  /// The IANA zone, or null before any phone has reported one.
  final String? timeZone;

  /// True: follows the phone. False: picked by hand.
  final bool automatic;

  @override
  bool operator ==(Object other) =>
      other is TimeZoneSetting && other.timeZone == timeZone && other.automatic == automatic;

  @override
  int get hashCode => Object.hash(timeZone, automatic);
}

/// `/me/time-zone`. Every answer is the stored setting, so a manual choice made on
/// another device is adopted here too.
abstract interface class TimeZoneApi {
  Future<TimeZoneSetting> get();

  /// The phone's OS zone. Kept by the server only while the setting is automatic.
  Future<TimeZoneSetting> reportDevice(String timeZone);

  Future<TimeZoneSetting> set({required bool automatic, required String timeZone});
}

class HttpTimeZoneApi implements TimeZoneApi {
  HttpTimeZoneApi({required ApiClient client}) : _client = client;

  final ApiClient _client;

  @override
  Future<TimeZoneSetting> get() async {
    final r = await _client.get<Map<String, Object?>>('/me/time-zone');
    return TimeZoneSetting.fromJson(r.data ?? const {});
  }

  @override
  Future<TimeZoneSetting> reportDevice(String timeZone) async {
    final r = await _client.post<Map<String, Object?>>('/me/time-zone/device', data: {'timeZone': timeZone});
    return TimeZoneSetting.fromJson(r.data ?? const {});
  }

  @override
  Future<TimeZoneSetting> set({required bool automatic, required String timeZone}) async {
    final r = await _client.put<Map<String, Object?>>(
      '/me/time-zone',
      data: {'automatic': automatic, 'timeZone': timeZone},
    );
    return TimeZoneSetting.fromJson(r.data ?? const {});
  }
}

/// Overridden in `bootstrap.dart` with the implementation on the shared [ApiClient].
/// A build without one (fake, tests) has no server setting: times follow the phone.
final timeZoneApiProvider = Provider<TimeZoneApi?>((ref) => null);

/// Where the phone's OS zone comes from. Overridable so tests never touch a channel.
abstract interface class DeviceTimeZone {
  /// The IANA name of the phone's current zone, e.g. `Asia/Kuwait`.
  Future<String> current();
}

class PlatformDeviceTimeZone implements DeviceTimeZone {
  const PlatformDeviceTimeZone();

  @override
  Future<String> current() async => (await FlutterTimezone.getLocalTimezone()).identifier;
}

final deviceTimeZoneProvider = Provider<DeviceTimeZone>((ref) => const PlatformDeviceTimeZone());
