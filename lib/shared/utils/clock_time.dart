import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

/// A time of day as the reader's locale writes it -- its digits included.
///
/// In place of `MaterialLocalizations.formatTimeOfDay`, which writes Arabic times with
/// LATIN digits ("4:00 م") while every [DateFormat] in the app -- the chat timestamps, the
/// dates beside these very times -- writes them Arabic-Indic ("١٦:٢٦"). One screen showed
/// both. Built on [DateFormat] so a time reads like the date next to it.
///
/// The same shape as before: the locale's 12-hour clock ("٤:٠٠ م", "4:00 PM"), or 24-hour
/// with [alwaysUse24HourFormat].
String formatClockTime(BuildContext context, TimeOfDay time, {bool alwaysUse24HourFormat = false}) {
  final locale = Localizations.localeOf(context).toLanguageTag();
  final at = DateTime(2000, 1, 1, time.hour, time.minute);
  final text = (alwaysUse24HourFormat ? DateFormat.Hm(locale) : DateFormat.jm(locale)).format(at);
  // CLDR puts a narrow no-break space before "PM"; MaterialLocalizations (and so every
  // English time until now) wrote a plain one. Kept plain, so English reads exactly as
  // before and only the digits change, in the locales whose digits differ.
  return text.replaceAll('\u202F', ' ');
}
