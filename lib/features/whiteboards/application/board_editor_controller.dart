import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show KeepAliveLink;

import '../../../app/providers.dart';
import '../../../core/errors/app_error.dart';
import '../../../core/errors/error_presenter.dart';
import '../data/whiteboards_repository.dart';
import '../domain/board.dart';
import '../domain/board_elements.dart';
import '../domain/board_page.dart';
import '../domain/page_size.dart';

/// Where the open board's saving stands, as its top bar says it.
enum SaveStatus {
  /// Everything is on the server.
  saved,

  /// Changed here; the autosave is about to send it.
  dirty,
  saving,

  /// The server could not be reached: kept on this device, retried.
  offline,

  /// The board changed elsewhere (another tab): reload, or save this as a copy.
  conflict,

  /// The server refused the change ([EditorState.failureCode] says why).
  failed,
}

/// A one-off message for the editor to show, then acknowledge.
enum EditorNotice {
  /// A page action waits for the unsaved changes to reach the server first.
  saveFirst,
}

/// The client's own refusal: the page is over 512 KB as the server measures it.
const String kPageFullCode = 'page_full';

class EditorState {
  const EditorState({
    required this.board,
    required this.pages,
    required this.current,
    required this.canEdit,
    this.save = SaveStatus.saved,
    this.failureCode,
    this.canUndo = false,
    this.canRedo = false,
    this.draftStale = false,
    this.draftNotKept = false,
    this.notice,
    this.assets = const [],
    this.imagesSupported = false,
  });

  final BoardSummary board;

  /// The board's images as the server last signed them (PR-4); the image cache takes them.
  final List<BoardAsset> assets;

  /// Whether adding a picture is offered: the server knows images, and has
  /// not said they are switched off here (review of #328).
  final bool imagesSupported;
  final List<BoardPage> pages;
  final int current;
  final bool canEdit;
  final SaveStatus save;

  /// The server's `COMM.*` code (or [kPageFullCode]) when [save] is [SaveStatus.failed].
  final String? failureCode;
  final bool canUndo;
  final bool canRedo;

  /// Unsaved changes from an earlier visit, on pages that changed since: the
  /// teacher keeps them or discards them ([BoardEditorController.keepStaleDraft]).
  final bool draftStale;

  /// The last unsaved changes could not be kept on this device (storage full).
  final bool draftNotKept;
  final EditorNotice? notice;

  BoardPage get page => pages[current];

  EditorState copyWith({
    BoardSummary? board,
    List<BoardPage>? pages,
    int? current,
    SaveStatus? save,
    String? failureCode,
    bool clearFailure = false,
    bool? canUndo,
    bool? canRedo,
    bool? draftStale,
    bool? draftNotKept,
    EditorNotice? notice,
    bool clearNotice = false,
    List<BoardAsset>? assets,
    bool? imagesSupported,
  }) => EditorState(
    board: board ?? this.board,
    pages: pages ?? this.pages,
    current: current ?? this.current,
    canEdit: canEdit,
    save: save ?? this.save,
    failureCode: clearFailure ? null : (failureCode ?? this.failureCode),
    canUndo: canUndo ?? this.canUndo,
    canRedo: canRedo ?? this.canRedo,
    draftStale: draftStale ?? this.draftStale,
    draftNotKept: draftNotKept ?? this.draftNotKept,
    notice: clearNotice ? null : (notice ?? this.notice),
    assets: assets ?? this.assets,
    imagesSupported: imagesSupported ?? this.imagesSupported,
  );
}

/// PD-39: the open board (design §4.5).
///
/// AUTOSAVE. A change marks its page dirty; 2 s after the last change every
/// dirty page is sent, one after another, each naming the board revision and
/// taking the next from the answer. A page over 512 KB as the server measures
/// it is never sent: the teacher is told the page is full.
///
/// THE DRAFT. The dirty pages are kept on this device within half a second,
/// and the draft is rewritten after every successful page save, so it always
/// holds exactly what is not on the server. Each page in it carries the
/// server's `updatedAt` it was edited from: on the next open it is re-applied
/// only onto that same version; a page that changed since is offered to keep
/// or discard -- never dropped, never silently written over (review of #293).
///
/// LIFETIME. While anything is unsaved the controller stays alive (leaving
/// the board does not cut a save short), and the editor writes the draft when
/// the app goes to the background.
///
/// CONFLICT. A 409 WHITEBOARD_CONFLICT stops the autosave until the teacher
/// reloads or keeps theirs as a copy; nothing is ever merged silently.
class BoardEditorController extends AsyncNotifier<EditorState> {
  BoardEditorController(this.boardId);

  final String boardId;

  static const Duration saveDelay = Duration(seconds: 2);
  static const Duration draftDelay = Duration(milliseconds: 400);
  static const List<int> _backoffSeconds = [5, 10, 30, 60];

  final Map<String, PageHistory> _history = {};
  final Set<String> _dirty = {};

  /// Earlier unsaved changes on pages that changed since, awaiting the teacher.
  Map<String, Map<String, Object?>> _stale = {};
  Timer? _saveTimer;
  Timer? _draftTimer;
  int _failures = 0;
  Future<void>? _inFlight;
  KeepAliveLink? _keep;

  // Read once in build: the draft is written from onDispose too, when `ref`
  // can no longer be read.
  late BoardDraftStore _drafts;
  String? _actor;

  WhiteboardsRepository get _repo => ref.read(whiteboardsRepositoryProvider);

  @override
  Future<EditorState> build() async {
    _history.clear();
    _dirty.clear();
    _stale = {};
    _failures = 0;
    _keep = null;
    _last = null;
    _drafts = ref.read(boardDraftStoreProvider);
    _actor = ref.watch(principalIdProvider);
    ref.onDispose(() {
      _saveTimer?.cancel();
      _draftTimer?.cancel();
      // Last chance: whatever is still unsaved goes to the draft.
      if (_dirty.isNotEmpty || _stale.isNotEmpty) unawaited(_writeDraft(fromDispose: true));
    });
    final detail = await _repo.open(boardId);
    var pages = detail.pages;
    final actor = _actor;
    if (actor != null && detail.canEdit) {
      final draft = await _drafts.read(actor, boardId);
      if (draft != null) {
        final byId = {for (final p in pages) p.id: p};
        final applied = <String, BoardPage>{};
        for (final MapEntry(key: id, value: d) in draft.pages.entries) {
          final server = byId[id];
          if (server == null) continue; // the page was deleted since: nothing to put it on
          if (d['base'] == server.savedAt) {
            applied[id] = BoardPage.fromJson({...d, 'id': id, 'position': server.position, 'updatedAt': server.savedAt});
          } else {
            _stale[id] = d;
          }
        }
        pages = [for (final p in pages) applied[p.id] ?? p];
        _dirty.addAll(applied.keys);
      }
    }
    for (final p in pages) {
      _history[p.id] = PageHistory(p.elements);
    }
    if (_dirty.isNotEmpty || _stale.isNotEmpty) _hold();
    if (_dirty.isNotEmpty) _scheduleSave();
    return _last = EditorState(
      board: detail.summary,
      pages: pages,
      current: 0,
      canEdit: detail.canEdit,
      save: _dirty.isEmpty ? SaveStatus.saved : SaveStatus.dirty,
      draftStale: _stale.isNotEmpty,
      assets: detail.assets,
      imagesSupported: detail.imagesSupported,
    );
  }

  /// The board as last set: what onDispose writes to the draft, when `state`
  /// can no longer be read.
  EditorState? _last;

  EditorState? get _s => _last ?? state.value;

  void _set(EditorState s) {
    _last = s;
    state = AsyncData(s);
  }

  /// Stays alive while anything is unsaved; let go once all is on the server.
  void _hold() => _keep ??= ref.keepAlive();

  void _release() {
    if (_dirty.isNotEmpty || _stale.isNotEmpty) return;
    _keep?.close();
    _keep = null;
  }

  // -- drawing ---------------------------------------------------------------

  /// The current page's elements after one edit: one undo step.
  void commit(List<BoardElement> elements) {
    final s = _s;
    if (s == null || !s.canEdit) return;
    final page = s.page;
    _history[page.id]!.push(elements);
    _replacePage(page.copyWith(elements: _history[page.id]!.present));
  }

  /// [element] added to page [pageId], whichever page is showing now: a
  /// picture lands on the page its upload started on (review of #328). One
  /// undo step on that page. False when the page is gone or the board is not
  /// editable.
  bool addTo(String pageId, BoardElement element) {
    final s = _s;
    final h = _history[pageId];
    final page = s?.pages.where((p) => p.id == pageId).firstOrNull;
    if (s == null || !s.canEdit || h == null || page == null) return false;
    h.push([...h.present, element]);
    _replacePage(page.copyWith(elements: h.present));
    return true;
  }

  /// The server said images are switched off here: stop offering them.
  void imagesOff() {
    final s = _s;
    if (s != null && s.imagesSupported) _set(s.copyWith(imagesSupported: false));
  }

  void undo() => _step((h) => h.undo());

  void redo() => _step((h) => h.redo());

  void _step(List<BoardElement>? Function(PageHistory) move) {
    final s = _s;
    if (s == null || !s.canEdit) return;
    final next = move(_history[s.page.id]!);
    if (next != null) _replacePage(s.page.copyWith(elements: next));
  }

  void setLayout(PageLayout layout) {
    final s = _s;
    if (s == null || !s.canEdit || s.page.layout == layout) return;
    _replacePage(s.page.copyWith(layout: layout));
  }

  void setBackground(PageBackground background) {
    final s = _s;
    if (s == null || !s.canEdit || s.page.background == background) return;
    _replacePage(s.page.copyWith(background: background));
  }

  void goTo(int index) {
    final s = _s;
    if (s == null || index < 0 || index >= s.pages.length) return;
    _set(_withHistory(s.copyWith(current: index)));
  }

  void _replacePage(BoardPage page) {
    final s = _s!;
    final pages = [for (final p in s.pages) p.id == page.id ? page : p];
    _dirty.add(page.id);
    _hold();
    final conflict = s.save == SaveStatus.conflict;
    _set(_withHistory(s.copyWith(pages: pages, save: conflict ? SaveStatus.conflict : SaveStatus.dirty, clearFailure: !conflict)));
    _scheduleDraft();
    if (!conflict) _scheduleSave();
  }

  EditorState _withHistory(EditorState s) {
    final h = _history[s.page.id];
    return s.copyWith(canUndo: h?.canUndo ?? false, canRedo: h?.canRedo ?? false);
  }

  // -- the draft -------------------------------------------------------------

  void _scheduleDraft() {
    _draftTimer?.cancel();
    _draftTimer = Timer(draftDelay, () => unawaited(_writeDraft()));
  }

  /// Writes the draft now: the app is going to the background, or the board is closing.
  Future<void> persistNow() async {
    _draftTimer?.cancel();
    await _writeDraft();
  }

  /// Exactly what is not on the server: the dirty pages (each with the server
  /// version it was edited from) and any earlier changes still awaiting the
  /// teacher. Cleared when there is nothing.
  Future<void> _writeDraft({bool fromDispose = false}) async {
    final s = _s;
    final actor = _actor;
    if (s == null || actor == null || !s.canEdit) return;
    final pages = <String, Map<String, Object?>>{
      ..._stale,
      for (final p in s.pages)
        if (_dirty.contains(p.id))
          p.id: {'document': p.documentJson(), 'layout': p.layout.wire, 'background': p.background.wire, 'base': p.savedAt},
    };
    if (pages.isEmpty) {
      await _drafts.clear(actor, boardId);
      return;
    }
    final kept = await _drafts.write(actor, boardId, BoardDraft(pages: pages));
    if (fromDispose || !ref.mounted) return;
    final now = _s;
    if (now != null && now.draftNotKept == kept) _set(now.copyWith(draftNotKept: !kept));
  }

  /// The earlier changes go on top of the pages as they are now (they are
  /// sent like any edit, so they replace those pages on the server).
  void keepStaleDraft() {
    final s = _s;
    if (s == null || _stale.isEmpty) return;
    final stale = _stale;
    _stale = {};
    var pages = s.pages;
    for (final MapEntry(key: id, value: d) in stale.entries) {
      final i = pages.indexWhere((p) => p.id == id);
      if (i < 0) continue;
      final restored = BoardPage.fromJson({...d, 'id': id, 'position': pages[i].position, 'updatedAt': pages[i].savedAt});
      _history[id]!.push(restored.elements);
      pages = [...pages]..[i] = restored;
      _dirty.add(id);
    }
    _set(_withHistory(s.copyWith(pages: pages, draftStale: false, save: SaveStatus.dirty)));
    _scheduleDraft();
    _scheduleSave();
  }

  void discardStaleDraft() {
    final s = _s;
    if (s == null) return;
    _stale = {};
    _set(s.copyWith(draftStale: false));
    unawaited(_writeDraft());
    _release();
  }

  // -- saving ----------------------------------------------------------------

  void _scheduleSave([Duration delay = saveDelay]) {
    _saveTimer?.cancel();
    _saveTimer = Timer(delay, () => unawaited(flush()));
  }

  /// Sends every unsaved page now. Safe to call at any time; one save runs at once.
  Future<void> flush() async {
    _saveTimer?.cancel();
    if (_inFlight != null) return _inFlight;
    final run = _saveDirty();
    _inFlight = run;
    try {
      await run;
    } finally {
      _inFlight = null;
    }
  }

  Future<void> _saveDirty() async {
    var s = _s;
    if (s == null || !s.canEdit || s.save == SaveStatus.conflict || _dirty.isEmpty) return;
    _set(s.copyWith(save: SaveStatus.saving, clearFailure: true));
    for (final page in [...s.pages]) {
      if (!_dirty.contains(page.id)) continue;
      s = _s!;
      final latest = s.pages.firstWhere((p) => p.id == page.id, orElse: () => page);
      if (storedJsonBytes(latest.documentJson()) > kPageMaxStoredBytes) {
        // Never sent: the server would refuse it, and retrying would not help.
        _set(s.copyWith(save: SaveStatus.failed, failureCode: kPageFullCode, current: s.pages.indexOf(latest)));
        unawaited(_writeDraft());
        return;
      }
      try {
        final saved = await _repo.savePage(boardId, latest.id, s.board.revision, latest);
        if (!ref.mounted) return;
        s = _s!;
        final now = s.pages.firstWhere((p) => p.id == page.id, orElse: () => latest);
        // The page's server version moved, whatever was drawn while the save was on its way.
        final pages = [for (final p in s.pages) p.id == page.id ? p.copyWith(savedAt: saved.savedAt) : p];
        // Changed again while it was on the way: it stays dirty for the next save.
        if (identical(now, latest)) _dirty.remove(page.id);
        _set(s.copyWith(board: _withRevision(s.board, saved.revision), pages: pages));
        _failures = 0;
        // The draft now holds exactly what is still unsaved (review of #293, P1).
        await _writeDraft();
        if (!ref.mounted) return;
      } on Object catch (e) {
        if (!ref.mounted) return;
        _onSaveError(asAppErrorOf(e));
        return;
      }
    }
    if (!ref.mounted) return;
    if (_dirty.isEmpty) {
      _set(_s!.copyWith(save: SaveStatus.saved, clearFailure: true));
      _release();
    } else {
      _set(_s!.copyWith(save: SaveStatus.dirty));
      _scheduleSave();
    }
  }

  void _onSaveError(AppError e) {
    final s = _s!;
    if (e.code == 'COMM.WHITEBOARD_CONFLICT' || s.save == SaveStatus.conflict) {
      // A conflict stays one, whatever else fails while it is unresolved.
      _set(s.copyWith(save: SaveStatus.conflict));
      return;
    }
    if (e.isTransient) {
      final wait = _backoffSeconds[_failures.clamp(0, _backoffSeconds.length - 1)];
      _failures++;
      _set(s.copyWith(save: SaveStatus.offline));
      _scheduleSave(Duration(seconds: wait));
      return;
    }
    // Refused (a limit, an invalid document): no retry loop; the draft keeps the page.
    _set(s.copyWith(save: SaveStatus.failed, failureCode: e.code ?? e.kind.name));
  }

  BoardSummary _withRevision(BoardSummary b, int revision) => BoardSummary(
    id: b.id,
    title: b.title,
    state: b.state,
    revision: revision,
    pageCount: b.pageCount,
    updatedAt: DateTime.now(),
    lessonId: b.lessonId,
    trashedAt: b.trashedAt,
    purgeAfter: b.purgeAfter,
  );

  // -- pages and the board ---------------------------------------------------

  /// A structural change: the pending saves go first, then the change with
  /// the revision they left. False -- and a notice for the teacher -- when the
  /// changes could not be sent first (offline, refused, a conflict): a page
  /// action never runs over unsaved work, and never fails silently.
  Future<bool> _structural(Future<BoardDetail> Function(int revision) change, {int? select}) async {
    await flush();
    final s = _s;
    if (s == null || !s.canEdit) return false;
    if (s.save == SaveStatus.conflict || _dirty.isNotEmpty) {
      _set(s.copyWith(notice: EditorNotice.saveFirst));
      return false;
    }
    try {
      final detail = await change(s.board.revision);
      if (!ref.mounted) return false;
      _adopt(detail, select: select);
      return true;
    } on Object catch (e) {
      if (!ref.mounted) return false;
      _onSaveError(asAppErrorOf(e));
      return false;
    }
  }

  void _adopt(BoardDetail detail, {int? select}) {
    final s = _s!;
    for (final p in detail.pages) {
      _history.putIfAbsent(p.id, () => PageHistory(p.elements));
    }
    _history.removeWhere((id, _) => !detail.pages.any((p) => p.id == id));
    // Pages the server sent back keep what is drawn here (identical once saved).
    final local = {for (final p in s.pages) p.id: p};
    final pages = [for (final p in detail.pages) local[p.id]?.copyWith(position: p.position, savedAt: p.savedAt) ?? p];
    final current = (select ?? s.current).clamp(0, pages.length - 1);
    _set(_withHistory(s.copyWith(board: detail.summary, pages: pages, current: current, save: SaveStatus.saved, clearFailure: true, assets: detail.assets)));
  }

  Future<bool> addPage() {
    final at = (_s?.current ?? 0) + 1;
    return _structural(
      (r) => _repo.addPage(boardId, r, position: at, layout: _s?.page.layout, background: _s?.page.background),
      select: at,
    );
  }

  Future<bool> duplicatePage() async {
    final s = _s;
    if (s == null) return false;
    return _structural((r) => _repo.duplicatePage(boardId, s.page.id, r), select: s.current + 1);
  }

  Future<bool> deletePage() async {
    final s = _s;
    if (s == null || s.pages.length <= 1) return false;
    return _structural((r) => _repo.deletePage(boardId, s.page.id, r), select: s.current > 0 ? s.current - 1 : 0);
  }

  Future<bool> movePage(int from, int to) async {
    final s = _s;
    if (s == null || from == to) return false;
    final ids = [for (final p in s.pages) p.id];
    final moved = ids.removeAt(from);
    ids.insert(to.clamp(0, ids.length), moved);
    return _structural((r) => _repo.reorderPages(boardId, r, ids), select: to);
  }

  Future<bool> rename(String title) => _structural((r) => _repo.rename(boardId, r, title));

  void acknowledgeNotice() {
    final s = _s;
    if (s != null && s.notice != null) _set(s.copyWith(clearNotice: true));
  }

  /// Conflict: drop what is here and take the board as the server has it.
  Future<void> reload() async {
    _saveTimer?.cancel();
    _dirty.clear();
    _stale = {};
    final actor = _actor;
    if (actor != null) await _drafts.clear(actor, boardId);
    _keep?.close();
    _keep = null;
    ref.invalidateSelf();
  }

  /// Conflict: keep what is here as a NEW board (every page, as drawn here).
  /// Answers the new board's id; this board is left as the server has it. A
  /// copy that fails part-way is moved to Deleted boards, not left half-made.
  Future<String?> saveAsCopy(String title) async {
    final s = _s;
    if (s == null) return null;
    BoardDetail? copy;
    try {
      copy = await _repo.create(title);
      for (var i = 1; i < s.pages.length; i++) {
        copy = await _repo.addPage(copy!.id, copy.revision);
      }
      var revision = copy!.revision;
      for (var i = 0; i < s.pages.length; i++) {
        revision = (await _repo.savePage(copy.id, copy.pages[i].id, revision, s.pages[i])).revision;
      }
      _dirty.clear();
      _stale = {};
      final actor = _actor;
      if (actor != null) await _drafts.clear(actor, boardId);
      _keep?.close();
      _keep = null;
      return copy.id;
    } on Object catch (e) {
      final made = copy;
      if (made != null) {
        try {
          final latest = await _repo.open(made.id);
          await _repo.moveToTrash(made.id, latest.revision);
        } on Object {
          // Left for the teacher to delete; the original board is untouched either way.
        }
      }
      if (ref.mounted) _onSaveError(asAppErrorOf(e));
      return null;
    }
  }
}

final boardEditorProvider = AsyncNotifierProvider.autoDispose.family<BoardEditorController, EditorState, String>(BoardEditorController.new);
