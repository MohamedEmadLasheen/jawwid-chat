import 'package:timezone/data/latest_all.dart' as tzdata;
import 'package:timezone/timezone.dart' as tz;

/// PD-22: the ONE place an instant becomes a wall-clock time on this device.
///
/// Every moment arrives from the server as an instant (ISO with `Z`). It is shown in
/// the account's zone, which is one of two things, exactly as on a phone:
///
/// * **automatic** (the default): the phone's own zone, which the OS keeps current as
///   the person travels. Here [view] is just `toLocal()`.
/// * **manual**: a zone the person picked in Settings -> Date & time. Here [view]
///   converts with the IANA database bundled by `package:timezone`.
///
/// Static rather than a provider because instants are parsed in static mappers
/// (`WireMappers.parseTime`) far from any `ref`. The zone is set only by
/// `TimeZoneSync`, from what the server says the account's setting is.
abstract final class AppClock {
  static tz.Location? _manual;
  static bool _initialized = false;

  /// Loads the zone database. Idempotent. The FULL set, aliases included: phones report
  /// names like `Asia/Kuwait`, which the smaller sets leave out as links to `Asia/Riyadh`.
  static void ensureInitialized() {
    if (_initialized) return;
    tzdata.initializeTimeZones();
    _initialized = true;
  }

  /// The picked zone, or null when times follow the phone.
  static String? get manualZone => _manual?.name;

  /// Follow [zoneName], or the phone when null. An unknown name falls back to the phone
  /// rather than throwing: a wrong clock is better than a blank screen.
  static void useZone(String? zoneName) {
    if (zoneName == null) {
      _manual = null;
      return;
    }
    ensureInitialized();
    try {
      _manual = tz.getLocation(zoneName);
    } on Object {
      _manual = null;
    }
  }

  /// [instant] as a wall-clock time in the account's zone. Its `year`/`hour`/`weekday`
  /// fields are what the person's clock reads; comparisons stay instant-based.
  static DateTime view(DateTime instant) {
    final manual = _manual;
    return manual == null ? instant.toLocal() : tz.TZDateTime.from(instant, manual);
  }

  /// [instant] as a wall-clock time in [zoneName] -- for a view whose days the server
  /// cut in a zone it names (PD-38's calendar), so the two can never disagree about
  /// which day a lesson is on. An unknown name falls back to [view].
  static DateTime viewIn(DateTime instant, String zoneName) {
    ensureInitialized();
    try {
      return tz.TZDateTime.from(instant, tz.getLocation(zoneName));
    } on Object {
      return view(instant);
    }
  }

  /// "Now" in the account's zone -- for "today" / "yesterday" and day grouping.
  static DateTime now() => view(DateTime.now());

  /// A wall-clock time the person picked (a date picker, a time picker), read in the
  /// account's zone. The result is an instant: send it with `toUtc()` as before.
  static DateTime wallClock(int year, int month, int day, [int hour = 0, int minute = 0]) {
    final manual = _manual;
    return manual == null
        ? DateTime(year, month, day, hour, minute)
        : tz.TZDateTime(manual, year, month, day, hour, minute);
  }

  /// Parses an ISO instant and shows it in the account's zone. Null for anything else.
  static DateTime? parse(Object? raw) {
    if (raw is! String) return null;
    final parsed = DateTime.tryParse(raw);
    return parsed == null ? null : view(parsed);
  }
}
