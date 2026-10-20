import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/data/fake_repositories.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/media/media_picker.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/design/widgets/jawwid_avatar.dart';
import 'package:jawwid_chat/features/profile/data/profile_photo_repository.dart';
import 'package:jawwid_chat/features/profile/presentation/my_profile_screen.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/message.dart';
import 'package:jawwid_chat/shared/models/parent_profile.dart';

/// The parent's own editable profile.
///
/// What is worth testing is not that a field saves — it is that every way this can mislead
/// a parent is closed:
///
///  * a save that failed must not look like it worked;
///  * editing one child must never land on a sibling;
///  * a cancelled picker must say nothing at all; and
///  * a parent with nothing written must be told so, rather than shown a blank.
void main() {
  const image = PendingAttachment(
    filePath: '/tmp/photo.jpg',
    kind: MessageKind.image,
    mimeType: 'image/jpeg',
    byteSize: 1024,
    fileName: 'photo.jpg',
  );

  Widget harness({
    required ProfileRepository repository,
    MediaPicker? picker,
    ThemeData? theme,
    Locale locale = const Locale('en'),
    _Photos? photos,
  }) {
    final writer = photos ?? _Photos();
    return ProviderScope(
      overrides: [
        profileRepositoryProvider.overrideWithValue(_WithPhotos(repository, writer)),
        // The photos' one writer, /me/avatar -- shared with My account.
        profilePhotoRepositoryProvider.overrideWithValue(writer),
        mediaPickerProvider.overrideWithValue(picker ?? _Picker(image)),
      ],
      child: MaterialApp(
        locale: locale,
        theme: theme ?? JawwidTheme.light(isArabic: locale.languageCode == 'ar'),
        supportedLocales: JawwidApp.supportedLocales,
        localizationsDelegates: const [
          L10n.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        home: const MyProfileScreen(),
      ),
    );
  }

  Future<L10n> strings() => L10n.delegate.load(const Locale('en'));

  /// Tap a widget after scrolling it into view.
  ///
  /// `enterText` works on an off-screen field but `tap` does not — it hit-tests, so a target
  /// below the fold is silently missed and the test then fails on an unchanged value rather
  /// than on the tap. With three cards in the default viewport that is the normal case here.
  Future<void> tapVisible(WidgetTester tester, Finder finder) async {
    await tester.ensureVisible(finder);
    await tester.pumpAndSettle();
    await tester.tap(finder);
    await tester.pumpAndSettle();
  }

  /// The Edit button on the card whose title is [name].
  ///
  /// Scrolled into view first: with three cards in the default test viewport the last one
  /// sits below the fold, and tapping an off-screen target is how a test ends up exercising
  /// the wrong card.
  Future<void> openEditorFor(WidgetTester tester, String name) async {
    final card = find.ancestor(
      of: find.text(name),
      matching: find.byType(Card),
    );
    expect(card, findsOneWidget, reason: 'expected a card for $name');
    final edit = find.descendant(of: card, matching: find.byType(TextButton)).first;
    await tester.ensureVisible(edit);
    await tester.pumpAndSettle();
    await tester.tap(edit);
    await tester.pumpAndSettle();
  }

  // -------------------------------------------------------------------------
  group('it renders what the server said', () {
    testWidgets('the parent and every child get their own card', (tester) async {
      await tester.pumpWidget(harness(repository: FakeProfileRepository()));
      await tester.pumpAndSettle();

      expect(find.text('ولي أمر'), findsOneWidget);
      expect(find.text('أحمد'), findsOneWidget);
      expect(find.text('يوسف'), findsOneWidget);
      // One card per subject: the parent plus two children.
      expect(find.byType(Card), findsNWidgets(3));
    });

    testWidgets('an empty About says so rather than leaving a blank', (tester) async {
      await tester.pumpWidget(harness(repository: FakeProfileRepository()));
      await tester.pumpAndSettle();

      final l10n = await strings();
      expect(find.text(l10n.profileAboutEmpty), findsNWidgets(3));
    });

    testWidgets('a written About is shown', (tester) async {
      await tester.pumpWidget(harness(
        repository: FakeProfileRepository(
          initial: const ParentProfile(
            displayName: 'Parent',
            about: 'Mother of two.',
            children: [ChildProfile(id: 'c1', displayName: 'Kid', about: 'Loves maths.')],
          ),
        ),
      ));
      await tester.pumpAndSettle();

      expect(find.text('Mother of two.'), findsOneWidget);
      expect(find.text('Loves maths.'), findsOneWidget);
    });

    testWidgets('a parent with no photo gets initials, not an empty circle', (tester) async {
      await tester.pumpWidget(harness(repository: FakeProfileRepository()));
      await tester.pumpAndSettle();

      final avatars = tester.widgetList<JawwidAvatar>(find.byType(JawwidAvatar));
      expect(avatars, isNotEmpty);
      for (final avatar in avatars) {
        expect(avatar.imageUrl, isNull);
      }
    });

    testWidgets('no contact file is rendered, because there is none', (tester) async {
      await tester.pumpWidget(harness(repository: FakeProfileRepository()));
      await tester.pumpAndSettle();

      // The model carries no phone and this screen must never acquire one by accident.
      expect(find.textContaining('+'), findsNothing);
      expect(find.textContaining('phone', findRichText: true), findsNothing);
    });

    testWidgets('a failed load offers a retry rather than an empty screen', (tester) async {
      await tester.pumpWidget(harness(
        repository: FakeProfileRepository(loadError: const AppError(AppErrorKind.network)),
      ));
      await tester.pumpAndSettle();

      final l10n = await strings();
      expect(find.text(l10n.profileLoadFailed), findsOneWidget);
      expect(find.text(l10n.storyVideoRetry), findsOneWidget);
    });

    testWidgets('while unknown it shows a loader, not a guess', (tester) async {
      await tester.pumpWidget(harness(repository: _NeverRepository()));
      await tester.pump();

      expect(find.byType(Card), findsNothing);
      expect(tester.takeException(), isNull);
    });
  });

  // -------------------------------------------------------------------------
  group('editing the parent', () {
    testWidgets('saves a new name and About, and shows the result', (tester) async {
      final repo = FakeProfileRepository();
      await tester.pumpWidget(harness(repository: repo));
      await tester.pumpAndSettle();

      final l10n = await strings();
      await openEditorFor(tester, 'ولي أمر');

      await tester.enterText(find.byType(TextFormField).first, 'أم أحمد');
      await tester.enterText(find.byType(TextFormField).last, 'نبذة قصيرة');
      await tapVisible(tester, find.text(l10n.profileSave));

      // The screen shows what the server stored, not what was typed.
      expect(find.text('أم أحمد'), findsOneWidget);
      expect(find.text('نبذة قصيرة'), findsOneWidget);
      final saved = await repo.me();
      expect(saved.displayName, 'أم أحمد');
      expect(saved.about, 'نبذة قصيرة');
    });

    testWidgets('refuses an empty name locally, and saves nothing', (tester) async {
      final repo = FakeProfileRepository();
      await tester.pumpWidget(harness(repository: repo));
      await tester.pumpAndSettle();

      final l10n = await strings();
      await openEditorFor(tester, 'ولي أمر');
      await tester.enterText(find.byType(TextFormField).first, '   ');
      await tapVisible(tester, find.text(l10n.profileSave));

      expect(find.text(l10n.profileNameEmptyError), findsOneWidget);
      // Still in the editor, and the stored name is untouched.
      expect(find.text(l10n.profileSave), findsOneWidget);
      expect((await repo.me()).displayName, 'ولي أمر');
    });

    testWidgets('clearing the About stores a cleared value, not an empty string',
        (tester) async {
      final repo = FakeProfileRepository(
        initial: const ParentProfile(
          displayName: 'Parent',
          about: 'Something',
          children: [],
        ),
      );
      await tester.pumpWidget(harness(repository: repo));
      await tester.pumpAndSettle();

      final l10n = await strings();
      await openEditorFor(tester, 'Parent');
      await tester.enterText(find.byType(TextFormField).last, '');
      await tapVisible(tester, find.text(l10n.profileSave));

      expect((await repo.me()).about, isNull);
      expect(find.text(l10n.profileAboutEmpty), findsOneWidget);
    });

    testWidgets('a failed save SAYS SO and keeps the old values on screen', (tester) async {
      await tester.pumpWidget(harness(
        repository: FakeProfileRepository(
          mutationError: const AppError(AppErrorKind.network),
        ),
      ));
      await tester.pumpAndSettle();

      final l10n = await strings();
      await openEditorFor(tester, 'ولي أمر');
      await tester.enterText(find.byType(TextFormField).first, 'Changed');
      await tapVisible(tester, find.text(l10n.profileSave));

      expect(find.text(l10n.profileSaveFailed), findsOneWidget);
      // The profile the parent was looking at is still there -- a failed save must not
      // look like a successful one.
      expect(find.text('ولي أمر'), findsOneWidget);
    });

    testWidgets('cancel abandons the edit without saving', (tester) async {
      final repo = FakeProfileRepository();
      await tester.pumpWidget(harness(repository: repo));
      await tester.pumpAndSettle();

      final l10n = await strings();
      await openEditorFor(tester, 'ولي أمر');
      await tester.enterText(find.byType(TextFormField).first, 'Discarded');
      await tapVisible(tester, find.text(l10n.profileCancel));

      expect((await repo.me()).displayName, 'ولي أمر');
      expect(find.text('Discarded'), findsNothing);
    });
  });

  // -------------------------------------------------------------------------
  group('editing a child', () {
    testWidgets('saves that child\'s name and About', (tester) async {
      final repo = FakeProfileRepository();
      await tester.pumpWidget(harness(repository: repo));
      await tester.pumpAndSettle();

      final l10n = await strings();
      await openEditorFor(tester, 'أحمد');
      await tester.enterText(find.byType(TextFormField).first, 'أحمد علي');
      await tester.enterText(find.byType(TextFormField).last, 'يحب الرياضيات');
      await tapVisible(tester, find.text(l10n.profileSave));

      final saved = await repo.me();
      final child = saved.children.firstWhere((c) => c.id == 'learner-1');
      expect(child.displayName, 'أحمد علي');
      expect(child.about, 'يحب الرياضيات');
    });

    testWidgets('EDITING ONE CHILD DOES NOT TOUCH A SIBLING', (tester) async {
      // The worst bug this screen could have: a parent believing they edited one child
      // while the save landed on another.
      final repo = FakeProfileRepository();
      await tester.pumpWidget(harness(repository: repo));
      await tester.pumpAndSettle();

      final l10n = await strings();
      await openEditorFor(tester, 'يوسف');
      await tester.enterText(find.byType(TextFormField).first, 'يوسف حسن');
      await tapVisible(tester, find.text(l10n.profileSave));

      final saved = await repo.me();
      expect(saved.children.firstWhere((c) => c.id == 'learner-2').displayName, 'يوسف حسن');
      // The sibling, and the parent, are exactly as they were.
      expect(saved.children.firstWhere((c) => c.id == 'learner-1').displayName, 'أحمد');
      expect(saved.displayName, 'ولي أمر');
    });

    testWidgets('a failed child save says so and keeps the child on screen', (tester) async {
      await tester.pumpWidget(harness(
        repository: FakeProfileRepository(
          mutationError: const AppError(AppErrorKind.network),
        ),
      ));
      await tester.pumpAndSettle();

      final l10n = await strings();
      await openEditorFor(tester, 'أحمد');
      await tester.enterText(find.byType(TextFormField).first, 'Changed');
      await tapVisible(tester, find.text(l10n.profileSave));

      expect(find.text(l10n.profileSaveFailed), findsOneWidget);
      expect(find.text('أحمد'), findsOneWidget);
    });
  });

  // -------------------------------------------------------------------------
  group('photos', () {
    /// Tap the avatar on the card for [name]. The avatar IS the control.
    Future<void> tapPhoto(WidgetTester tester, String name) async {
      final card = find.ancestor(of: find.text(name), matching: find.byType(Card));
      await tapVisible(
        tester,
        find.descendant(of: card, matching: find.byType(InkWell)).first,
      );
    }

    testWidgets('adding the parent\'s photo sets the account photo and shows it', (tester) async {
      final photos = _Photos();
      await tester.pumpWidget(harness(repository: FakeProfileRepository(), photos: photos));
      await tester.pumpAndSettle();

      final l10n = await strings();
      await tapPhoto(tester, 'ولي أمر');
      await tapVisible(tester, find.text(l10n.profilePhotoAdd));

      expect(photos.sets, [null], reason: "the parent's own, through /me/avatar");
      final avatar = tester.widget<JawwidAvatar>(find.byWidgetPredicate(
        (w) => w is JawwidAvatar && w.displayName == 'ولي أمر',
      ));
      expect(avatar.imageUrl, isNotNull);
    });

    testWidgets('removing it returns to the initials fallback', (tester) async {
      final photos = _Photos()..urls[null] = 'https://fake.test/a.jpg';
      await tester.pumpWidget(harness(
        repository: FakeProfileRepository(
          initial: const ParentProfile(displayName: 'Parent', children: []),
        ),
        photos: photos,
      ));
      await tester.pumpAndSettle();

      final l10n = await strings();
      await tapPhoto(tester, 'Parent');
      await tapVisible(tester, find.text(l10n.profilePhotoRemove));

      expect(photos.removes, [null]);
      final avatar = tester.widget<JawwidAvatar>(find.byWidgetPredicate(
        (w) => w is JawwidAvatar && w.displayName == 'Parent',
      ));
      expect(avatar.imageUrl, isNull);
    });

    testWidgets('a child\'s photo is set on THAT child only', (tester) async {
      final photos = _Photos();
      await tester.pumpWidget(harness(repository: FakeProfileRepository(), photos: photos));
      await tester.pumpAndSettle();

      final l10n = await strings();
      await tapPhoto(tester, 'أحمد');
      await tapVisible(tester, find.text(l10n.profilePhotoAdd));

      // Through /me/children/learner-1/avatar, and nobody else's.
      expect(photos.sets, ['learner-1']);
      final shown = tester.widgetList<JawwidAvatar>(find.byType(JawwidAvatar)).toList();
      expect(shown.firstWhere((a) => a.displayName == 'أحمد').imageUrl, isNotNull);
      expect(shown.firstWhere((a) => a.displayName == 'يوسف').imageUrl, isNull);
      expect(shown.firstWhere((a) => a.displayName == 'ولي أمر').imageUrl, isNull);
    });

    testWidgets('cancelling the picker changes nothing and says nothing', (tester) async {
      final photos = _Photos();
      await tester.pumpWidget(harness(
        repository: FakeProfileRepository(),
        picker: _Picker(null), // the parent backed out
        photos: photos,
      ));
      await tester.pumpAndSettle();

      final l10n = await strings();
      await tapPhoto(tester, 'ولي أمر');
      await tapVisible(tester, find.text(l10n.profilePhotoAdd));

      expect(photos.sets, isEmpty);
      expect(find.byType(SnackBar), findsNothing);
    });

    testWidgets('a failed upload says so and does not show a photo', (tester) async {
      final photos = _Photos()..error = const AppError(AppErrorKind.network);
      await tester.pumpWidget(harness(repository: FakeProfileRepository(), photos: photos));
      await tester.pumpAndSettle();

      final l10n = await strings();
      await tapPhoto(tester, 'ولي أمر');
      await tapVisible(tester, find.text(l10n.profilePhotoAdd));

      expect(find.text(l10n.profilePhotoFailed), findsOneWidget);
      final avatar = tester.widget<JawwidAvatar>(find.byWidgetPredicate(
        (w) => w is JawwidAvatar && w.displayName == 'ولي أمر',
      ));
      expect(avatar.imageUrl, isNull);
    });

    testWidgets('a parent with no photo is offered Add, not Remove', (tester) async {
      await tester.pumpWidget(harness(repository: FakeProfileRepository()));
      await tester.pumpAndSettle();

      final l10n = await strings();
      await tapPhoto(tester, 'ولي أمر');

      expect(find.text(l10n.profilePhotoAdd), findsOneWidget);
      // Nothing to remove, so the control is absent rather than present and broken.
      expect(find.text(l10n.profilePhotoRemove), findsNothing);
    });
  });

  // -------------------------------------------------------------------------
  group('direction, theme and awkward content', () {
    for (final (label, theme) in [
      ('light', JawwidTheme.light(isArabic: false)),
      ('dark', JawwidTheme.dark(isArabic: false)),
    ]) {
      testWidgets('$label renders without exception', (tester) async {
        await tester.pumpWidget(
          harness(repository: FakeProfileRepository(), theme: theme),
        );
        await tester.pumpAndSettle();

        expect(tester.takeException(), isNull);
        expect(find.byType(Card), findsNWidgets(3));
      });
    }

    testWidgets('Arabic lays the screen out right-to-left', (tester) async {
      await tester.pumpWidget(harness(
        repository: FakeProfileRepository(),
        locale: const Locale('ar'),
      ));
      await tester.pumpAndSettle();

      expect(
        Directionality.of(tester.element(find.byType(Card).first)),
        TextDirection.rtl,
      );
    });

    testWidgets('a very long name and a very long About do not overflow', (tester) async {
      await tester.pumpWidget(harness(
        repository: FakeProfileRepository(
          initial: ParentProfile(
            displayName: 'عبد الرحمن ' * 12,
            about: 'نص طويل جدًا. ' * 40,
            children: [
              ChildProfile(
                id: 'c',
                displayName: 'Abdulrahman ' * 10,
                about: 'A very long about. ' * 30,
              ),
            ],
          ),
        ),
      ));
      await tester.pumpAndSettle();

      // An overflow paints a yellow-and-black band and throws in a test.
      expect(tester.takeException(), isNull);
    });

    testWidgets('nothing on this screen scrolls sideways', (tester) async {
      await tester.pumpWidget(harness(repository: FakeProfileRepository()));
      await tester.pumpAndSettle();

      for (final scrollable in tester.widgetList<Scrollable>(find.byType(Scrollable))) {
        expect(scrollable.axisDirection, isNot(AxisDirection.right));
        expect(scrollable.axisDirection, isNot(AxisDirection.left));
      }
    });
  });
}

/// Hands back one image, or null for a parent who backed out.
class _Picker implements MediaPicker {
  _Picker(this._image);

  final PendingAttachment? _image;

  @override
  Future<PendingAttachment?> pickImage() async => _image;

  @override
  Future<PendingAttachment?> captureImage() async => _image;

  @override
  Future<PendingAttachment?> pickFile() async => _image;

  @override
  dynamic noSuchMethod(Invocation invocation) => null;
}

/// The account-photo writer (`/me/avatar`, `/me/children/:id/avatar`), standing in for the
/// server: what it holds is what `GET /me/profile` then reports. Keyed by child id, `null`
/// for the parent; a subject it was never told about keeps whatever the profile said.
class _Photos implements ProfilePhotoRepository {
  final Map<String?, String?> urls = {};
  final List<String?> sets = [];
  final List<String?> removes = [];
  Object? error;

  @override
  bool get isAvailable => true;

  @override
  Future<MyPhotos> mine() async => MyPhotos(avatarUrl: urls[null]);

  @override
  Future<String?> set(PendingAttachment photo, {String? childId}) async {
    sets.add(childId);
    if (error != null) throw error!;
    return urls[childId] = 'https://fake.test/${childId ?? 'me'}/${photo.fileName}';
  }

  @override
  Future<void> remove({String? childId}) async {
    removes.add(childId);
    if (error != null) throw error!;
    urls[childId] = null;
  }
}

/// The profile as the server would answer once [_Photos] has written.
class _WithPhotos implements ProfileRepository {
  _WithPhotos(this._inner, this._photos);

  final ProfileRepository _inner;
  final _Photos _photos;

  ParentProfile _overlay(ParentProfile p) => ParentProfile(
        displayName: p.displayName,
        relationship: p.relationship,
        signInIdentity: p.signInIdentity,
        about: p.about,
        avatarUrl: _photos.urls.containsKey(null) ? _photos.urls[null] : p.avatarUrl,
        canMessage: p.canMessage,
        children: [
          for (final c in p.children)
            ChildProfile(
              id: c.id,
              displayName: c.displayName,
              level: c.level,
              about: c.about,
              avatarUrl: _photos.urls.containsKey(c.id) ? _photos.urls[c.id] : c.avatarUrl,
            ),
        ],
      );

  @override
  Future<ParentProfile> me() async => _overlay(await _inner.me());

  @override
  Future<ParentProfile> updateMe({String? name, String? about}) async =>
      _overlay(await _inner.updateMe(name: name, about: about));

  @override
  Future<ParentProfile> updateChild(String childId, {String? name, String? about}) async =>
      _overlay(await _inner.updateChild(childId, name: name, about: about));
}

/// Never answers, so the loading state is observable.
class _NeverRepository implements ProfileRepository {
  @override
  Future<ParentProfile> me() => Completer<ParentProfile>().future;

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnimplementedError('${invocation.memberName} is not used by this test');
}
