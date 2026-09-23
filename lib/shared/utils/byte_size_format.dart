import 'package:intl/intl.dart';

import '../../l10n/app_localizations.dart';

/// Human file sizes, localised.
///
/// Two units only — KB and MB. A parent looking at a homework PDF needs to know
/// whether it is small or large, not whether it is 2,412,544 bytes; and the
/// backend's ceilings are 10 MB and 25 MB, so nothing this app can send ever
/// reaches a third unit.
///
/// The number itself goes through [NumberFormat] for the active locale, so an
/// Arabic UI gets Arabic-Indic digits and an Arabic decimal separator rather
/// than Latin ones wedged into a right-to-left line (§45).
abstract final class ByteSizeFormat {
  static const _kb = 1024;
  static const _mb = 1024 * 1024;

  static String format(int bytes, L10n l10n, {required String locale}) {
    if (bytes >= _mb) {
      final value = bytes / _mb;
      return l10n.fileSizeMb(
        NumberFormat(value >= 10 ? '#,##0' : '#,##0.0', locale).format(value),
      );
    }

    // Anything under a kilobyte still reads as "1 KB" rather than as a byte
    // count: the exact size of a tiny file is not information anyone acts on,
    // and "0 KB" reads as a broken attachment.
    final value = bytes / _kb;
    return l10n.fileSizeKb(
      NumberFormat('#,##0', locale).format(value < 1 ? 1 : value),
    );
  }
}
