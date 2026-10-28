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
import 'package:jawwid_chat/features/materials/data/lesson_audio.dart';
import 'package:jawwid_chat/features/materials/data/materials_repository.dart';
import 'package:jawwid_chat/features/materials/presentation/activity_view.dart';
import 'package:jawwid_chat/features/materials/presentation/child_materials_screen.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/lesson.dart';
import 'package:jawwid_chat/shared/models/materials.dart';

/// PD-29 on the client (amended 2026-10-26): a child's Materials page (Library,
/// Opened this week), playing an item behind the activity seam, and the lesson
/// report's Practice section. The server's answers are
/// stubbed; the client is held to drawing what it is given and sending exactly
/// what the teacher chose.
void main() {
  const game = MaterialItem(
    id: 'm-1', titleAr: 'لعبة سورة النبأ', titleEn: 'An-Naba game', subject: 'quran',
    strand: 'memorization', kind: 'activity_package', mode: 'package', surah: 78, ageGroups: ['7-9'],
  );
  const song = MaterialItem(id: 'm-2', titleAr: 'أنشودة الحروف', titleEn: 'Letters song', subject: 'arabic', kind: 'video', mode: 'link');

  Widget app(Widget home,
      {required _Materials materials, _Lessons? lessons, _Activity? activity, _Opener? opener, Locale locale = const Locale('en'), String lessonsOrigin = 'https://lessons.example.test'}) {
    return ProviderScope(
      overrides: [
        materialsRepositoryProvider.overrideWithValue(materials),
        lessonsOriginProvider.overrideWithValue(lessonsOrigin),
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
    testWidgets('opens on Quran and the child\'s age band, has no subject "All", and plays an activity behind the seam', (tester) async {
      final materials = _Materials()..items = [game, song];
      final activity = _Activity();
      await tester.pumpWidget(app(const ChildMaterialsScreen(learnerId: 'k1', childName: 'Sara'), materials: materials, activity: activity));
      await tester.pumpAndSettle();

      // One subject at a time, Quran first; the age band keeps its "All ages".
      expect(materials.libraryCalls.single, (subject: 'quran', ageGroup: null));
      expect(find.byKey(const ValueKey('materials-subject-all')), findsNothing);
      expect(find.text('All'), findsNothing);
      expect(tester.widget<ChoiceChip>(find.byKey(const ValueKey('materials-subject-quran'))).selected, isTrue);
      expect(find.text('An-Naba game'), findsOneWidget);
      expect(find.text('Letters song'), findsNothing);
      // The server opened on the child's band; the filter says so.
      expect(find.text('Ages 7–9 · your child\'s age'), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('materials-subject-arabic')));
      await tester.pumpAndSettle();
      expect(materials.libraryCalls.last, (subject: 'arabic', ageGroup: null));
      expect(find.text('Letters song'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('materials-subject-quran')));
      await tester.pumpAndSettle();

      await tester.tap(find.text('An-Naba game'));
      await tester.pumpAndSettle();
      // Opened FOR this child: the server records it in their "Opened this week".
      expect(materials.opens, [(itemId: 'm-1', learnerId: 'k1')]);
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

    testWidgets('a Quran lesson of the lessons site is handed the audio list the release gate gave this account', (tester) async {
      final message = {'type': 'jawwid:quran-audio', 'surah': 78, 'ayahs': <Object?>[]};
      final materials = _Materials()
        ..items = [game]
        ..lessonAudioAnswer = message
        ..openAs = const OpenedMaterial(
            kind: 'activity_link', mode: 'link', presentation: MaterialPresentation.frameSite, url: 'https://lessons.example.test/lessons/quran/surah-78', audioEligible: true);
      final activity = _Activity();
      await tester.pumpWidget(app(const ChildMaterialsScreen(learnerId: 'k1'), materials: materials, activity: activity));
      await tester.pumpAndSettle();
      await tester.tap(find.text('An-Naba game'));
      await tester.pumpAndSettle();
      // Asked once, however often the view rebuilds.
      expect(materials.lessonAudioAsked, [78]);
      expect(await activity.audios.last, message);
    });

    testWidgets('no audio for: a package, a non-surah page, an allowlisted third-party frame, another origin, or a build without a lessons origin', (tester) async {
      for (final (opened, origin) in const [
        (OpenedMaterial(kind: 'activity_package', mode: 'package', presentation: MaterialPresentation.frameIsolated, url: _Materials.playUrl), 'https://lessons.example.test'),
        (OpenedMaterial(kind: 'activity_link', mode: 'link', presentation: MaterialPresentation.frameSite, url: 'https://lessons.example.test/lessons/arabic/lesson-1', audioEligible: true), 'https://lessons.example.test'),
        // A lessons-site URL the server did not mark eligible.
        (OpenedMaterial(kind: 'activity_link', mode: 'link', presentation: MaterialPresentation.frameSite, url: 'https://lessons.example.test/lessons/quran/surah-78'), 'https://lessons.example.test'),
        // An allowlisted third-party frame: the server does not mark it eligible.
        (OpenedMaterial(kind: 'activity_link', mode: 'link', presentation: MaterialPresentation.frameSite, url: 'https://activities.example.test/lessons/quran/surah-78'), 'https://lessons.example.test'),
        // Marked eligible, but not on this build's lessons origin.
        (OpenedMaterial(kind: 'activity_link', mode: 'link', presentation: MaterialPresentation.frameSite, url: 'https://activities.example.test/lessons/quran/surah-78', audioEligible: true), 'https://lessons.example.test'),
        // No lessons origin configured at all.
        (OpenedMaterial(kind: 'activity_link', mode: 'link', presentation: MaterialPresentation.frameSite, url: 'https://lessons.example.test/lessons/quran/surah-78', audioEligible: true), ''),
      ]) {
        final materials = _Materials()
          ..items = [game]
          ..openAs = opened;
        final activity = _Activity();
        await tester.pumpWidget(app(const ChildMaterialsScreen(learnerId: 'k1'), materials: materials, activity: activity, lessonsOrigin: origin));
        await tester.pumpAndSettle();
        await tester.tap(find.text('An-Naba game'));
        await tester.pumpAndSettle();
        expect(materials.lessonAudioAsked, isEmpty);
        expect(activity.audios, isNotEmpty);
        expect(activity.audios, everyElement(isNull));
      }
    });

    testWidgets('a lesson of the lessons site is framed keeping its own origin, pinned to its host', (tester) async {
      final materials = _Materials()
        ..items = [game]
        ..openAs = const OpenedMaterial(kind: 'activity_link', mode: 'link', presentation: MaterialPresentation.frameSite, url: 'https://lessons.example.test/lessons/quran/surah-78');
      final activity = _Activity();
      await tester.pumpWidget(app(const ChildMaterialsScreen(learnerId: 'k1'), materials: materials, activity: activity));
      await tester.pumpAndSettle();
      await tester.tap(find.text('An-Naba game'));
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
        ..items = [game]
        ..openAs = const OpenedMaterial(kind: 'activity_link', mode: 'link', presentation: MaterialPresentation.browser, url: 'https://elsewhere.example.test/game');
      final activity = _Activity();
      final opener = _Opener();
      await tester.pumpWidget(app(const ChildMaterialsScreen(learnerId: 'k1'), materials: materials, activity: activity, opener: opener));
      await tester.pumpAndSettle();
      await tester.tap(find.text('An-Naba game'));
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
      expect(find.text('ما فُتح هذا الأسبوع'), findsOneWidget);
      expect(find.text('خريطة الحفظ'), findsNothing);
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

  group('Opened this week', () {
    testWidgets('lists each item once, last opened first, a retired one shown but not playable; no memorization map', (tester) async {
      final materials = _Materials()
        ..week = OpenedThisWeek(weekStartsAt: DateTime.utc(2026, 10, 23, 21), items: [
          OpenedItem(item: song, available: true, lastOpenedAt: DateTime(2026, 10, 26, 18, 5), times: 3),
          OpenedItem(item: game, available: false, lastOpenedAt: DateTime(2026, 10, 24, 9), times: 1),
        ]);
      await tester.pumpWidget(app(const ChildMaterialsScreen(learnerId: 'k1'), materials: materials));
      await tester.pumpAndSettle();
      // Two tabs only: the map is gone.
      expect(find.byType(Tab), findsNWidgets(2));
      expect(find.text('Memorization map'), findsNothing);
      expect(find.text('Practice this week'), findsNothing);
      await tester.tap(find.byKey(const ValueKey('materials-tab-opened')));
      await tester.pumpAndSettle();

      expect(materials.openedAsked, ['k1']);
      expect(find.text('The week runs Saturday to Friday, academy time.'), findsOneWidget);
      final songTop = tester.getTopLeft(find.text('Letters song'));
      final gameTop = tester.getTopLeft(find.text('An-Naba game'));
      expect(songTop.dy, lessThan(gameTop.dy), reason: 'most recent first, as the server sent it');
      expect(find.textContaining('Last opened'), findsOneWidget);
      expect(find.text('This item is no longer in the library.'), findsOneWidget);
      expect(tester.widget<ListTile>(find.byKey(const ValueKey('material-m-1'))).enabled, isFalse);

      // Opening again from here is recorded for the child too, and the list refreshes.
      await tester.tap(find.text('Letters song'));
      await tester.pumpAndSettle();
      expect(materials.opens.single, (itemId: 'm-2', learnerId: 'k1'));
      await tester.pageBack();
      await tester.pumpAndSettle();
      expect(materials.openedAsked.length, greaterThan(1));
    });

    testWidgets('an empty week says so', (tester) async {
      await tester.pumpWidget(app(const ChildMaterialsScreen(learnerId: 'k1', initialTab: 1), materials: _Materials()));
      await tester.pumpAndSettle();
      expect(find.text('Nothing opened yet this week'), findsOneWidget);
    });
  });

  group('the lesson report', () {
    const ticket = LessonTicket(kind: LessonTicketKind.report, lessonId: 'les-1', learnerId: 'k1', learnerName: 'Sara');

    testWidgets('sends the practice the teacher chose, and offers no memorization section', (tester) async {
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
      // The memorization map left the product: no section, no surah statuses.
      expect(find.byKey(const ValueKey('mark-add')), findsNothing);
      expect(find.text('Memorization map'), findsNothing);

      await tester.ensureVisible(find.byKey(const ValueKey('report-submit')));
      await tester.tap(find.byKey(const ValueKey('report-submit')));
      await tester.pumpAndSettle();
      final sent = lessons.reported.single.toJson();
      expect(sent['practice'], [
        {'surah': 67, 'ayahFrom': 1, 'ayahTo': 10},
        {'itemId': 'm-1'},
      ]);
      expect(sent.containsKey('memorization'), isFalse);
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
    // Same host, another port: another origin, refused.
    expect(allow(Uri.parse('https://h5p.example.test:8443/content/1')), isFalse);
  });
}

class _Activity implements ActivityViewFactory {
  final urls = <String>[];
  final sandboxes = <String>[];
  final allows = <bool Function(Uri)>[];
  final audios = <Future<Map<String, Object?>?>?>[];

  @override
  Widget build(BuildContext context,
      {required String url, required String sandbox, required bool Function(Uri uri) allow, Future<Map<String, Object?>?>? audio}) {
    urls.add(url);
    sandboxes.add(sandbox);
    allows.add(allow);
    audios.add(audio);
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
  OpenedThisWeek week = OpenedThisWeek(weekStartsAt: DateTime.utc(2026, 10, 23, 21), items: const []);
  final libraryCalls = <({String? subject, String? ageGroup})>[];
  final opens = <({String itemId, String? learnerId})>[];
  final openedAsked = <String>[];

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
  Future<OpenedThisWeek> opened(String learnerId) async {
    openedAsked.add(learnerId);
    return week;
  }

  OpenedMaterial openAs = const OpenedMaterial(kind: 'activity_package', mode: 'package', presentation: MaterialPresentation.frameIsolated, url: playUrl);

  @override
  Future<OpenedMaterial> open(String itemId, {String? learnerId}) async {
    opens.add((itemId: itemId, learnerId: learnerId));
    return openAs;
  }

  @override
  Future<String> recitation(int surah) async => 'https://audio.example.test/$surah.mp3';

  final lessonAudioAsked = <int>[];
  Map<String, Object?>? lessonAudioAnswer;

  @override
  Future<Map<String, Object?>?> lessonAudio(int surah) async {
    lessonAudioAsked.add(surah);
    return lessonAudioAnswer;
  }

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
