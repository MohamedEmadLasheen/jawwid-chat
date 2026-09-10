/// Formatting for audio durations.
///
/// Durations are **LTR runs in both locales** (`cross-platform.md` §4): `0:18`
/// reads the same in Arabic, and Western numerals are used throughout (DD-09).
/// Rendering one inside an RTL paragraph therefore needs an explicit LTR
/// direction around it, which is why this returns a bare string and never
/// concatenates it into a sentence.
abstract final class DurationFormat {
  /// `m:ss`, or `h:mm:ss` past an hour. Never negative.
  static String clock(Duration duration) {
    final total = duration.isNegative ? Duration.zero : duration;
    final hours = total.inHours;
    final minutes = total.inMinutes.remainder(60);
    final seconds = total.inSeconds.remainder(60);

    final paddedSeconds = seconds.toString().padLeft(2, '0');
    if (hours == 0) return '$minutes:$paddedSeconds';
    return '$hours:${minutes.toString().padLeft(2, '0')}:$paddedSeconds';
  }
}
