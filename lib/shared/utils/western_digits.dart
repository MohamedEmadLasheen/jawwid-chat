import 'package:intl/intl.dart';

/// RQA-F3 / DD-09 (docs/design/decisions.md): Western digits 0-9 in both locales,
/// everywhere. intl already writes NUMBERS for `ar` with Latin digits, but its
/// DateFormat writes dates and times in Arabic-Indic (٠١٢٣), so an Arabic screen
/// mixed the two. Called once at startup (and by the test config, so tests see
/// what the app shows): every DateFormat for `ar` -- the app's own and
/// MaterialLocalizations' -- then writes 0-9 like everything beside it.
void useWesternDigits() {
  DateFormat.useNativeDigitsByDefaultFor('ar', false);
}
