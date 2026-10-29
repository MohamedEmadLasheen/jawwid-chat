// PD-39: the open board's saving (design §4.5, review of #293): every write
// names the revision and takes the next from the answer; a conflict stops the
// autosave and is never merged; offline keeps the pages on the device and
// retries; the draft always holds exactly what is unsaved, page by page, and
// is never silently dropped or silently written over.
import 'dart:async';
import 'dart:ui';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/features/whiteboards/application/board_editor_controller.dart';
import 'package:jawwid_chat/features/whiteboards/data/whiteboards_repository.dart';
import 'package:jawwid_chat/features/whiteboards/domain/board.dart';
import 'package:jawwid_chat/features/whiteboards/domain/board_elements.dart';
import 'package:jawwid_chat/features/whiteboards/domain/board_page.dart';
import 'package:jawwid_chat/features/whiteboards/domain/stroke_points.dart';

/// A server with two pages, each with its own `updatedAt` (its version).
class FakeBoards implements WhiteboardsRepository {
  int revision = 1;
  final Map<String, BoardPage> pages = {
    'p1': const BoardPage(id: 'p1', position: 0, layout: PageLayout.plain, background: PageBackground.white, elements: [], savedAt: 'p1@1'),
    'p2': const BoardPage(id: 'p2', position: 1, layout: PageLayout.plain, background: PageBackground.white, elements: [], savedAt: 'p2@1'),
  };
  final List<(String pageId, int revision, BoardPage page)> saves = [];
  int requests = 0;

  /// Every save of these pages fails as offline.
  final Set<String> offline = {};

  /// When set, a save waits for it (an answer still on its way).
  Completer<void>? hold;
  Object? createError;
  final List<String> trashed = [];

  BoardDetail detail() => BoardDetail(
    summary: BoardSummary(id: 'b1', title: 'Board', state: BoardState.active, revision: revision, pageCount: 2, updatedAt: DateTime(2026)),
    canEdit: true,
    pages: [pages['p1']!, pages['p2']!],
  );

  @override
  Future<BoardDetail> open(String boardId) async => boardId == 'b1'
      ? detail()
      : BoardDetail(
          summary: BoardSummary(id: boardId, title: 'copy', state: BoardState.active, revision: 3, pageCount: 1, updatedAt: DateTime(2026)),
          canEdit: true,
          pages: const [],
        );

  @override
  Future<PageSaved> savePage(String boardId, String pageId, int revision, BoardPage page) async {
    requests++;
    if (offline.contains(pageId)) throw const AppError(AppErrorKind.network);
    if (revision != this.revision) throw const AppError(AppErrorKind.unknown, code: 'COMM.WHITEBOARD_CONFLICT');
    // The server applies the write at once; its answer may still be on the way.
    this.revision++;
    final at = '$pageId@${this.revision}';
    pages[pageId] = page.copyWith(savedAt: at);
    saves.add((pageId, revision, page));
    if (hold != null) await hold!.future;
    return PageSaved(revision: this.revision, updatedAt: DateTime(2026), savedAt: at);
  }

  @override
  Future<BoardDetail> addPage(String boardId, int revision, {int? position, PageLayout? layout, PageBackground? background}) async {
    requests++;
    if (boardId == 'copy') {
      return BoardDetail(
        summary: BoardSummary(id: 'copy', title: 'copy', state: BoardState.active, revision: 2, pageCount: 2, updatedAt: DateTime(2026)),
        canEdit: true,
        pages: const [
          BoardPage(id: 'c1', position: 0, layout: PageLayout.plain, background: PageBackground.white, elements: []),
          BoardPage(id: 'c2', position: 1, layout: PageLayout.plain, background: PageBackground.white, elements: []),
        ],
      );
    }
    return detail();
  }

  @override
  Future<BoardDetail> create(String title, {String? lessonId}) async {
    if (createError != null) throw createError!;
    return BoardDetail(
      summary: BoardSummary(id: 'copy', title: title, state: BoardState.active, revision: 1, pageCount: 1, updatedAt: DateTime(2026)),
      canEdit: true,
      pages: const [BoardPage(id: 'c1', position: 0, layout: PageLayout.plain, background: PageBackground.white, elements: [])],
    );
  }

  @override
  Future<BoardSummary> moveToTrash(String boardId, int revision) async {
    trashed.add(boardId);
    return detail().summary;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError(invocation.memberName.toString());
}

InkElement stroke(String id) =>
    InkElement(id: id, points: const [StrokePoint(1, 1), StrokePoint(9, 9)], color: const Color(0xFF000000), width: 4);

void main() {
  late FakeBoards repo;
  late InMemoryBoardDraftStore drafts;
  late ProviderContainer container;

  ProviderContainer make() => ProviderContainer(
    overrides: [
      whiteboardsRepositoryProvider.overrideWithValue(repo),
      boardDraftStoreProvider.overrideWithValue(drafts),
      principalIdProvider.overrideWithValue('actor-1'),
    ],
  );

  setUp(() {
    repo = FakeBoards();
    drafts = InMemoryBoardDraftStore();
    container = make();
  });
  tearDown(() => container.dispose());

  Future<BoardEditorController> open([ProviderContainer? c]) async {
    final into = c ?? container;
    into.listen(boardEditorProvider('b1'), (_, _) {});
    await into.read(boardEditorProvider('b1').future);
    return into.read(boardEditorProvider('b1').notifier);
  }

  EditorState state([ProviderContainer? c]) => (c ?? container).read(boardEditorProvider('b1')).value!;
  BoardDraft? draft() => drafts.stored['actor-1/b1'];
  Future<void> settleDraft() => Future<void>.delayed(BoardEditorController.draftDelay + const Duration(milliseconds: 50));

  test('a change saves with the board revision and takes the next one; the draft is then empty', () async {
    final c = await open();
    c.commit([stroke('a')]);
    expect(state().save, SaveStatus.dirty);
    expect(state().canUndo, isTrue);
    await c.flush();
    expect(repo.saves.single.$2, 1);
    expect(state().board.revision, 2);
    expect(state().save, SaveStatus.saved);
    expect(draft(), isNull);

    c.undo();
    await c.flush();
    expect(repo.saves.last.$2, 2);
    expect(repo.saves.last.$3.elements, isEmpty);
  });

  test('P1: page A saved, page B offline -- the draft holds B alone and B comes back on the next open', () async {
    final c = await open();
    repo.offline.add('p2');
    c.commit([stroke('a')]);
    c.goTo(1);
    c.commit([stroke('b')]);
    await c.flush();
    expect(state().save, SaveStatus.offline);
    expect(draft()!.pages.keys, ['p2']);
    expect(draft()!.pages['p2']!['base'], 'p2@1');

    // The app is closed and opened again (the board moved on: A was saved).
    container.dispose();
    repo.offline.clear();
    container = make();
    await open();
    expect(state().draftStale, isFalse);
    expect(state().save, SaveStatus.dirty);
    expect(state().pages[1].elements.single.id, 'b');
  });

  test('P1: killed while a save is on its way -- later edits are offered back, never dropped', () async {
    final c = await open();
    repo.hold = Completer<void>();
    c.commit([stroke('a')]);
    final saving = c.flush(); // the server applies it; the answer is held
    await Future<void>.delayed(Duration.zero);
    c.commit([stroke('a'), stroke('later')]);
    await settleDraft();
    expect(draft()!.pages['p1']!['base'], 'p1@1');

    // Killed before the answer arrives.
    container.dispose();
    unawaited(saving.catchError((_) {}));
    repo.hold = null;
    container = make();
    await open();
    // The server has the first stroke; the draft has the later edit, made on the old version.
    expect(state().draftStale, isTrue);
    expect(state().pages.first.elements.single.id, 'a');
    container.read(boardEditorProvider('b1').notifier).keepStaleDraft();
    expect(state().pages.first.elements.map((e) => e.id), ['a', 'later']);
    expect(state().save, SaveStatus.dirty);
  });

  test('a conflict stops the autosave; a transient error during it stays a conflict', () async {
    final c = await open();
    repo.revision = 7; // the board moved on in another tab
    c.commit([stroke('a')]);
    await c.flush();
    expect(state().save, SaveStatus.conflict);
    c.commit([stroke('a'), stroke('b')]);
    await c.flush();
    expect(repo.saves, isEmpty);
    repo.createError = const AppError(AppErrorKind.network);
    expect(await c.saveAsCopy('copy'), isNull);
    expect(state().save, SaveStatus.conflict);
  });

  test('a copy that fails part-way is moved to Deleted boards, not left half-made', () async {
    final c = await open();
    repo.revision = 7;
    c.commit([stroke('a')]);
    await c.flush();
    repo.offline.add('c1');
    expect(await c.saveAsCopy('copy'), isNull);
    expect(repo.trashed, ['copy']);
  });

  test('a page over 512 KB as the server measures it is never sent: "page full", no retries', () async {
    final c = await open();
    final huge = [
      for (var i = 0; i < 300; i++)
        TextElement(
          id: 't$i',
          text: 'x' * 1900,
          topLeft: Offset.zero,
          size: const Size(10, 10),
          fontSize: 20,
          color: const Color(0xFF000000),
        ),
    ];
    c.commit(huge);
    await c.flush();
    expect(repo.requests, 0);
    expect(state().save, SaveStatus.failed);
    expect(state().failureCode, kPageFullCode);
  });

  test('a page action while changes cannot be saved is refused with a notice, not a silent no-op', () async {
    final c = await open();
    repo.offline.add('p1');
    c.commit([stroke('a')]);
    expect(await c.addPage(), isFalse);
    expect(state().notice, EditorNotice.saveFirst);
    expect(repo.requests, 1); // the save attempt only; no page added
  });

  test('a draft that cannot be kept on the device says so', () async {
    final c = await open();
    drafts.full = true;
    repo.offline.add('p1');
    c.commit([stroke('a')]);
    await settleDraft();
    expect(state().draftNotKept, isTrue);
    await c.flush();
  });

  test('sign-out clears every board draft on the device', () async {
    drafts.stored['actor-1/b1'] = const BoardDraft(pages: {'p1': {}});
    drafts.stored['actor-2/b9'] = const BoardDraft(pages: {'p1': {}});
    await drafts.clearAll();
    expect(drafts.stored, isEmpty);
  });
}
