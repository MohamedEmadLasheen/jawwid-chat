/// PD-29 Materials: what a child's Materials page shows, as the server sends it
/// (apps/api/src/materials). Nothing here carries a storage key: an item says
/// what it is, and `open` (the access decision) returns something to play.
library;

/// The subjects, strands, kinds and age bands -- the same codes as
/// the server's vocab.ts. An unknown code is kept and shown as the code.
const materialSubjects = ['quran', 'arabic', 'islamic_studies'];
const materialAgeGroups = ['4-6', '7-9', '10-12', '13-17', '18+'];

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

/// How the server says an item must be presented (`open`'s `presentation`).
enum MaterialPresentation {
  /// An uploaded package from OUR origin: sandboxed WITHOUT same-origin, pinned to its play prefix.
  frameIsolated,

  /// A lesson of the lessons site or an allowlisted link: framed, keeping its OWN origin, pinned to its host.
  frameSite,

  /// Any other https link: opened in the browser, never embedded.
  browser,

  /// Audio, video, PDF or image from a signed storage URL.
  file;

  static MaterialPresentation parse(String? raw) => switch (raw) {
        'frame-isolated' => frameIsolated,
        'frame-site' => frameSite,
        'file' => file,
        // Unknown or missing: the safest choice -- never embedded.
        _ => browser,
      };
}

/// The exact iframe sandboxes (the web build). Never allow-popups,
/// allow-top-navigation or allow-modals.
const sandboxIsolated = 'allow-scripts allow-forms';
const sandboxSite = 'allow-scripts allow-same-origin allow-forms';

/// What `open` returned: a short-lived URL to play, and how.
class OpenedMaterial {
  const OpenedMaterial({required this.kind, required this.mode, required this.url, required this.presentation, this.mimeType});

  final String kind;
  final String mode;
  final String url;
  final MaterialPresentation presentation;
  final String? mimeType;

  static OpenedMaterial fromJson(Map<String, Object?> raw) => OpenedMaterial(
        kind: raw['kind'] as String? ?? '',
        mode: raw['mode'] as String? ?? 'link',
        url: raw['url'] as String? ?? '',
        presentation: MaterialPresentation.parse(raw['presentation'] as String?),
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

/// One item opened for the child this academy week (PD-29 amendment): shown once,
/// with its last opening.
class OpenedItem {
  const OpenedItem({required this.item, required this.available, required this.lastOpenedAt, required this.times});

  final MaterialItem item;

  /// False when the item has since left the library (retired): shown, not playable.
  final bool available;
  final DateTime lastOpenedAt;
  final int times;
}

/// "Opened this week": the academy's week, Saturday to Friday in the academy's zone.
class OpenedThisWeek {
  const OpenedThisWeek({required this.weekStartsAt, required this.items});

  final DateTime weekStartsAt;

  /// Most recently opened first.
  final List<OpenedItem> items;
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
