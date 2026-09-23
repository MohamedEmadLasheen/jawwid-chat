import 'package:intl/intl.dart';

import '../../l10n/app_localizations.dart';

/// Human file sizes, localised.
///
/// Two units only — KB and MB. A parent looking at a homework PDF needs to know
/// whether it is small or large, not whether it is 2,412,544 bytes; and the
/// backend's ceilings are 10 MB and 25 MB, so nothing this app can send ever
/// reaches a third unit.
///
/// The number goes through [NumberFormat] for the active locale and the unit
/// through [L10n], so the whole string is localised rather than a translated
/// word stuck onto a hard-coded number (§45).
///
/// Note what that does and does not give you today: the app's Arabic locale is
/// `ar`, whose CLDR numbering system is Latin — so an Arabic UI renders
/// "3.0 م.ب", not "٣٫٠ م.ب". Arabic-Indic digits would need the locale to be
/// `ar_EG`, which is a product-wide localisation decision (it would change
/// every number and date in the app), not something this formatter may take on
/// its own. Routing through NumberFormat is what makes that a one-line change
/// when it is taken.
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
