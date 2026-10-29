import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/errors/app_error.dart';
import '../../../core/errors/error_presenter.dart';
import '../data/whiteboards_repository.dart';
import '../domain/board.dart';
import '../domain/board_elements.dart';
import '../domain/board_page.dart';

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
    this.draftDiscarded = false,
  });

  final BoardSummary board;
  final List<BoardPage> pages;
  final int current;
  final bool canEdit;
  final SaveStatus save;

  /// The server's `COMM.*` code when [save] is [SaveStatus.failed].
  final String? failureCode;
  final bool canUndo;
  final bool canRedo;

  /// Unsaved changes from an earlier visit could not be applied (the board moved on).
  final bool draftDiscarded;

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
    bool? draftDiscarded,
  }) => EditorState(
    board: board ?? this.board,
    pages: pages ?? this.pages,
    current: current ?? this.current,
    canEdit: canEdit,
    save: save ?? this.save,
    failureCode: clearFailure ? null : (failureCode ?? this.failureCode),
    canUndo: canUndo ?? this.canUndo,
    canRedo: canRedo ?? this.canRedo,
    draftDiscarded: draftDiscarded ?? this.draftDiscarded,
  );
}

/// PD-39: the open board (design §4.5).
///
/// AUTOSAVE. A change marks its page dirty; 2 s after the last change every
/// dirty page is sent, one after another, each naming the revision the board
/// is at and taking the next one from the answer. The pages not yet saved are
/// also kept on this device ([BoardDraftStore]) within half a second, so a
/// lost connection or a closed tab loses nothing.
///
/// CONFLICT. A 409 WHITEBOARD_CONFLICT means the board changed elsewhere: the
/// autosave stops and the teacher chooses to reload or to save this as a copy.
/// Nothing is ever merged silently.
///
/// OFFLINE. No connection: editing goes on, saves are retried (5 s, 10 s, 30 s,
/// then every minute) and the top bar says "Not saved yet".
class BoardEditorController extends AsyncNotifier<EditorState> {
  BoardEditorController(this.boardId);

  final String boardId;

  static const Duration saveDelay = Duration(seconds: 2);
  static const Duration draftDelay = Duration(milliseconds: 400);
  static const List<int> _backoffSeconds = [5, 10, 30, 60];

  final Map<String, PageHistory> _history = {};
  final Set<String> _dirty = {};
  Timer? _saveTimer;
  Timer? _draftTimer;
  int _failures = 0;
  Future<void>? _inFlight;

  WhiteboardsRepository get _repo => ref.read(whiteboardsRepositoryProvider);
  BoardDraftStore get _drafts => ref.read(boardDraftStoreProvider);
  String? get _actor => ref.read(principalIdProvider);

  @override
  Future<EditorState> build() async {
    _history.clear();
    _dirty.clear();
    _failures = 0;
    ref.onDispose(() {
      _saveTimer?.cancel();
      _draftTimer?.cancel();
    });
    ref.watch(principalIdProvider);
    final detail = await _repo.open(boardId);
    var pages = detail.pages;
    var discarded = false;
    final actor = _actor;
    if (actor != null && detail.canEdit) {
      final draft = await _drafts.read(actor, boardId);
      if (draft != null) {
        if (draft.revision == detail.revision) {
          pages = [
            for (final p in pages)
              if (draft.pages[p.id] case final d?)
                BoardPage.fromJson({'id': p.id, 'position': p.position, ...d}).copyWith(position: p.position)
              else
                p,
          ];
          _dirty.addAll(draft.pages.keys.where((id) => pages.any((p) => p.id == id)));
        } else {
          discarded = true;
          await _drafts.clear(actor, boardId);
        }
      }
    }
    for (final p in pages) {
      _history[p.id] = PageHistory(p.elements);
    }
    final initial = EditorState(
      board: detail.summary,
      pages: pages,
      current: 0,
      canEdit: detail.canEdit,
      save: _dirty.isEmpty ? SaveStatus.saved : SaveStatus.dirty,
      draftDiscarded: discarded,
    );
    if (_dirty.isNotEmpty) _scheduleSave();
    return initial;
  }

  EditorState? get _s => state.value;

  // -- drawing ---------------------------------------------------------------

  /// The current page's elements after one edit: one undo step.
  void commit(List<BoardElement> elements) {
    final s = _s;
    if (s == null || !s.canEdit) return;
    final page = s.page;
    _history[page.id]!.push(elements);
    _replacePage(page.copyWith(elements: _history[page.id]!.present));
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
    state = AsyncData(_withHistory(s.copyWith(current: index)));
  }

  void _replacePage(BoardPage page) {
    final s = _s!;
    final pages = [for (final p in s.pages) p.id == page.id ? page : p];
    _dirty.add(page.id);
    state = AsyncData(_withHistory(s.copyWith(pages: pages, save: s.save == SaveStatus.conflict ? SaveStatus.conflict : SaveStatus.dirty)));
    _scheduleDraft();
    if (s.save != SaveStatus.conflict) _scheduleSave();
  }

  EditorState _withHistory(EditorState s) {
    final h = _history[s.page.id];
    return s.copyWith(canUndo: h?.canUndo ?? false, canRedo: h?.canRedo ?? false);
  }

  // -- saving ----------------------------------------------------------------

  void _scheduleSave([Duration delay = saveDelay]) {
    _saveTimer?.cancel();
    _saveTimer = Timer(delay, () => unawaited(flush()));
  }

  void _scheduleDraft() {
    _draftTimer?.cancel();
    _draftTimer = Timer(draftDelay, () => unawaited(_writeDraft()));
  }

  Future<void> _writeDraft() async {
    final s = _s;
    final actor = _actor;
    if (s == null || actor == null || _dirty.isEmpty) return;
    await _drafts.write(
      actor,
      boardId,
      BoardDraft(
        revision: s.board.revision,
        pages: {
          for (final p in s.pages)
            if (_dirty.contains(p.id)) p.id: {'document': p.documentJson(), 'layout': p.layout.wire, 'background': p.background.wire},
        },
      ),
    );
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
    state = AsyncData(s.copyWith(save: SaveStatus.saving, clearFailure: true));
    for (final page in [...s.pages]) {
      if (!_dirty.contains(page.id)) continue;
      s = _s!;
      final latest = s.pages.firstWhere((p) => p.id == page.id, orElse: () => page);
      try {
        final saved = await _repo.savePage(boardId, latest.id, s.board.revision, latest);
        if (!ref.mounted) return;
        s = _s!;
        // Changed again while it was on the way: it stays dirty for the next save.
        if (identical(s.pages.firstWhere((p) => p.id == page.id, orElse: () => latest), latest)) _dirty.remove(page.id);
        state = AsyncData(s.copyWith(board: _withRevision(s.board, saved.revision)));
        _failures = 0;
      } on Object catch (e) {
        if (!ref.mounted) return;
        _onSaveError(asAppErrorOf(e));
        return;
      }
    }
    if (!ref.mounted) return;
    final actor = _actor;
    if (_dirty.isEmpty) {
      if (actor != null) await _drafts.clear(actor, boardId);
      state = AsyncData(_s!.copyWith(save: SaveStatus.saved, clearFailure: true));
    } else {
      state = AsyncData(_s!.copyWith(save: SaveStatus.dirty));
      _scheduleSave();
    }
  }

  void _onSaveError(AppError e) {
    final s = _s!;
    if (e.code == 'COMM.WHITEBOARD_CONFLICT') {
      state = AsyncData(s.copyWith(save: SaveStatus.conflict));
      return;
    }
    if (e.isTransient) {
      final wait = _backoffSeconds[_failures.clamp(0, _backoffSeconds.length - 1)];
      _failures++;
      state = AsyncData(s.copyWith(save: SaveStatus.offline));
      _scheduleSave(Duration(seconds: wait));
      return;
    }
    state = AsyncData(s.copyWith(save: SaveStatus.failed, failureCode: e.code ?? e.kind.name));
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

  /// A structural change: the pending saves go first, then the change with the
  /// revision they left. The answer is the board as the server now has it.
  Future<void> _structural(Future<BoardDetail> Function(int revision) change, {int? select}) async {
    await flush();
    final s = _s;
    if (s == null || !s.canEdit || s.save == SaveStatus.conflict || _dirty.isNotEmpty) return;
    try {
      final detail = await change(s.board.revision);
      if (!ref.mounted) return;
      _adopt(detail, select: select);
    } on Object catch (e) {
      if (!ref.mounted) return;
      _onSaveError(asAppErrorOf(e));
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
    final pages = [for (final p in detail.pages) local[p.id]?.copyWith(position: p.position) ?? p];
    final current = (select ?? s.current).clamp(0, pages.length - 1);
    state = AsyncData(
      _withHistory(s.copyWith(board: detail.summary, pages: pages, current: current, save: SaveStatus.saved, clearFailure: true)),
    );
  }

  Future<void> addPage() async {
    final at = (_s?.current ?? 0) + 1;
    await _structural(
      (r) => _repo.addPage(boardId, r, position: at, layout: _s?.page.layout, background: _s?.page.background),
      select: at,
    );
  }

  Future<void> duplicatePage() async {
    final s = _s;
    if (s == null) return;
    await _structural((r) => _repo.duplicatePage(boardId, s.page.id, r), select: s.current + 1);
  }

  Future<void> deletePage() async {
    final s = _s;
    if (s == null || s.pages.length <= 1) return;
    await _structural((r) => _repo.deletePage(boardId, s.page.id, r), select: s.current > 0 ? s.current - 1 : 0);
  }

  Future<void> movePage(int from, int to) async {
    final s = _s;
    if (s == null || from == to) return;
    final ids = [for (final p in s.pages) p.id];
    final moved = ids.removeAt(from);
    ids.insert(to.clamp(0, ids.length), moved);
    await _structural((r) => _repo.reorderPages(boardId, r, ids), select: to);
  }

  Future<void> rename(String title) => _structural((r) => _repo.rename(boardId, r, title));

  /// Conflict: drop what is here and take the board as the server has it.
  Future<void> reload() async {
    _saveTimer?.cancel();
    _dirty.clear();
    final actor = _actor;
    if (actor != null) await _drafts.clear(actor, boardId);
    ref.invalidateSelf();
  }

  /// Conflict: keep what is here as a NEW board (every page, as drawn here).
  /// Answers the new board's id; this board is left as the server has it.
  Future<String?> saveAsCopy(String title) async {
    final s = _s;
    if (s == null) return null;
    try {
      var copy = await _repo.create(title);
      for (var i = 1; i < s.pages.length; i++) {
        copy = await _repo.addPage(copy.id, copy.revision);
      }
      var revision = copy.revision;
      for (var i = 0; i < s.pages.length; i++) {
        revision = (await _repo.savePage(copy.id, copy.pages[i].id, revision, s.pages[i])).revision;
      }
      _dirty.clear();
      final actor = _actor;
      if (actor != null) await _drafts.clear(actor, boardId);
      return copy.id;
    } on Object catch (e) {
      if (ref.mounted) _onSaveError(asAppErrorOf(e));
      return null;
    }
  }

  void acknowledgeDraftDiscarded() {
    final s = _s;
    if (s != null && s.draftDiscarded) state = AsyncData(s.copyWith(draftDiscarded: false));
  }
}

final boardEditorProvider = AsyncNotifierProvider.autoDispose.family<BoardEditorController, EditorState, String>(BoardEditorController.new);
