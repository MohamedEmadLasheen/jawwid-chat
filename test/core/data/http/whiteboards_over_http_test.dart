import 'dart:ui';

import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/network/api_client.dart';
import 'package:jawwid_chat/core/network/api_config.dart';
import 'package:jawwid_chat/core/network/http_stack.dart';
import 'package:jawwid_chat/features/whiteboards/data/whiteboards_repository.dart';
import 'package:jawwid_chat/features/whiteboards/domain/board.dart';
import 'package:jawwid_chat/features/whiteboards/domain/board_elements.dart';
import 'package:jawwid_chat/features/whiteboards/domain/board_page.dart';
import 'package:jawwid_chat/features/whiteboards/domain/stroke_points.dart';

import 'test_server.dart';

class _NoTokens implements TokenProvider {
  @override
  Future<String?> accessToken() async => null;
  @override
  Future<String?> refresh() async => null;
  @override
  Future<void> onSessionEnded(AppError error) async {}
}

/// PD-39: the boards client over a REAL HTTP socket -- the exact paths and
/// bodies apps/api/src/whiteboards answers, every write naming its revision,
/// and the server's COMM.WHITEBOARD_* code reaching the caller intact.
///
/// No widget binding here: `TestWidgetsFlutterBinding` answers real requests with 400.
void main() {
  late TestServer server;

  setUp(() async => server = await TestServer.start());
  tearDown(() async => server.stop());

  HttpWhiteboardsRepository repository() =>
      HttpWhiteboardsRepository(client: buildApiClient(config: ApiConfig(baseUrl: server.baseUrl), tokens: _NoTokens()));

  Map<String, Object?> board({int revision = 3, String state = 'active'}) => {
        'id': 'b1',
        'title': 'الفاتحة',
        'lessonId': null,
        'state': state,
        'revision': revision,
        'pageCount': 2,
        'createdAt': '2026-10-29T09:00:00.000Z',
        'updatedAt': '2026-10-29T10:00:00.000Z',
        'trashedAt': null,
        'purgeAfter': null,
        'retainedUntil': null,
        'teacherId': 't1',
        'canEdit': true,
        'pages': [
          {'id': 'p2', 'position': 1, 'layout': 'grid', 'background': 'cream', 'document': {'v': 1, 'elements': []}, 'updatedAt': '2026-10-29T10:00:00.000Z'},
          {'id': 'p1', 'position': 0, 'layout': 'arabic_lines', 'background': 'white', 'document': {'v': 1, 'elements': []}, 'updatedAt': '2026-10-29T10:00:00.000Z'},
        ],
      };

  test('opens a board with its pages in order, and reads its state and revision', () async {
    server.on('GET', '/whiteboards/b1', [Reply.ok(board())]);
    final b = await repository().open('b1');
    expect(b.revision, 3);
    expect(b.canEdit, isTrue);
    expect(b.summary.state, BoardState.active);
    expect(b.pages.map((p) => p.id), ['p1', 'p2']);
    expect(b.pages.first.layout, PageLayout.arabicLines);
  });

  test('the autosave posts the page document, layout and background with the revision', () async {
    server.on('POST', '/whiteboards/b1/pages/p1', [
      const Reply.ok({'revision': 4, 'pageId': 'p1', 'updatedAt': '2026-10-29T10:01:00.000Z'}),
    ]);
    final page = BoardPage(
      id: 'p1',
      position: 0,
      layout: PageLayout.ruled,
      background: PageBackground.green,
      elements: [
        InkElement(id: 's1', points: const [StrokePoint(1, 2), StrokePoint(3, 4)], color: const Color(0xFF123456), width: 4),
      ],
    );
    final saved = await repository().savePage('b1', 'p1', 3, page);
    expect(saved.revision, 4);
    final body = server.lastRequestTo('POST', '/whiteboards/b1/pages/p1')!.body as Map;
    expect(body['revision'], 3);
    expect(body['layout'], 'ruled');
    expect(body['background'], 'green');
    expect(body['document'], {
      'v': 1,
      'elements': [page.elements.single.toJson()],
    });
  });

  test('a conflict reaches the caller as COMM.WHITEBOARD_CONFLICT', () async {
    server.on('POST', '/whiteboards/b1/pages/p1', [Reply.commError(409, 'COMM.WHITEBOARD_CONFLICT')]);
    final page = const BoardPage(id: 'p1', position: 0, layout: PageLayout.plain, background: PageBackground.white, elements: []);
    await expectLater(
      repository().savePage('b1', 'p1', 3, page),
      throwsA(isA<AppError>().having((e) => e.code, 'code', 'COMM.WHITEBOARD_CONFLICT')),
    );
  });

  test('trash and restore: the paths, and the revision the trash names', () async {
    server
      ..on('POST', '/whiteboards/b1/trash', [
        Reply.ok({...board(state: 'trashed'), 'trashedAt': '2026-10-29T10:00:00.000Z', 'purgeAfter': '2026-11-28T10:00:00.000Z'}),
      ])
      ..on('POST', '/whiteboards/b1/restore', [Reply.ok(board(revision: 5))]);
    final trashed = await repository().moveToTrash('b1', 3);
    expect(trashed.state, BoardState.trashed);
    expect(trashed.purgeAfter, isNotNull);
    expect((server.lastRequestTo('POST', '/whiteboards/b1/trash')!.body as Map)['revision'], 3);
    expect((await repository().restore('b1')).revision, 5);
  });

  test('pages: add, reorder and delete name the revision; reorder sends every page id', () async {
    server
      ..on('POST', '/whiteboards/b1/pages', [Reply.ok(board(revision: 4))])
      ..on('POST', '/whiteboards/b1/pages/order', [Reply.ok(board(revision: 5))])
      ..on('POST', '/whiteboards/b1/pages/p2/delete', [Reply.ok(board(revision: 6))]);
    final repo = repository();
    await repo.addPage('b1', 3, position: 1, layout: PageLayout.grid);
    expect(server.lastRequestTo('POST', '/whiteboards/b1/pages')!.body, {'revision': 3, 'position': 1, 'layout': 'grid'});
    await repo.reorderPages('b1', 4, ['p2', 'p1']);
    expect(server.lastRequestTo('POST', '/whiteboards/b1/pages/order')!.body, {'revision': 4, 'pageIds': ['p2', 'p1']});
    expect((await repo.deletePage('b1', 'p2', 5)).revision, 6);
  });
}
