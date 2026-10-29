// PD-39: the open board's saving (design §4.5): every write names the
// revision and takes the next from the answer; a conflict stops the autosave
// and is never merged; offline keeps the pages on the device and retries; a
// draft comes back only onto the revision it was made against.
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

class FakeBoards implements WhiteboardsRepository {
  FakeBoards({this.revision = 1});

  int revision;
  final List<(String pageId, int revision, BoardPage page)> saves = [];
  Object? saveError;

  BoardDetail detail() => BoardDetail(
        summary: BoardSummary(id: 'b1', title: 'Board', state: BoardState.active, revision: revision, pageCount: 2, updatedAt: DateTime(2026)),
        canEdit: true,
        pages: const [
          BoardPage(id: 'p1', position: 0, layout: PageLayout.plain, background: PageBackground.white, elements: []),
          BoardPage(id: 'p2', position: 1, layout: PageLayout.plain, background: PageBackground.white, elements: []),
        ],
      );

  @override
  Future<BoardDetail> open(String boardId) async => detail();

  @override
  Future<PageSaved> savePage(String boardId, String pageId, int revision, BoardPage page) async {
    if (saveError != null) throw saveError!;
    if (revision != this.revision) throw const AppError(AppErrorKind.unknown, code: 'COMM.WHITEBOARD_CONFLICT');
    saves.add((pageId, revision, page));
    this.revision++;
    return PageSaved(revision: this.revision, updatedAt: DateTime(2026));
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

  ProviderContainer make() => ProviderContainer(overrides: [
        whiteboardsRepositoryProvider.overrideWithValue(repo),
        boardDraftStoreProvider.overrideWithValue(drafts),
        principalIdProvider.overrideWithValue('actor-1'),
      ]);

  setUp(() {
    repo = FakeBoards();
    drafts = InMemoryBoardDraftStore();
    container = make();
  });
  tearDown(() => container.dispose());

  Future<BoardEditorController> open() async {
    container.listen(boardEditorProvider('b1'), (_, _) {});
    await container.read(boardEditorProvider('b1').future);
    return container.read(boardEditorProvider('b1').notifier);
  }

  EditorState state() => container.read(boardEditorProvider('b1')).value!;

  test('a change saves with the board revision and takes the next one; undo is a step', () async {
    final c = await open();
    c.commit([stroke('a')]);
    expect(state().save, SaveStatus.dirty);
    expect(state().canUndo, isTrue);
    await c.flush();
    expect(repo.saves.single.$2, 1);
    expect(state().board.revision, 2);
    expect(state().save, SaveStatus.saved);
    expect(drafts.stored, isEmpty);

    c.undo();
    await c.flush();
    expect(repo.saves.last.$2, 2);
    expect(repo.saves.last.$3.elements, isEmpty);
  });

  test('a conflict stops the autosave; nothing more is sent until the teacher chooses', () async {
    final c = await open();
    repo.revision = 7; // the board moved on in another tab
    c.commit([stroke('a')]);
    await c.flush();
    expect(state().save, SaveStatus.conflict);
    c.commit([stroke('a'), stroke('b')]);
    await c.flush();
    expect(repo.saves, isEmpty);
    expect(state().save, SaveStatus.conflict);
  });

  test('offline: the page stays on the device, marked not saved', () async {
    final c = await open();
    repo.saveError = const AppError(AppErrorKind.network);
    c.commit([stroke('a')]);
    await Future<void>.delayed(BoardEditorController.draftDelay + const Duration(milliseconds: 50));
    await c.flush();
    expect(state().save, SaveStatus.offline);
    final draft = drafts.stored['actor-1/b1']!;
    expect(draft.revision, 1);
    expect(draft.pages.keys, ['p1']);
  });

  test('a draft comes back onto the same revision, and is sent', () async {
    drafts.stored['actor-1/b1'] = BoardDraft(revision: 1, pages: {
      'p2': {'document': {'v': 1, 'elements': [stroke('kept').toJson()]}, 'layout': 'grid', 'background': 'cream'},
    });
    final c = await open();
    expect(state().save, SaveStatus.dirty);
    expect(state().pages[1].elements.single.id, 'kept');
    expect(state().pages[1].layout, PageLayout.grid);
    await c.flush();
    expect(repo.saves.single.$1, 'p2');
  });

  test('a draft made against an older revision is not applied, and says so', () async {
    repo.revision = 4;
    drafts.stored['actor-1/b1'] = BoardDraft(revision: 2, pages: {
      'p1': {'document': {'v': 1, 'elements': [stroke('stale').toJson()]}, 'layout': 'plain', 'background': 'white'},
    });
    await open();
    expect(state().draftDiscarded, isTrue);
    expect(state().pages.first.elements, isEmpty);
    expect(drafts.stored, isEmpty);
  });
}
