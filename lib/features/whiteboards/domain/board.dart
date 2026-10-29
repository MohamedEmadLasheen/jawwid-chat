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

/// A board with its pages (GET /whiteboards/:id and every structural write).
class BoardDetail {
  const BoardDetail({required this.summary, required this.canEdit, required this.pages});

  final BoardSummary summary;

  /// The server's word: false for any reader but the owning teacher.
  final bool canEdit;
  final List<BoardPage> pages;

  String get id => summary.id;
  int get revision => summary.revision;

  factory BoardDetail.fromJson(Map<String, Object?> j) {
    final pages = [
      for (final p in (j['pages'] as List? ?? const []))
        if (p is Map) BoardPage.fromJson(Map<String, Object?>.from(p)),
    ]..sort((a, b) => a.position.compareTo(b.position));
    return BoardDetail(summary: BoardSummary.fromJson(j), canEdit: j['canEdit'] == true, pages: pages);
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
