import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../data/whiteboards_repository.dart';
import '../domain/board.dart';

/// PD-39: the teacher's boards in use, newest first (the Boards tab).
class BoardsController extends AsyncNotifier<List<BoardSummary>> with SessionScoped<List<BoardSummary>> {
  @override
  List<BoardSummary> get sessionEmptyValue => const [];

  @override
  Future<List<BoardSummary>> build() {
    bindToSession();
    return ref.watch(whiteboardsRepositoryProvider).list();
  }

  WhiteboardsRepository get _repo => ref.read(whiteboardsRepositoryProvider);

  /// A new board with one page; answers its id to open it.
  Future<String> create(String title) async {
    final board = await _repo.create(title);
    ref.invalidateSelf();
    return board.id;
  }

  Future<void> rename(BoardSummary board, String title) async {
    await _repo.rename(board.id, board.revision, title);
    ref.invalidateSelf();
  }

  Future<String> duplicate(BoardSummary board) async {
    final copy = await _repo.duplicate(board.id);
    ref.invalidateSelf();
    return copy.id;
  }

  /// To Deleted boards (design §10 4d): restorable for 30 days.
  Future<void> moveToTrash(BoardSummary board) async {
    await _repo.moveToTrash(board.id, board.revision);
    ref.invalidateSelf();
    ref.invalidate(deletedBoardsProvider);
  }
}

final boardsProvider = AsyncNotifierProvider<BoardsController, List<BoardSummary>>(BoardsController.new);

/// Deleted boards, each restorable until its purgeAfter (design §10 4d, 5a).
class DeletedBoardsController extends AsyncNotifier<List<BoardSummary>> with SessionScoped<List<BoardSummary>> {
  @override
  List<BoardSummary> get sessionEmptyValue => const [];

  @override
  Future<List<BoardSummary>> build() {
    bindToSession();
    return ref.watch(whiteboardsRepositoryProvider).trash();
  }

  Future<void> restore(BoardSummary board) async {
    await ref.read(whiteboardsRepositoryProvider).restore(board.id);
    ref.invalidateSelf();
    ref.invalidate(boardsProvider);
  }
}

final deletedBoardsProvider = AsyncNotifierProvider<DeletedBoardsController, List<BoardSummary>>(DeletedBoardsController.new);
