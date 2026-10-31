import 'board_page.dart';

/// Where a board stands (design §10, 4a/4d): in use, in Deleted boards (restorable
/// until [BoardSummary.purgeAfter]), or kept after its teacher left.
enum BoardState {
  active,
  trashed,
  retained;

  static BoardState parse(Object? v) => values.asNameMap()[v] ?? active;
}

/// A board as the lists show it (GET /whiteboards, /whiteboards/trash).
class BoardSummary {
  const BoardSummary({
    required this.id,
    required this.title,
    required this.state,
    required this.revision,
    required this.pageCount,
    required this.updatedAt,
    this.lessonId,
    this.trashedAt,
    this.purgeAfter,
  });

  final String id;
  final String title;
  final BoardState state;

  /// The revision every write names; a different current one is a conflict.
  final int revision;
  final int pageCount;
  final DateTime updatedAt;
  final String? lessonId;
  final DateTime? trashedAt;

  /// Deleted for good after this (trash only).
  final DateTime? purgeAfter;

  factory BoardSummary.fromJson(Map<String, Object?> j) => BoardSummary(
    id: j['id'] as String,
    title: j['title'] as String? ?? '',
    state: BoardState.parse(j['state']),
    revision: (j['revision'] as num?)?.toInt() ?? 1,
    pageCount: (j['pageCount'] as num?)?.toInt() ?? 1,
    updatedAt: _date(j['updatedAt']) ?? DateTime.fromMillisecondsSinceEpoch(0),
    lessonId: j['lessonId'] as String?,
    trashedAt: _date(j['trashedAt']),
    purgeAfter: _date(j['purgeAfter']),
  );
}

/// One of a board's images as the server signs it (PR-4, design §6.3): the
/// URL is a short-lived bearer link to exactly this image, never a key.
class BoardAsset {
  const BoardAsset({required this.id, required this.url, required this.expiresAt, this.width, this.height, this.contentType});

  final String id;
  final String url;
  final DateTime expiresAt;
  final int? width;
  final int? height;
  final String? contentType;

  static BoardAsset? fromJson(Object? j) {
    if (j is! Map || j['id'] is! String || j['url'] is! String) return null;
    return BoardAsset(
      id: (j['id'] as String).toLowerCase(),
      url: j['url'] as String,
      expiresAt: _date(j['expiresAt']) ?? DateTime.now(),
      width: (j['width'] as num?)?.toInt(),
      height: (j['height'] as num?)?.toInt(),
      contentType: j['contentType'] as String?,
    );
  }

  static List<BoardAsset> listFrom(Object? j) => [
    for (final a in (j is List ? j : const [])) ?BoardAsset.fromJson(a),
  ];
}

/// A board with its pages (GET /whiteboards/:id and every structural write).
class BoardDetail {
  const BoardDetail({required this.summary, required this.canEdit, required this.pages, this.assets = const []});

  final BoardSummary summary;

  /// The server's word: false for any reader but the owning teacher.
  final bool canEdit;
  final List<BoardPage> pages;

  /// The board's ready images, signed (PR-4); empty where the server has none.
  final List<BoardAsset> assets;

  String get id => summary.id;
  int get revision => summary.revision;

  factory BoardDetail.fromJson(Map<String, Object?> j) {
    final pages = [
      for (final p in (j['pages'] as List? ?? const []))
        if (p is Map) BoardPage.fromJson(Map<String, Object?>.from(p)),
    ]..sort((a, b) => a.position.compareTo(b.position));
    return BoardDetail(summary: BoardSummary.fromJson(j), canEdit: j['canEdit'] == true, pages: pages, assets: BoardAsset.listFrom(j['assets']));
  }
}

/// What one page save answers.
class PageSaved {
  const PageSaved({required this.revision, required this.updatedAt, this.savedAt});

  final int revision;
  final DateTime updatedAt;

  /// The page's `updatedAt` exactly as the server sent it (a draft's base).
  final String? savedAt;
}

DateTime? _date(Object? v) => v is String ? DateTime.tryParse(v)?.toLocal() : null;
