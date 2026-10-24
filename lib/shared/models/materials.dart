/// PD-29 Materials: what a child's Materials page shows, as the server sends it
/// (apps/api/src/materials). Nothing here carries a storage key: an item says
/// what it is, and `open` (the access decision) returns something to play.
library;

/// The subjects, strands, kinds, age bands and map statuses -- the same codes as
/// the server's vocab.ts. An unknown code is kept and shown as the code.
const materialSubjects = ['quran', 'arabic', 'islamic_studies'];
const materialAgeGroups = ['4-6', '7-9', '10-12', '13-17', '18+'];
const markStatuses = ['not_started', 'in_progress', 'memorized', 'needs_revision'];

class Surah {
  const Surah({required this.number, required this.nameAr, required this.nameEn, required this.ayahCount, required this.juz});

  final int number;
  final String nameAr;
  final String nameEn;
  final int ayahCount;
  final int juz;

  String name(bool arabic) => arabic ? nameAr : nameEn;

  static Surah? fromJson(Object? raw) {
    if (raw is! Map) return null;
    final n = (raw['number'] as num?)?.toInt();
    final count = (raw['ayahCount'] as num?)?.toInt();
    if (n == null || count == null) return null;
    return Surah(
      number: n,
      nameAr: raw['nameAr'] as String? ?? '$n',
      nameEn: raw['nameEn'] as String? ?? '$n',
      ayahCount: count,
      juz: (raw['juz'] as num?)?.toInt() ?? 0,
    );
  }
}

/// One library item as a reader sees it. `mode` is how it plays: `link`, `file` or `package`.
class MaterialItem {
  const MaterialItem({
    required this.id,
    required this.titleAr,
    required this.titleEn,
    required this.subject,
    required this.kind,
    required this.mode,
    this.strand,
    this.surah,
    this.description,
    this.ageGroups = const [],
  });

  final String id;
  final String? titleAr;
  final String? titleEn;
  final String subject;
  final String? strand;
  final String kind;
  final String mode;
  final int? surah;
  final String? description;
  final List<String> ageGroups;

  String title(bool arabic) => (arabic ? titleAr ?? titleEn : titleEn ?? titleAr) ?? '';
  bool get isActivity => kind == 'activity_package' || kind == 'activity_link';

  static MaterialItem? fromJson(Object? raw) {
    if (raw is! Map || raw['id'] is! String) return null;
    return MaterialItem(
      id: raw['id'] as String,
      titleAr: raw['titleAr'] as String?,
      titleEn: raw['titleEn'] as String?,
      subject: raw['subject'] as String? ?? '',
      strand: raw['strand'] as String?,
      kind: raw['kind'] as String? ?? '',
      mode: raw['mode'] as String? ?? 'link',
      surah: (raw['surah'] as num?)?.toInt(),
      description: raw['description'] as String?,
      ageGroups: [for (final a in (raw['ageGroups'] as List?) ?? const []) if (a is String) a],
    );
  }
}

/// What `open` returned: a short-lived URL to play, and how.
class OpenedMaterial {
  const OpenedMaterial({required this.kind, required this.mode, required this.url, this.mimeType});

  final String kind;
  final String mode;
  final String url;
  final String? mimeType;

  static OpenedMaterial fromJson(Map<String, Object?> raw) => OpenedMaterial(
        kind: raw['kind'] as String? ?? '',
        mode: raw['mode'] as String? ?? 'link',
        url: raw['url'] as String? ?? '',
        mimeType: raw['mimeType'] as String?,
      );
}

class ChildLibrary {
  const ChildLibrary({required this.childName, required this.childAgeGroup, required this.ageGroup, required this.items});

  final String childName;

  /// The child's own band, or null when the age is unknown.
  final String? childAgeGroup;

  /// The band shown: a band code, or `all`.
  final String ageGroup;
  final List<MaterialItem> items;
}

/// One practice entry of a report: an ayah range or a library item.
sealed class PracticeEntry {
  const PracticeEntry();
}

class AyahPractice extends PracticeEntry {
  const AyahPractice({
    required this.surah,
    required this.nameAr,
    required this.nameEn,
    required this.ayahFrom,
    required this.ayahTo,
    required this.wholeSurah,
    required this.hasRecitation,
  });

  final int surah;
  final String nameAr;
  final String nameEn;
  final int ayahFrom;
  final int ayahTo;
  final bool wholeSurah;
  final bool hasRecitation;
}

class ItemPractice extends PracticeEntry {
  const ItemPractice(this.item);

  /// Null when the item is no longer in the library.
  final MaterialItem? item;
}

class PracticeReport {
  const PracticeReport({
    required this.lessonId,
    required this.submittedAt,
    this.lessonNumber,
    this.nextTasks = const [],
    this.homework,
    this.practice = const [],
  });

  final String lessonId;
  final DateTime submittedAt;
  final int? lessonNumber;
  final List<String> nextTasks;
  final String? homework;
  final List<PracticeEntry> practice;
}

class PracticeWeek {
  const PracticeWeek({required this.current, required this.reports});

  /// False when nothing was reported this week and the latest practice is shown instead.
  final bool current;
  final List<PracticeReport> reports;
}

class ProgressSurah {
  const ProgressSurah({
    required this.number,
    required this.nameAr,
    required this.nameEn,
    required this.status,
    this.hasRecitation = false,
  });

  final int number;
  final String nameAr;
  final String nameEn;
  final String status;
  final bool hasRecitation;

  String name(bool arabic) => arabic ? nameAr : nameEn;
}

class JuzGroup {
  const JuzGroup({required this.juz, required this.surahs});

  final int juz;
  final List<ProgressSurah> surahs;
}

class ProgressMap {
  const ProgressMap({required this.childName, required this.counts, required this.juz, required this.canCorrect});

  final String childName;
  final Map<String, int> counts;
  final List<JuzGroup> juz;
  final bool canCorrect;
}

class SurahMark {
  const SurahMark({required this.status, required this.source, required this.byKind, required this.at, this.byName, this.reason});

  final String status;

  /// `report`, `report_edit` or `correction`.
  final String source;
  final String byKind;
  final String? byName;
  final String? reason;
  final DateTime at;
}

class SurahHistory {
  const SurahHistory({required this.surah, required this.marks});

  final ProgressSurah surah;
  final List<SurahMark> marks;
}

/// What a teacher attaches to a lesson report (sent with it).
class PracticeDraft {
  const PracticeDraft.ayahs({required int this.surah, required int this.ayahFrom, required int this.ayahTo, this.label})
      : itemId = null;
  const PracticeDraft.item({required String this.itemId, this.label})
      : surah = null,
        ayahFrom = null,
        ayahTo = null;

  final int? surah;
  final int? ayahFrom;
  final int? ayahTo;
  final String? itemId;

  /// How the chip reads in the form (not sent).
  final String? label;

  Map<String, Object?> toJson() =>
      itemId != null ? {'itemId': itemId} : {'surah': surah, 'ayahFrom': ayahFrom, 'ayahTo': ayahTo};

  @override
  bool operator ==(Object other) =>
      other is PracticeDraft && other.surah == surah && other.ayahFrom == ayahFrom && other.ayahTo == ayahTo && other.itemId == itemId;

  @override
  int get hashCode => Object.hash(surah, ayahFrom, ayahTo, itemId);
}

class MarkDraft {
  const MarkDraft({required this.surah, required this.status});

  final int surah;
  final String status;

  Map<String, Object?> toJson() => {'surah': surah, 'status': status};
}
