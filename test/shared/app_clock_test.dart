/// PD-22: [AppClock] shows instants in the account's zone, and "today" / "yesterday" are
/// counted on calendar dates, so the day the clocks change is not mistaken for today.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/shared/utils/app_clock.dart';
import 'package:jawwid_chat/shared/utils/relative_time.dart';
import 'package:timezone/timezone.dart' as tz;

void main() {
  setUpAll(AppClock.ensureInitialized);
  tearDown(() => AppClock.useZone(null));

  // 15:00 UTC in December: 17:00 in Cairo (UTC+2), 18:00 in Kuwait (UTC+3).
  final instant = DateTime.utc(2026, 12, 10, 15);

  test('follows the phone until a zone is picked', () {
    expect(AppClock.manualZone, isNull);
    expect(AppClock.view(instant), instant.toLocal());

    AppClock.useZone('Asia/Kuwait');
    final kuwait = AppClock.view(instant);
    expect((kuwait.hour, kuwait.minute), (18, 0));
    expect(kuwait.isAtSameMomentAs(instant), isTrue);

    AppClock.useZone('Africa/Cairo');
    expect(AppClock.view(instant).hour, 17);
  });

  test("a picked wall clock is read in the picked zone, not the phone's", () {
    AppClock.useZone('Asia/Kuwait');
    final picked = AppClock.wallClock(2026, 12, 10, 18);
    expect(picked.toUtc(), instant);
  });

  test('an unknown zone falls back to the phone instead of throwing', () {
    AppClock.useZone('Mars/Olympus');
    expect(AppClock.manualZone, isNull);
  });

  test('parse reads ISO instants only', () {
    AppClock.useZone('Asia/Riyadh');
    expect(AppClock.parse('2026-12-10T15:00:00Z')!.hour, 18);
    expect(AppClock.parse(42), isNull);
    expect(AppClock.parse('not a date'), isNull);
  });

  test('the day after a clock change is still "yesterday" to the next morning', () {
    // Egypt's clocks go back at the end of Thursday 2026-10-29, so that day is 25 hours
    // long. Calendar dates decide, not the length of a Duration.
    final cairo = tz.getLocation('Africa/Cairo');
    final yesterdayLate = tz.TZDateTime(cairo, 2026, 10, 29, 23, 30);
    final todayEarly = tz.TZDateTime(cairo, 2026, 10, 30, 0, 10);
    expect(RelativeTime.calendarDaysBetween(yesterdayLate, todayEarly), 1);
    expect(
      RelativeTime.forDaySeparator(
        yesterdayLate,
        todayEarly,
        locale: 'en',
        todayLabel: 'Today',
        yesterdayLabel: 'Yesterday',
      ),
      'Yesterday',
    );
    // And a whole day earlier across the change is two days, not one.
    final twoDaysBack = tz.TZDateTime(cairo, 2026, 10, 28, 23, 50);
    expect(RelativeTime.calendarDaysBetween(twoDaysBack, todayEarly), 2);
  });
}
