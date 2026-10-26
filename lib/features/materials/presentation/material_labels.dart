import 'package:flutter/material.dart';

import '../../../l10n/app_localizations.dart';

/// PD-29: the Materials codes in the viewer's language. An unknown code is shown
/// as the code, never dropped (the server may add one before this build knows it).

String subjectLabel(L10n l10n, String code) => switch (code) {
      'quran' => l10n.materialsSubjectQuran,
      'arabic' => l10n.materialsSubjectArabic,
      'islamic_studies' => l10n.materialsSubjectIslamic,
      _ => code,
    };

String strandLabel(L10n l10n, String code) => switch (code) {
      'memorization' => l10n.materialsStrandMemorization,
      'recitation' => l10n.materialsStrandRecitation,
      'word_meanings' => l10n.materialsStrandWordMeanings,
      'tafsir' => l10n.materialsStrandTafsir,
      _ => code,
    };

String kindLabel(L10n l10n, String code) => switch (code) {
      'activity_package' || 'activity_link' => l10n.materialsKindActivity,
      'audio' => l10n.materialsKindAudio,
      'video' => l10n.materialsKindVideo,
      'pdf' => l10n.materialsKindPdf,
      'image' => l10n.materialsKindImage,
      _ => code,
    };

IconData kindIcon(String code) => switch (code) {
      'activity_package' || 'activity_link' => Icons.extension_outlined,
      'audio' => Icons.headphones_outlined,
      'video' => Icons.smart_display_outlined,
      'pdf' => Icons.picture_as_pdf_outlined,
      'image' => Icons.image_outlined,
      _ => Icons.menu_book_outlined,
    };

/// "4–6" -> "Ages 4–6"; "18+" -> "Ages 18+".
String ageBandLabel(L10n l10n, String band) => l10n.materialsAgeBand(band.replaceAll('-', '–'));
