import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/core/media/attachment_opener.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/lessons/presentation/lesson_card_view.dart';
import 'package:jawwid_chat/features/lessons/presentation/lesson_report_sheet.dart';
import 'package:jawwid_chat/features/materials/data/materials_repository.dart';
import 'package:jawwid_chat/features/materials/presentation/activity_view.dart';
import 'package:jawwid_chat/features/materials/presentation/child_materials_screen.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/lesson.dart';
import 'package:jawwid_chat/shared/models/materials.dart';

/// PD-29 on the client: a child's Materials page (Library, Practice this week,
/// Progress map), playing an item behind the activity seam, and the lesson
/// report's Practice and Memorization sections. The server's answers are
/// stubbed; the client is held to drawing what it is given and sending exactly
/// what the teacher chose.
void main() {
  const game = MaterialItem(
    id: 'm-1', titleAr: 'لعبة سورة النبأ', titleEn: 'An-Naba game', subject: 'quran',
    strand: 'memorization', kind: 'activity_package', mode: 'package', surah: 78, ageGroups: ['7-9'],
  );
  const song = MaterialItem(id: 'm-2', titleAr: 'أنشودة الحروف', titleEn: 'Letters song', subject: 'arabic', kind: 'video', mode: 'link');

  Widget app(Widget home, {required _Materials materials, _Lessons? lessons, _Activity? activity, _Opener? opener, Locale locale = const Locale('en')}) {
    return ProviderScope(
      overrides: [
        materialsRepositoryProvider.overrideWithValue(materials),
        if (lessons != null) lessonRepositoryProvider.overrideWithValue(lessons),
        activityViewFactoryProvider.overrideWithValue(activity ?? _Activity()),
        attachmentOpenerProvider.overrideWithValue(opener ?? _Opener()),
      ],
      child: MaterialApp(
        locale: locale,
        theme: JawwidTheme.light(isArabic: locale.languageCode == 'ar'),
        supportedLocales: JawwidApp.supportedLocales,
        localizationsDelegates: const [
          L10n.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        home: home,
      ),
    );
  }

  group('Library', () {
    testWidgets('opens on the child\'s age band, filters by subject, and plays an activity behind the seam', (tester) async {
      final materials = _Materials()..items = [game, song];
      final activity = _Activity();
      await tester.pumpWidget(app(const ChildMaterialsScreen(learnerId: 'k1', childName: 'Sara'), materials: materials, activity: activity));
      await tester.pumpAndSettle();

      expect(materials.libraryCalls.single, (subject: null, ageGroup: null));
      expect(find.text('An-Naba game'), findsOneWidget);
      expect(find.text('Letters song'), findsOneWidget);
      // The server opened on the child's band; the filter says so.
      expect(find.text('Ages 7–9 · your child\'s age'), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('materials-subject-quran')));
      await tester.pumpAndSettle();
      expect(materials.libraryCalls.last, (subject: 'quran', ageGroup: null));

      await tester.tap(find.text('An-Naba game'));
      await tester.pumpAndSettle();
      expect(materials.opened, ['m-1']);
      expect(activity.urls, [_Materials.playUrl]);
      // An uploaded package: sandboxed WITHOUT same-origin, and never offered to the browser.
      expect(activity.sandboxes.single, 'allow-scripts allow-forms');
      expect(find.byTooltip('Open in browser'), findsNothing);
      // The WebView may stay only under the package's own play prefix.
      final allow = activity.allows.single;
      expect(allow(Uri.parse('https://api.example.test/api/v1/materials/play/m-1/tok/js/app.js')), isTrue);
      expect(allow(Uri.parse('https://api.example.test/api/v1/materials/play/m-2/tok/index.html')), isFalse);
      expect(allow(Uri.parse('https://api.example.test/api/v1/me')), isFalse);
      expect(allow(Uri.parse('https://evil.example.test/api/v1/materials/play/m-1/tok/x')), isFalse);
    });

    testWidgets('a lesson of the lessons site is framed keeping its own origin, pinned to its host', (tester) async {
      final materials = _Materials()
        ..items = [song]
        ..openAs = const OpenedMaterial(kind: 'activity_link', mode: 'link', presentation: MaterialPresentation.frameSite, url: 'https://lessons.example.test/lessons/quran/surah-78');
      final activity = _Activity();
      await tester.pumpWidget(app(const ChildMaterialsScreen(learnerId: 'k1'), materials: materials, activity: activity));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Letters song'));
      await tester.pumpAndSettle();
      expect(activity.sandboxes.single, 'allow-scripts allow-same-origin allow-forms');
      expect(activity.sandboxes.single, isNot(contains('allow-popups')));
      expect(activity.sandboxes.single, isNot(contains('allow-top-navigation')));
      expect(activity.sandboxes.single, isNot(contains('allow-modals')));
      final allow = activity.allows.single;
      expect(allow(Uri.parse('https://lessons.example.test/lessons/arabic/lesson-1')), isTrue);
      expect(allow(Uri.parse('https://gemini.example.test/')), isFalse);
      expect(allow(Uri.parse('http://lessons.example.test/x')), isFalse);
      expect(find.byTooltip('Open in browser'), findsOneWidget);
    });

    testWidgets('any other link is never embedded: it goes to the browser', (tester) async {
      final materials = _Materials()
        ..items = [song]
        ..openAs = const OpenedMaterial(kind: 'activity_link', mode: 'link', presentation: MaterialPresentation.browser, url: 'https://elsewhere.example.test/game');
      final activity = _Activity();
      final opener = _Opener();
      await tester.pumpWidget(app(const ChildMaterialsScreen(learnerId: 'k1'), materials: materials, activity: activity, opener: opener));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Letters song'));
      await tester.pumpAndSettle();
      expect(opener.opened, ['https://elsewhere.example.test/game']);
      expect(activity.urls, isEmpty);
    });

    test('an unknown presentation is treated as "browser": never embedded', () {
      expect(MaterialPresentation.parse(null), MaterialPresentation.browser);
      expect(MaterialPresentation.parse('frame-everything'), MaterialPresentation.browser);
      expect(MaterialPresentation.parse('frame-isolated'), MaterialPresentation.frameIsolated);
    });

    testWidgets('reads in Arabic', (tester) async {
      final materials = _Materials()..items = [game];
      await tester.pumpWidget(app(const ChildMaterialsScreen(learnerId: 'k1'), materials: materials, locale: const Locale('ar')));
      await tester.pumpAndSettle();
      expect(find.text('المكتبة'), findsOneWidget);
      expect(find.text('تدريب هذا الأسبوع'), findsOneWidget);
      expect(find.text('خريطة الحفظ'), findsOneWidget);
      expect(find.text('لعبة سورة النبأ'), findsOneWidget);
    });

    testWidgets('a build without a materials server says so instead of failing', (tester) async {
      await tester.pumpWidget(const ProviderScope(
        child: MaterialApp(
          supportedLocales: JawwidApp.supportedLocales,
          localizationsDelegates: [L10n.delegate, GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate],
          home: ChildMaterialsScreen(learnerId: 'k1'),
        ),
      ));
      await tester.pumpAndSettle();
      expect(find.text('Materials could not be loaded.'), findsOneWidget);
    });
  });

  group('Practice this week', () {
    testWidgets('shows the ayahs with their recitation, the items, the tasks and the homework', (tester) async {
      final materials = _Materials()
        ..week = PracticeWeek(current: true, reports: [
          PracticeReport(
            lessonId: 'l-1',
            submittedAt: DateTime(2026, 10, 22),
            nextTasks: const ['revise_previous'],
            homework: 'Revise Al-Mulk 1–5',
            practice: const [
              AyahPractice(surah: 67, nameAr: 'الملك', nameEn: 'Al-Mulk', ayahFrom: 1, ayahTo: 10, wholeSurah: false, hasRecitation: true),
              ItemPractice(game),
              ItemPractice(null),
            ],
          ),
        ]);
      await tester.pumpWidget(app(const ChildMaterialsScreen(learnerId: 'k1'), materials: materials));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('materials-tab-practice')));
      await tester.pumpAndSettle();

      expect(find.text('Surah Al-Mulk, ayahs 1–10'), findsOneWidget);
      expect(find.byKey(const ValueKey('listen-l-1-67')), findsOneWidget);
      expect(find.text('An-Naba game'), findsWidgets);
      expect(find.text('This item is no longer in the library.'), findsOneWidget);
      expect(find.text('Revise previous lessons'), findsOneWidget);
      expect(find.text('Revise Al-Mulk 1–5'), findsOneWidget);
    });
  });

  group('Progress map', () {
    ProgressMap map({required bool canCorrect}) => ProgressMap(
          childName: 'Sara',
          counts: const {'memorized': 1, 'in_progress': 0, 'needs_revision': 0, 'not_started': 113},
          canCorrect: canCorrect,
          juz: const [
            JuzGroup(juz: 30, surahs: [ProgressSurah(number: 78, nameAr: 'النبأ', nameEn: 'An-Naba', status: 'memorized')]),
          ],
        );

    testWidgets('a parent sees the map and a surah\'s history, and is offered no correction', (tester) async {
      final materials = _Materials()..map = map(canCorrect: false);
      await tester.pumpWidget(app(const ChildMaterialsScreen(learnerId: 'k1', initialTab: 2), materials: materials));
      await tester.pumpAndSettle();
      expect(find.text('Memorized: 1'), findsOneWidget);
      expect(find.text('Juz’ 30'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('surah-78')));
      await tester.pumpAndSettle();
      expect(materials.historyAsked, [78]);
      expect(find.textContaining('Lesson report'), findsOneWidget);
      expect(find.byKey(const ValueKey('correct-submit')), findsNothing);
    });

    testWidgets('the teacher corrects a surah, and the correction carries its reason', (tester) async {
      final materials = _Materials()..map = map(canCorrect: true);
      await tester.pumpWidget(app(const ChildMaterialsScreen(learnerId: 'k1', initialTab: 2), materials: materials));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('surah-78')));
      await tester.pumpAndSettle();
      final submit = find.byKey(const ValueKey('correct-submit'));
      expect(tester.widget<FilledButton>(submit).onPressed, isNull, reason: 'no reason, no correction');
      expect(find.text('Parents can see this reason.'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('correct-needs_revision')));
      await tester.enterText(find.byKey(const ValueKey('correct-reason')), 'forgot the last ayahs');
      await tester.pump();
      await tester.ensureVisible(submit);
      await tester.tap(submit);
      await tester.pumpAndSettle();
      expect(materials.corrections, [(surah: 78, status: 'needs_revision', reason: 'forgot the last ayahs')]);
    });
  });

  group('the lesson report', () {
    const ticket = LessonTicket(kind: LessonTicketKind.report, lessonId: 'les-1', learnerId: 'k1', learnerName: 'Sara');

    testWidgets('sends the practice and the surah statuses the teacher chose', (tester) async {
      final lessons = _Lessons();
      final materials = _Materials()..items = [game];
      await tester.pumpWidget(app(const Scaffold(body: QuickReportForm(ticket: ticket)), materials: materials, lessons: lessons));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const ValueKey('report-topic-new_memorization')));
      // Ayahs: Al-Mulk 1–10.
      await tester.ensureVisible(find.byKey(const ValueKey('practice-add-ayahs')));
      await tester.tap(find.byKey(const ValueKey('practice-add-ayahs')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('ayah-surah')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('67. Al-Mulk').last);
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const ValueKey('ayah-to')), '10');
      await tester.tap(find.byKey(const ValueKey('ayah-add')));
      await tester.pumpAndSettle();
      expect(find.text('Al-Mulk 1–10'), findsOneWidget);
      // A library item.
      await tester.ensureVisible(find.byKey(const ValueKey('practice-add-item')));
      await tester.tap(find.byKey(const ValueKey('practice-add-item')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('picker-m-1')));
      await tester.pumpAndSettle();
      // A surah status.
      await tester.ensureVisible(find.byKey(const ValueKey('mark-add')));
      await tester.tap(find.byKey(const ValueKey('mark-add')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('mark-status-memorized')));
      await tester.tap(find.byKey(const ValueKey('mark-save')));
      await tester.pumpAndSettle();

      await tester.ensureVisible(find.byKey(const ValueKey('report-submit')));
      await tester.tap(find.byKey(const ValueKey('report-submit')));
      await tester.pumpAndSettle();
      final sent = lessons.reported.single.toJson();
      expect(sent['practice'], [
        {'surah': 67, 'ayahFrom': 1, 'ayahTo': 10},
        {'itemId': 'm-1'},
      ]);
      expect(sent['memorization'], [
        {'surah': 1, 'status': 'memorized'},
      ]);
    });

    testWidgets('a report with no practice sends neither key', (tester) async {
      final lessons = _Lessons();
      final materials = _Materials();
      await tester.pumpWidget(app(const Scaffold(body: QuickReportForm(ticket: ticket)), materials: materials, lessons: lessons));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('report-topic-revision')));
      await tester.ensureVisible(find.byKey(const ValueKey('report-submit')));
      await tester.tap(find.byKey(const ValueKey('report-submit')));
      await tester.pumpAndSettle();
      expect(lessons.reported.single.toJson().containsKey('practice'), isFalse);
      expect(lessons.reported.single.toJson().containsKey('memorization'), isFalse);
    });

    testWidgets('an edit the teacher leaves untouched leaves practice to the server', (tester) async {
      final lessons = _Lessons();
      final materials = _Materials();
      await tester.pumpWidget(app(const Scaffold(body: QuickReportForm(editLessonId: 'les-1')), materials: materials, lessons: lessons));
      await tester.pumpAndSettle();
      expect(find.text('Practice stays as it was unless you change it.'), findsOneWidget);
      await tester.ensureVisible(find.byKey(const ValueKey('report-submit')));
      await tester.tap(find.byKey(const ValueKey('report-submit')));
      await tester.pumpAndSettle();
      expect(lessons.edited.single.toJson().containsKey('practice'), isFalse);
    });
  });

  testWidgets('the report card in the chat says the practice, the surahs named', (tester) async {
    const card = MessageCard(kind: 'lesson_report', payload: {
      'learnerName': 'Sara',
      'coveredTopics': ['revision'],
      'practice': [
        {'kind': 'ayah_range', 'surah': 67, 'ayahFrom': 1, 'ayahTo': 10},
        {'kind': 'ayah_range', 'surah': 1, 'ayahFrom': 1, 'ayahTo': 7},
        {'kind': 'item', 'itemId': 'm-1', 'title': 'An-Naba game'},
      ],
    });
    await tester.pumpWidget(app(Scaffold(body: Builder(builder: (c) => lessonCardView(c, card, Colors.black)!)), materials: _Materials()));
    await tester.pumpAndSettle();
    expect(find.text('Practice this week'), findsOneWidget);
    expect(find.text('Surah Al-Mulk, ayahs 1–10، Surah Al-Fatihah، An-Naba game'), findsOneWidget);
  });

  test('activityAllowance keeps a link on its own https host', () {
    final allow = activityAllowance('https://h5p.example.test/embed/42', isPackage: false);
    expect(allow(Uri.parse('https://h5p.example.test/content/1')), isTrue);
    expect(allow(Uri.parse('http://h5p.example.test/content/1')), isFalse);
    expect(allow(Uri.parse('https://elsewhere.example.test/')), isFalse);
  });
}

class _Activity implements ActivityViewFactory {
  final urls = <String>[];
  final sandboxes = <String>[];
  final allows = <bool Function(Uri)>[];

  @override
  Widget build(BuildContext context, {required String url, required String sandbox, required bool Function(Uri uri) allow}) {
    urls.add(url);
    sandboxes.add(sandbox);
    allows.add(allow);
    return const Text('activity');
  }
}

class _Opener implements AttachmentOpener {
  final opened = <String>[];

  @override
  Future<bool> open(String url) async {
    opened.add(url);
    return true;
  }
}

class _Materials implements MaterialsRepository {
  static const playUrl = 'https://api.example.test/api/v1/materials/play/m-1/tok/index.html';
  List<MaterialItem> items = const [];
  PracticeWeek week = const PracticeWeek(current: true, reports: []);
  ProgressMap map = const ProgressMap(childName: '', counts: {}, juz: [], canCorrect: false);
  final libraryCalls = <({String? subject, String? ageGroup})>[];
  final opened = <String>[];
  final historyAsked = <int>[];
  final corrections = <({int surah, String status, String reason})>[];

  static const _surahs = [
    Surah(number: 1, nameAr: 'الفاتحة', nameEn: 'Al-Fatihah', ayahCount: 7, juz: 1),
    Surah(number: 67, nameAr: 'الملك', nameEn: 'Al-Mulk', ayahCount: 30, juz: 29),
  ];

  @override
  Future<List<Surah>> surahs() async => _surahs;

  @override
  Future<ChildLibrary> library(String learnerId, {String? subject, String? ageGroup}) async {
    libraryCalls.add((subject: subject, ageGroup: ageGroup));
    return ChildLibrary(
      childName: 'Sara',
      childAgeGroup: '7-9',
      ageGroup: ageGroup ?? '7-9',
      items: [for (final i in items) if (subject == null || i.subject == subject) i],
    );
  }

  @override
  Future<PracticeWeek> practice(String learnerId) async => week;

  @override
  Future<ProgressMap> progress(String learnerId) async => map;

  SurahHistory _history(int surah) => SurahHistory(
        surah: const ProgressSurah(number: 78, nameAr: 'النبأ', nameEn: 'An-Naba', status: ''),
        marks: [
          for (final c in corrections) SurahMark(status: c.status, source: 'correction', byKind: 'teacher', byName: 'Teacher', reason: c.reason, at: DateTime(2026, 10, 24)),
          SurahMark(status: 'memorized', source: 'report', byKind: 'teacher', byName: 'Teacher', at: DateTime(2026, 10, 20)),
        ],
      );

  @override
  Future<SurahHistory> history(String learnerId, int surah) async {
    historyAsked.add(surah);
    return _history(surah);
  }

  @override
  Future<SurahHistory> correct(String learnerId, int surah, {required String status, required String reason}) async {
    corrections.add((surah: surah, status: status, reason: reason));
    return _history(surah);
  }

  OpenedMaterial openAs = const OpenedMaterial(kind: 'activity_package', mode: 'package', presentation: MaterialPresentation.frameIsolated, url: playUrl);

  @override
  Future<OpenedMaterial> open(String itemId) async {
    opened.add(itemId);
    return openAs;
  }

  @override
  Future<String> recitation(int surah) async => 'https://audio.example.test/$surah.mp3';

  @override
  Future<List<MaterialItem>> picker({String? query, int? surah}) async => items;
}

class _Lessons implements LessonRepository {
  final reported = <LessonReportDraft>[];
  final edited = <LessonReportDraft>[];

  @override
  Future<void> report(String lessonId, LessonReportDraft draft) async => reported.add(draft);

  @override
  Future<void> editReport(String lessonId, LessonReportDraft draft) async => edited.add(draft);

  @override
  Future<LessonReportDraft?> reportFor(String lessonId) async => const LessonReportDraft(coveredTopics: ['revision']);

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError(invocation.memberName.toString());
}
