import 'package:intl/intl.dart';

/// Chat-list and bubble timestamps.
///
/// Uses [Intl] rather than manual formatting so Arabic gets Arabic month and day names, and
/// the locale decides digit shape (§45, §46). Everything is rendered in the account's zone
/// (PD-22): the caller passes times from `AppClock` and `AppClock.now()`.
abstract final class RelativeTime {
  /// Whole calendar days from [from]'s date to [to]'s date. Counted on the dates, not on a
  /// Duration: the day the clocks change is 23 or 25 hours long, and `inDays` of 23 hours
  /// is 0, which turned "yesterday" into "today".
  static int calendarDaysBetween(DateTime from, DateTime to) =>
      DateTime.utc(to.year, to.month, to.day).difference(DateTime.utc(from.year, from.month, from.day)).inDays;

  /// The compact stamp shown on a chat-list row: time today, "yesterday", weekday within
  /// the last week, otherwise a short date.
  static String forListRow(
    DateTime when,
    DateTime now, {
    required String locale,
    required String todayLabel,
    required String yesterdayLabel,
  }) {
    final difference = calendarDaysBetween(when, now);

    if (difference <= 0) return DateFormat.Hm(locale).format(when);
    if (difference == 1) return yesterdayLabel;
    if (difference < 7) return DateFormat.EEEE(locale).format(when);
    return DateFormat.yMd(locale).format(when);
  }

  /// The separator shown between days inside a conversation.
  static String forDaySeparator(
    DateTime when,
    DateTime now, {
    required String locale,
    required String todayLabel,
    required String yesterdayLabel,
  }) {
    final difference = calendarDaysBetween(when, now);

    if (difference <= 0) return todayLabel;
    if (difference == 1) return yesterdayLabel;
    return DateFormat.yMMMMd(locale).format(when);
  }

  static String forBubble(DateTime when, {required String locale}) =>
      DateFormat.Hm(locale).format(when);
}
