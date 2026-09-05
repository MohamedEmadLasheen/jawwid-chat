import 'package:intl/intl.dart';

/// Chat-list and bubble timestamps.
///
/// Uses [Intl] rather than manual formatting so Arabic gets Arabic month and day names, and
/// the locale decides digit shape (§45, §46). Everything is rendered in the family's local
/// zone; the caller converts before formatting.
abstract final class RelativeTime {
  /// The compact stamp shown on a chat-list row: time today, "yesterday", weekday within
  /// the last week, otherwise a short date.
  static String forListRow(
    DateTime when,
    DateTime now, {
    required String locale,
    required String todayLabel,
    required String yesterdayLabel,
  }) {
    final day = DateTime(when.year, when.month, when.day);
    final today = DateTime(now.year, now.month, now.day);
    final difference = today.difference(day).inDays;

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
    final day = DateTime(when.year, when.month, when.day);
    final today = DateTime(now.year, now.month, now.day);
    final difference = today.difference(day).inDays;

    if (difference <= 0) return todayLabel;
    if (difference == 1) return yesterdayLabel;
    return DateFormat.yMMMMd(locale).format(when);
  }

  static String forBubble(DateTime when, {required String locale}) =>
      DateFormat.Hm(locale).format(when);
}
