// PD-39 PR-3: Quran verses on a board (design §4.3), against the shared,
// verified dataset. The texts here are SYNTHETIC placeholders, never Quran
// text: a test proves the plumbing, the dataset proves the words.

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/materials/data/materials_repository.dart';
import 'package:jawwid_chat/features/whiteboards/application/board_editor_controller.dart';
import 'package:jawwid_chat/features/whiteboards/data/quran_text_repository.dart';
import 'package:jawwid_chat/features/whiteboards/data/whiteboards_repository.dart';
import 'package:jawwid_chat/features/whiteboards/domain/board.dart';
import 'package:jawwid_chat/features/whiteboards/domain/board_elements.dart';
import 'package:jawwid_chat/features/whiteboards/domain/board_page.dart';
import 'package:jawwid_chat/features/whiteboards/presentation/board_editor_screen.dart';
import 'package:jawwid_chat/features/whiteboards/presentation/board_painter.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/materials.dart';

final _range = 'b' * 64;

VerseText _text(int from, int to, {String? range, bool basmala = false}) => VerseText(
  datasetId: 'tanzil-uthmani-1.1',
  rangeSha256: range ?? _range,
  attribution: 'Tanzil Project — tanzil.net',
  ayahs: [
    for (var a = from; a <= to; a++) VerseAyah(ayah: a, text: 'SYNTHETIC-$a', basmala: basmala && a == 1 ? 'SYNTHETIC-BASMALA' : null),
  ],
);

class _Quran implements QuranTextRepository {
  Object? error;
  String range = 'b' * 64;
  final asked = <(int, int, int)>[];

  @override
  Future<VerseText> ayahs(int surah, int from, int to) async {
    asked.add((surah, from, to));
    if (error != null) throw error!;
    return _text(from, to, range: range, basmala: true);
  }
}

class _Materials implements MaterialsRepository {
  @override
  Future<List<Surah>> surahs() async => const [Surah(number: 2, nameAr: 'سورة', nameEn: 'Surah Two', ayahCount: 286, juz: 1)];

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError(invocation.memberName.toString());
}

class _Boards implements WhiteboardsRepository {
  final saved = <BoardPage>[];
  int revision = 1;

  @override
  Future<BoardDetail> open(String boardId) async => BoardDetail(
    summary: BoardSummary(id: boardId, title: 'B', state: BoardState.active, revision: revision, pageCount: 1, updatedAt: DateTime(2026)),
    canEdit: true,
    pages: const [BoardPage(id: 'p1', position: 0, layout: PageLayout.plain, background: PageBackground.white, elements: [])],
  );

  @override
  Future<PageSaved> savePage(String boardId, String pageId, int revision, BoardPage page) async {
    saved.add(page);
    return PageSaved(revision: ++this.revision, updatedAt: DateTime(2026));
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError(invocation.memberName.toString());
}

VerseElement _verse({String? range}) => VerseElement(
  id: 'v',
  surah: 2,
  fromAyah: 1,
  toAyah: 3,
  datasetId: 'tanzil-uthmani-1.1',
  rangeSha256: range ?? _range,
  rect: const Rect.fromLTWH(0, 0, 1400, 300),
  fontSize: 64,
  color: const Color(0xFF000000),
);

void main() {
  late _Quran quran;
  late ProviderContainer container;

  setUp(() {
    quran = _Quran();
    container = ProviderContainer(
      overrides: [
        quranTextRepositoryProvider.overrideWithValue(quran),
        materialsRepositoryProvider.overrideWithValue(_Materials()),
        whiteboardsRepositoryProvider.overrideWithValue(_Boards()),
        boardDraftStoreProvider.overrideWithValue(InMemoryBoardDraftStore()),
        principalIdProvider.overrideWithValue('teacher-1'),
      ],
    );
  });
  tearDown(() => container.dispose());

  group('the verse cache', () {
    test('a range is fetched once; its text is shown only while its SHA-256 is the stored one', () async {
      final cache = container.read(verseCacheProvider.notifier);
      cache.ensure([_verse(), _verse()]);
      await Future<void>.delayed(Duration.zero);
      expect(quran.asked, [(2, 1, 3)]);
      expect(cache.lookup(_verse()).status, VerseStatus.ready);
      expect(cache.lookup(_verse(range: 'c' * 64)).status, VerseStatus.changed);
    });

    test('an unavailable dataset (503) shows no text, and is asked again later', () async {
      quran.error = Exception('COMM.QURAN_UNAVAILABLE');
      final cache = container.read(verseCacheProvider.notifier);
      cache.ensure([_verse()]);
      await Future<void>.delayed(Duration.zero);
      expect(cache.lookup(_verse()).status, VerseStatus.unavailable);
      quran.error = null;
      cache.ensure([_verse()]);
      await Future<void>.delayed(Duration.zero);
      expect(cache.lookup(_verse()).status, VerseStatus.ready);
    });
  });

  test('the verse body closes every ayah with U+06DD and its Arabic-Indic number; the Basmala is its own line', () {
    final text = _text(9, 11, basmala: false);
    expect(verseBody(text), 'SYNTHETIC-9 ۝٩ SYNTHETIC-10 ۝١٠ SYNTHETIC-11 ۝١١');
    expect(verseBody(_text(1, 1, basmala: true)), isNot(contains('BASMALA')));
  });

  testWidgets('the picker inserts a reference -- surah, ayat, dataset, range SHA-256 -- and never the text', (tester) async {
    tester.view.physicalSize = const Size(1280, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: MaterialApp(
          locale: const Locale('en'),
          theme: JawwidTheme.light(isArabic: false),
          supportedLocales: JawwidApp.supportedLocales,
          localizationsDelegates: const [
            L10n.delegate,
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
          home: const BoardEditorScreen(boardId: 'b1'),
        ),
      ),
    );
    await tester.pumpAndSettle();
    final l10n = await L10n.delegate.load(const Locale('en'));
    await tester.tap(find.byTooltip(l10n.boardToolVerse));
    await tester.pumpAndSettle();
    await tester.tap(find.byType(DropdownMenu<Surah>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('2. Surah Two').last);
    await tester.pumpAndSettle();
    await tester.pump(const Duration(milliseconds: 300));
    await tester.pumpAndSettle();
    expect(find.textContaining('Tanzil Project'), findsOneWidget);
    await tester.tap(find.text(l10n.boardVerseInsert));
    await tester.pumpAndSettle();

    final verse = container.read(boardEditorProvider('b1')).value!.page.elements.single as VerseElement;
    expect((verse.surah, verse.fromAyah, verse.toAyah, verse.rangeSha256), (2, 1, 7, _range));
    final json = verse.toJson();
    expect(json.keys.toSet(), {'id', 'kind', 'surah', 'fromAyah', 'toAyah', 'datasetId', 'rangeSha256', 'transform', 'style'});
    expect(json.toString(), isNot(contains('SYNTHETIC')));
    await tester.pump(BoardEditorController.saveDelay + const Duration(milliseconds: 100));
    await tester.pumpAndSettle();
  });
}
