import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../../core/network/api_client.dart';
import '../domain/board.dart';
import '../domain/board_page.dart';

/// PD-39: a teacher's boards (apps/api/src/whiteboards, design §4.5, §10). Every
/// method is one endpoint. NO AUTHORIZATION LIVES HERE: the server decides who
/// edits (the owning teacher only) and its `COMM.WHITEBOARD_*` code reaches the
/// caller intact. Every write names the board revision it was made against.
abstract interface class WhiteboardsRepository {
  Future<List<BoardSummary>> list();

  /// Deleted boards, restorable until each one's purgeAfter.
  Future<List<BoardSummary>> trash();

  Future<BoardDetail> open(String boardId);

  Future<BoardDetail> create(String title, {String? lessonId});

  Future<BoardDetail> rename(String boardId, int revision, String title);

  Future<BoardDetail> duplicate(String boardId);

  /// To Deleted boards for 30 days; there is no permanent delete.
  Future<BoardSummary> moveToTrash(String boardId, int revision);

  Future<BoardDetail> restore(String boardId);

  Future<BoardDetail> addPage(String boardId, int revision, {int? position, PageLayout? layout, PageBackground? background});

  /// The autosave: one page's drawing (`{v, elements}`), layout and background.
  Future<PageSaved> savePage(String boardId, String pageId, int revision, BoardPage page);

  Future<BoardDetail> duplicatePage(String boardId, String pageId, int revision);

  Future<BoardDetail> deletePage(String boardId, String pageId, int revision);

  Future<BoardDetail> reorderPages(String boardId, int revision, List<String> pageIds);
}

/// The build with no boards server: refuses rather than answering "no boards".
class NoWhiteboardsRepository implements WhiteboardsRepository {
  const NoWhiteboardsRepository();

  static Never _none() => throw UnsupportedError('no boards server in this build');

  @override
  Future<List<BoardSummary>> list() async => _none();
  @override
  Future<List<BoardSummary>> trash() async => _none();
  @override
  Future<BoardDetail> open(String boardId) async => _none();
  @override
  Future<BoardDetail> create(String title, {String? lessonId}) async => _none();
  @override
  Future<BoardDetail> rename(String boardId, int revision, String title) async => _none();
  @override
  Future<BoardDetail> duplicate(String boardId) async => _none();
  @override
  Future<BoardSummary> moveToTrash(String boardId, int revision) async => _none();
  @override
  Future<BoardDetail> restore(String boardId) async => _none();
  @override
  Future<BoardDetail> addPage(String boardId, int revision, {int? position, PageLayout? layout, PageBackground? background}) async =>
      _none();
  @override
  Future<PageSaved> savePage(String boardId, String pageId, int revision, BoardPage page) async => _none();
  @override
  Future<BoardDetail> duplicatePage(String boardId, String pageId, int revision) async => _none();
  @override
  Future<BoardDetail> deletePage(String boardId, String pageId, int revision) async => _none();
  @override
  Future<BoardDetail> reorderPages(String boardId, int revision, List<String> pageIds) async => _none();
}

/// Overridden with the HTTP implementation by the real composition root.
final whiteboardsRepositoryProvider = Provider<WhiteboardsRepository>((ref) => const NoWhiteboardsRepository());

class HttpWhiteboardsRepository implements WhiteboardsRepository {
  HttpWhiteboardsRepository({required ApiClient client}) : _client = client;

  final ApiClient _client;

  Future<Map<String, Object?>> _post(String path, [Map<String, Object?>? data]) async =>
      (await _client.post<Map<String, Object?>>(path, data: data ?? const {})).data ?? const {};

  Future<List<BoardSummary>> _list(String path) async {
    final d = (await _client.get<List<Object?>>(path)).data ?? const [];
    return [
      for (final b in d)
        if (b is Map) BoardSummary.fromJson(Map<String, Object?>.from(b)),
    ];
  }

  @override
  Future<List<BoardSummary>> list() => _list('/whiteboards');

  @override
  Future<List<BoardSummary>> trash() => _list('/whiteboards/trash');

  @override
  Future<BoardDetail> open(String boardId) async =>
      BoardDetail.fromJson((await _client.get<Map<String, Object?>>('/whiteboards/$boardId')).data ?? const {});

  @override
  Future<BoardDetail> create(String title, {String? lessonId}) async =>
      BoardDetail.fromJson(await _post('/whiteboards', {'title': title, 'lessonId': ?lessonId}));

  @override
  Future<BoardDetail> rename(String boardId, int revision, String title) async =>
      BoardDetail.fromJson(await _post('/whiteboards/$boardId/rename', {'revision': revision, 'title': title}));

  @override
  Future<BoardDetail> duplicate(String boardId) async => BoardDetail.fromJson(await _post('/whiteboards/$boardId/duplicate'));

  @override
  Future<BoardSummary> moveToTrash(String boardId, int revision) async =>
      BoardSummary.fromJson(await _post('/whiteboards/$boardId/trash', {'revision': revision}));

  @override
  Future<BoardDetail> restore(String boardId) async => BoardDetail.fromJson(await _post('/whiteboards/$boardId/restore'));

  @override
  Future<BoardDetail> addPage(String boardId, int revision, {int? position, PageLayout? layout, PageBackground? background}) async =>
      BoardDetail.fromJson(
        await _post('/whiteboards/$boardId/pages', {
          'revision': revision,
          'position': ?position,
          if (layout != null) 'layout': layout.wire,
          if (background != null) 'background': background.wire,
        }),
      );

  @override
  Future<PageSaved> savePage(String boardId, String pageId, int revision, BoardPage page) async {
    final d = await _post('/whiteboards/$boardId/pages/$pageId', {
      'revision': revision,
      'document': page.documentJson(),
      'layout': page.layout.wire,
      'background': page.background.wire,
    });
    return PageSaved(
      revision: (d['revision'] as num?)?.toInt() ?? revision + 1,
      updatedAt: DateTime.tryParse(d['updatedAt'] as String? ?? '')?.toLocal() ?? DateTime.now(),
    );
  }

  @override
  Future<BoardDetail> duplicatePage(String boardId, String pageId, int revision) async =>
      BoardDetail.fromJson(await _post('/whiteboards/$boardId/pages/$pageId/duplicate', {'revision': revision}));

  @override
  Future<BoardDetail> deletePage(String boardId, String pageId, int revision) async =>
      BoardDetail.fromJson(await _post('/whiteboards/$boardId/pages/$pageId/delete', {'revision': revision}));

  @override
  Future<BoardDetail> reorderPages(String boardId, int revision, List<String> pageIds) async =>
      BoardDetail.fromJson(await _post('/whiteboards/$boardId/pages/order', {'revision': revision, 'pageIds': pageIds}));
}

// ---------------------------------------------------------------------------

/// The pages not yet saved, kept on this device so a lost connection or a
/// closed tab loses nothing (design §4.5). Per account and board; cleared once
/// every page is saved. Applied on the next open only if the board is still at
/// the revision the draft was made against.
class BoardDraft {
  const BoardDraft({required this.revision, required this.pages});

  final int revision;

  /// pageId → `{document, layout, background}`, as the page save sends them.
  final Map<String, Map<String, Object?>> pages;

  Map<String, Object?> toJson() => {'revision': revision, 'pages': pages};

  static BoardDraft? fromJson(Object? j) {
    if (j is! Map) return null;
    final revision = j['revision'];
    final pages = j['pages'];
    if (revision is! int || pages is! Map) return null;
    return BoardDraft(
      revision: revision,
      pages: {
        for (final e in pages.entries)
          if (e.key is String && e.value is Map) e.key as String: Map<String, Object?>.from(e.value as Map),
      },
    );
  }
}

abstract interface class BoardDraftStore {
  Future<BoardDraft?> read(String actorId, String boardId);
  Future<void> write(String actorId, String boardId, BoardDraft draft);
  Future<void> clear(String actorId, String boardId);
}

/// `shared_preferences`: localStorage in the browser, the app's preferences on a
/// phone. One open board at a time, each page at most 512 KB.
class SharedPreferencesBoardDraftStore implements BoardDraftStore {
  const SharedPreferencesBoardDraftStore();

  static String keyFor(String actorId, String boardId) => 'jawwid.whiteboard.draft.v1.$actorId.$boardId';

  @override
  Future<BoardDraft?> read(String actorId, String boardId) async {
    final raw = (await SharedPreferences.getInstance()).getString(keyFor(actorId, boardId));
    if (raw == null) return null;
    try {
      return BoardDraft.fromJson(jsonDecode(raw));
    } on FormatException {
      return null;
    }
  }

  @override
  Future<void> write(String actorId, String boardId, BoardDraft draft) async {
    try {
      await (await SharedPreferences.getInstance()).setString(keyFor(actorId, boardId), jsonEncode(draft.toJson()));
    } on Object {
      // A full browser store: the server copy still stands; nothing to undo here.
    }
  }

  @override
  Future<void> clear(String actorId, String boardId) async {
    await (await SharedPreferences.getInstance()).remove(keyFor(actorId, boardId));
  }
}

/// In memory, for tests.
class InMemoryBoardDraftStore implements BoardDraftStore {
  final Map<String, BoardDraft> stored = {};

  @override
  Future<BoardDraft?> read(String actorId, String boardId) async => stored['$actorId/$boardId'];
  @override
  Future<void> write(String actorId, String boardId, BoardDraft draft) async => stored['$actorId/$boardId'] = draft;
  @override
  Future<void> clear(String actorId, String boardId) async => stored.remove('$actorId/$boardId');
}

final boardDraftStoreProvider = Provider<BoardDraftStore>((ref) => const SharedPreferencesBoardDraftStore());

/// Debug fixtures only (no API in the build): boards kept in memory, with the
/// server's revision rule, so the Boards tab and the editor can be tried in a
/// browser. Never in a release build (bootstrap's `kReleaseMode` guard).
class FakeWhiteboardsRepository implements WhiteboardsRepository {
  final Map<String, ({BoardSummary summary, List<BoardPage> pages})> _boards = {};
  int _seq = 0;

  String _id() => 'fake-${++_seq}';

  BoardDetail _detail(String id) {
    final b = _boards[id];
    if (b == null) throw StateError('no such board');
    return BoardDetail(summary: b.summary, canEdit: b.summary.state == BoardState.active, pages: b.pages);
  }

  BoardSummary _with(BoardSummary s, {String? title, BoardState? state, int? pages, bool bump = true}) => BoardSummary(
    id: s.id,
    title: title ?? s.title,
    state: state ?? s.state,
    revision: bump ? s.revision + 1 : s.revision,
    pageCount: pages ?? s.pageCount,
    updatedAt: DateTime.now(),
    trashedAt: (state ?? s.state) == BoardState.trashed ? DateTime.now() : null,
    purgeAfter: (state ?? s.state) == BoardState.trashed ? DateTime.now().add(const Duration(days: 30)) : null,
  );

  void _check(String id, int revision) {
    if (_boards[id]!.summary.revision != revision) throw StateError('revision');
  }

  BoardPage _page(int position, {PageLayout? layout, PageBackground? background}) => BoardPage(
    id: _id(),
    position: position,
    layout: layout ?? PageLayout.plain,
    background: background ?? PageBackground.white,
    elements: const [],
  );

  BoardDetail _put(String id, BoardSummary summary, List<BoardPage> pages) {
    final ordered = [for (var i = 0; i < pages.length; i++) pages[i].copyWith(position: i)];
    _boards[id] = (summary: _with(summary, pages: ordered.length, bump: false), pages: ordered);
    return _detail(id);
  }

  @override
  Future<List<BoardSummary>> list() async => [
    for (final b in _boards.values)
      if (b.summary.state == BoardState.active) b.summary,
  ];

  @override
  Future<List<BoardSummary>> trash() async => [
    for (final b in _boards.values)
      if (b.summary.state == BoardState.trashed) b.summary,
  ];

  @override
  Future<BoardDetail> open(String boardId) async => _detail(boardId);

  @override
  Future<BoardDetail> create(String title, {String? lessonId}) async {
    final id = _id();
    final summary = BoardSummary(id: id, title: title, state: BoardState.active, revision: 1, pageCount: 1, updatedAt: DateTime.now());
    return _put(id, summary, [_page(0)]);
  }

  @override
  Future<BoardDetail> rename(String boardId, int revision, String title) async {
    _check(boardId, revision);
    final b = _boards[boardId]!;
    return _put(boardId, _with(b.summary, title: title), b.pages);
  }

  @override
  Future<BoardDetail> duplicate(String boardId) async {
    final b = _boards[boardId]!;
    final id = _id();
    return _put(
      id,
      BoardSummary(
        id: id,
        title: '${b.summary.title} (2)',
        state: BoardState.active,
        revision: 1,
        pageCount: b.pages.length,
        updatedAt: DateTime.now(),
      ),
      [
        for (final p in b.pages)
          BoardPage(id: _id(), position: p.position, layout: p.layout, background: p.background, elements: p.elements),
      ],
    );
  }

  @override
  Future<BoardSummary> moveToTrash(String boardId, int revision) async {
    _check(boardId, revision);
    final b = _boards[boardId]!;
    return _put(boardId, _with(b.summary, state: BoardState.trashed), b.pages).summary;
  }

  @override
  Future<BoardDetail> restore(String boardId) async {
    final b = _boards[boardId]!;
    return _put(boardId, _with(b.summary, state: BoardState.active), b.pages);
  }

  @override
  Future<BoardDetail> addPage(String boardId, int revision, {int? position, PageLayout? layout, PageBackground? background}) async {
    _check(boardId, revision);
    final b = _boards[boardId]!;
    final pages = [...b.pages]
      ..insert((position ?? b.pages.length).clamp(0, b.pages.length), _page(0, layout: layout, background: background));
    return _put(boardId, _with(b.summary), pages);
  }

  @override
  Future<PageSaved> savePage(String boardId, String pageId, int revision, BoardPage page) async {
    _check(boardId, revision);
    final b = _boards[boardId]!;
    final summary = _with(b.summary);
    _put(boardId, summary, [for (final p in b.pages) p.id == pageId ? page : p]);
    return PageSaved(revision: summary.revision, updatedAt: DateTime.now());
  }

  @override
  Future<BoardDetail> duplicatePage(String boardId, String pageId, int revision) async {
    _check(boardId, revision);
    final b = _boards[boardId]!;
    final i = b.pages.indexWhere((p) => p.id == pageId);
    final source = b.pages[i];
    final pages = [...b.pages]
      ..insert(i + 1, BoardPage(id: _id(), position: 0, layout: source.layout, background: source.background, elements: source.elements));
    return _put(boardId, _with(b.summary), pages);
  }

  @override
  Future<BoardDetail> deletePage(String boardId, String pageId, int revision) async {
    _check(boardId, revision);
    final b = _boards[boardId]!;
    return _put(boardId, _with(b.summary), [
      for (final p in b.pages)
        if (p.id != pageId) p,
    ]);
  }

  @override
  Future<BoardDetail> reorderPages(String boardId, int revision, List<String> pageIds) async {
    _check(boardId, revision);
    final b = _boards[boardId]!;
    final byId = {for (final p in b.pages) p.id: p};
    return _put(boardId, _with(b.summary), [for (final id in pageIds) byId[id]!]);
  }
}
