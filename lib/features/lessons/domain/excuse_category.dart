import '../../../l10n/app_localizations.dart';

/// PD-50: the fixed reason an excuse is recorded under -- the same codes as the server's
/// `reasonCategory`. Whoever records the excuse picks one; the family sees it on the card.
/// The free-text note beside it stays with staff and the lesson's teacher (PD-15).
const excuseCategoryCodes = <String>['travel', 'illness', 'exams', 'emergency', 'other'];

/// The words for an excuse category, shared by the sheets and the card. Null for a code
/// this build does not know: the card then shows no category row rather than a raw code.
String? excuseCategoryLabel(L10n l10n, String? code) => switch (code) {
      'travel' => l10n.excuseCategoryTravel,
      'illness' => l10n.excuseCategoryIllness,
      'exams' => l10n.excuseCategoryExams,
      'emergency' => l10n.excuseCategoryEmergency,
      'other' => l10n.excuseCategoryOther,
      _ => null,
    };
