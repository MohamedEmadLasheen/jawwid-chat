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
import 'package:jawwid_chat/features/profile/presentation/parent_account_view.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/message.dart';
import 'package:jawwid_chat/shared/models/parent_profile.dart';


/// The parent's own account screen.
///
/// What is worth testing here is not that a photo appears — it is that every way the photo
/// flow can go wrong leaves the screen honest: a cancelled picker says nothing, a failed
/// upload says so and keeps the profile that was already on screen, and a removal that
/// fails does not blank the avatar as though it had worked.
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
  }) {
    return ProviderScope(
      overrides: [
        profileRepositoryProvider.overrideWithValue(repository),
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
        // The two widgets as the account screen composes them. The screen's own
        // composition — and the children section it owns — is covered by
        // profile_screen_test.dart, which must keep passing unchanged.
        home: Scaffold(
          body: ListView(
            children: const [
              EditableProfilePhoto(),
              ChildPhotoAvatar(learnerId: 'learner-1', displayName: 'أحمد'),
              ChildPhotoAvatar(learnerId: 'learner-2', displayName: 'مريم'),
            ],
          ),
        ),
      ),
    );
  }

  /// The camera badge on the CHILD avatars only — the header carries one as well now.
  Finder childBadges() => find.descendant(
        of: find.byType(ChildPhotoAvatar),
        matching: find.byIcon(Icons.photo_camera_rounded),
      );

  JawwidAvatar avatarNamed(WidgetTester tester, String name) =>
      tester.widget<JawwidAvatar>(find.byWidgetPredicate(
        (w) => w is JawwidAvatar && w.displayName == name,
      ));

  // -------------------------------------------------------------------------
  group('it renders what the server said', () {
    testWidgets('the parent, their sign-in identity, and a control per child',
        (tester) async {
      await tester.pumpWidget(harness(repository: FakeProfileRepository()));
      await tester.pumpAndSettle();

      expect(find.text('ولي أمر'), findsWidgets);
      expect(find.text('qa.parent@qa.jawwid.test'), findsOneWidget);
      // Two children are described by the profile, so both get a photo control. Their
      // NAMES belong to the account screen's own children section, not to this widget.
      expect(childBadges(), findsNWidgets(2));
    });

    testWidgets('a parent with no photo gets the initials fallback, not an empty circle',
        (tester) async {
      await tester.pumpWidget(harness(repository: FakeProfileRepository()));
      await tester.pumpAndSettle();

      expect(avatarNamed(tester, 'ولي أمر').imageUrl, isNull);
      expect(find.byType(JawwidAvatar), findsWidgets);
    });

    testWidgets('no contact file is rendered, because there is none', (tester) async {
      await tester.pumpWidget(harness(repository: FakeProfileRepository()));
      await tester.pumpAndSettle();

      // The model carries no phone and the screen must never acquire one by accident.
      expect(find.textContaining('+'), findsNothing);
      expect(find.textContaining('phone', findRichText: true), findsNothing);
    });

    testWidgets('a child the profile does not describe gets no control, not a broken one',
        (tester) async {
      await tester.pumpWidget(harness(
        repository: FakeProfileRepository(
          initial: const ParentProfile(displayName: 'Parent', children: []),
        ),
      ));
      await tester.pumpAndSettle();

      // The account screen can list a child the profile endpoint did not return. The row
      // still shows their avatar; what it must not show is a control that could only
      // fail, so the camera badge is absent.
      expect(childBadges(), findsNothing);
      expect(find.byType(JawwidAvatar), findsWidgets);
    });
  });

  // -------------------------------------------------------------------------
  group('while the profile is still unknown', () {
    testWidgets('the photo controls stay out of the way rather than guessing',
        (tester) async {
      // Loading and error states belong to the account screen that hosts these widgets
      // (covered in profile_screen_test.dart). What matters here is that neither widget
      // invents an avatar or an affordance before the server has said anything.
      await tester.pumpWidget(harness(repository: _NeverRepository()));
      await tester.pump();

      // The header stays out of the way entirely; the child rows still show the fallback
      // initials they already know, but offer no control until the server has answered.
      expect(find.byIcon(Icons.photo_camera_rounded), findsNothing);
      expect(tester.takeException(), isNull);
    });
  });

  // -------------------------------------------------------------------------
  group('the photo flow', () {
    Future<void> openSheet(WidgetTester tester, String label) async {
      await tester.tap(find.text(label));
      await tester.pumpAndSettle();
    }

    testWidgets('adding a photo shows it immediately', (tester) async {
      final repo = FakeProfileRepository();
      await tester.pumpWidget(harness(repository: repo));
      await tester.pumpAndSettle();

      final l10n = await L10n.delegate.load(const Locale('en'));
      await openSheet(tester, l10n.profilePhotoAdd);
      await tester.tap(find.text(l10n.profilePhotoAdd).last);
      await tester.pumpAndSettle();

      expect(avatarNamed(tester, 'ولي أمر').imageUrl, isNotNull);
      // The action now offers to CHANGE it, not to add one.
      expect(find.text(l10n.profilePhotoChange), findsOneWidget);
    });

    testWidgets('removing it returns to the fallback', (tester) async {
      final repo = FakeProfileRepository(
        initial: const ParentProfile(
          displayName: 'Parent',
          avatarUrl: 'https://fake.test/a.jpg',
          children: [],
        ),
      );
      await tester.pumpWidget(harness(repository: repo));
      await tester.pumpAndSettle();

      final l10n = await L10n.delegate.load(const Locale('en'));
      await openSheet(tester, l10n.profilePhotoChange);
      await tester.tap(find.text(l10n.profilePhotoRemove));
      await tester.pumpAndSettle();

      expect(avatarNamed(tester, 'Parent').imageUrl, isNull);
    });

    testWidgets('cancelling the picker changes nothing and says nothing', (tester) async {
      await tester.pumpWidget(harness(
        repository: FakeProfileRepository(),
        picker: _Picker(null), // the user backed out
      ));
      await tester.pumpAndSettle();

      final l10n = await L10n.delegate.load(const Locale('en'));
      await openSheet(tester, l10n.profilePhotoAdd);
      await tester.tap(find.text(l10n.profilePhotoAdd).last);
      await tester.pumpAndSettle();

      expect(avatarNamed(tester, 'ولي أمر').imageUrl, isNull);
      expect(find.byType(SnackBar), findsNothing);
    });

    testWidgets('a failed upload says so AND keeps the profile on screen', (tester) async {
      await tester.pumpWidget(harness(
        repository: FakeProfileRepository(
          mutationError: const AppError(AppErrorKind.network),
        ),
      ));
      await tester.pumpAndSettle();

      final l10n = await L10n.delegate.load(const Locale('en'));
      await openSheet(tester, l10n.profilePhotoAdd);
      await tester.tap(find.text(l10n.profilePhotoAdd).last);
      await tester.pumpAndSettle();

      expect(find.text(l10n.profilePhotoFailed), findsOneWidget);
      // The profile is still on screen and the avatar did not pretend to change.
      expect(find.text('ولي أمر'), findsWidgets);
      expect(avatarNamed(tester, 'ولي أمر').imageUrl, isNull);
    });

    testWidgets("a child's photo can be set from their own control", (tester) async {
      final repo = FakeProfileRepository();
      await tester.pumpWidget(harness(repository: repo));
      await tester.pumpAndSettle();

      // The avatar is the control; the badge only marks it. Target the ink surface
      // rather than the widget's centre: in this bare-list harness the widget is
      // full-width, so its centre is empty space beside the circle.
      await tester.tap(
        find.descendant(
          of: find.byType(ChildPhotoAvatar).first,
          matching: find.byType(InkWell),
        ),
      );
      await tester.pumpAndSettle();

      final l10n = await L10n.delegate.load(const Locale('en'));
      // `.last` is the sheet's entry: the header button carries the same words while the
      // parent themselves has no photo.
      await tester.tap(find.text(l10n.profilePhotoAdd).last);
      await tester.pumpAndSettle();

      // The repository recorded it against the right child, and only that child.
      final profile = await repo.me();
      expect(profile.children.firstWhere((c) => c.id == 'learner-1').avatarUrl, isNotNull);
      expect(profile.children.firstWhere((c) => c.id == 'learner-2').avatarUrl, isNull);
    });
  });

  // -------------------------------------------------------------------------
  /// The profile is dropped when the screen closes, and refetched when it reopens.
  ///
  /// This is not a caching preference -- it is a correctness requirement, because a
  /// `ParentProfile` carries SHORT-LIVED CREDENTIALS. Every `avatarUrl` in it is a signed
  /// URL valid for five minutes. Held for the life of the session, those URLs outlive what
  /// storage will honour, and the photos silently become initials.
  ///
  /// That was observed on a real device: a profile fetched at 19:54:30 was re-rendered at
  /// 20:04:47 and both the parent's and the child's avatar reads returned
  /// `403 Request has expired` -- 617 seconds against a 300-second TTL, from one cached
  /// instance, which is why the two failed together.
  ///
  /// Elapsed time cannot be simulated here, so the test pins the MECHANISM instead: the
  /// provider must be disposed when nothing is watching it and must fetch again on the
  /// next mount. A served cache would return a stale credential; a refetch re-signs.
  group('a reopened screen refetches rather than serving an expired credential', () {
    /// One container for the whole test, so the provider's lifetime is the thing under
    /// test and not an artefact of rebuilding the scope. `pumpWidget` replaces the widget
    /// TREE while `UncontrolledProviderScope` keeps the same container -- which is exactly
    /// "the user left the screen and came back" inside one app session.
    Widget scoped(ProviderContainer container, {required bool mounted}) {
      return UncontrolledProviderScope(
        container: container,
        child: MaterialApp(
          localizationsDelegates: const [
            L10n.delegate,
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
          home: Scaffold(
            body: mounted
                ? ListView(
                    children: const [
                      EditableProfilePhoto(),
                      ChildPhotoAvatar(learnerId: 'learner-1', displayName: 'أحمد'),
                    ],
                  )
                : const SizedBox.shrink(),
          ),
        ),
      );
    }

    testWidgets('mount, unmount, remount -> the profile is fetched TWICE', (tester) async {
      final repo = _CountingRepository();
      final container = ProviderContainer(
        overrides: [
          profileRepositoryProvider.overrideWithValue(repo),
          mediaPickerProvider.overrideWithValue(_Picker(image)),
        ],
      );
      addTearDown(container.dispose);

      await tester.pumpWidget(scoped(container, mounted: true));
      await tester.pumpAndSettle();
      expect(repo.meCalls, 1, reason: 'the first mount fetches the profile');

      // The screen closes. Nothing watches the provider any more.
      await tester.pumpWidget(scoped(container, mounted: false));
      await tester.pumpAndSettle();

      // ...and the user comes back to it.
      await tester.pumpWidget(scoped(container, mounted: true));
      await tester.pumpAndSettle();

      // THE ASSERTION. Under the keepAlive provider this stayed at 1: the cached profile
      // was served, signed URLs and all, however old they were.
      expect(repo.meCalls, 2,
          reason: 'reopening must refetch, so the avatar URLs are freshly signed');
    });

    testWidgets('staying on the screen does NOT refetch on every rebuild', (tester) async {
      // The other half of the contract: autoDispose must not turn into a request storm.
      // Disposal is driven by losing listeners, not by rebuilding.
      final repo = _CountingRepository();
      final container = ProviderContainer(
        overrides: [
          profileRepositoryProvider.overrideWithValue(repo),
          mediaPickerProvider.overrideWithValue(_Picker(image)),
        ],
      );
      addTearDown(container.dispose);

      await tester.pumpWidget(scoped(container, mounted: true));
      await tester.pumpAndSettle();
      expect(repo.meCalls, 1);

      for (var i = 0; i < 3; i++) {
        await tester.pump();
        await tester.pumpAndSettle();
      }

      expect(repo.meCalls, 1, reason: 'a mounted screen holds its profile');
    });

    testWidgets('the photo sheet does not dispose the profile mid-mutation', (tester) async {
      // The modal is the one thing that could make autoDispose unsafe here: if opening it
      // unmounted the host screen, the provider would be disposed while a photo upload was
      // in flight and the result would land on nothing. One fetch throughout, and the new
      // photo is on screen afterwards.
      final repo = _CountingRepository();
      final container = ProviderContainer(
        overrides: [
          profileRepositoryProvider.overrideWithValue(repo),
          mediaPickerProvider.overrideWithValue(_Picker(image)),
        ],
      );
      addTearDown(container.dispose);

      await tester.pumpWidget(scoped(container, mounted: true));
      await tester.pumpAndSettle();
      expect(repo.meCalls, 1);

      final l10n = await L10n.delegate.load(const Locale('en'));
      await tester.tap(find.text(l10n.profilePhotoAdd));
      await tester.pumpAndSettle();
      await tester.tap(find.text(l10n.profilePhotoAdd).last);
      await tester.pumpAndSettle();

      // The mutation completed against a live provider and the avatar is showing.
      expect(repo.meCalls, 1, reason: 'the sheet must not dispose and refetch the host');
      expect(avatarNamed(tester, 'ولي أمر').imageUrl, isNotNull);
    });
  });

  // -------------------------------------------------------------------------
  group('themes, direction and awkward content', () {
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
        expect(find.byType(EditableProfilePhoto), findsOneWidget);
      });
    }

    testWidgets('Arabic lays the screen out right-to-left', (tester) async {
      await tester.pumpWidget(harness(
        repository: FakeProfileRepository(),
        locale: const Locale('ar'),
      ));
      await tester.pumpAndSettle();

      expect(
        Directionality.of(tester.element(find.byType(EditableProfilePhoto))),
        TextDirection.rtl,
      );
    });

    testWidgets('a very long name and a very long sign-in do not overflow', (tester) async {
      await tester.pumpWidget(harness(
        repository: FakeProfileRepository(
          initial: ParentProfile(
            displayName: 'عبد الرحمن ' * 12,
            signInIdentity: '${'very.long.identity.' * 8}@qa.jawwid.test',
            children: [
              ChildProfile(id: 'c', displayName: 'Abdulrahman ' * 10),
            ],
          ),
        ),
      ));
      await tester.pumpAndSettle();

      // An overflow paints a yellow-and-black band and throws in a test.
      expect(tester.takeException(), isNull);
    });
  });
}

/// Hands back one image, or null for a user who backed out.
class _Picker implements MediaPicker {
  _Picker(this._image);

  final PendingAttachment? _image;

  @override
  Future<PendingAttachment?> pickImage() async => _image;

  @override
  Future<PendingAttachment?> pickFile() async => _image;

  @override
  dynamic noSuchMethod(Invocation invocation) => null;
}

/// Never answers, so the loading state is observable.
class _NeverRepository implements ProfileRepository {
  @override
  Future<ParentProfile> me() => Completer<ParentProfile>().future;

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnimplementedError('${invocation.memberName} is not used by this test');
}

/// Wraps the fake and counts `me()`, so a test can tell a REFETCH from a served cache.
class _CountingRepository implements ProfileRepository {
  _CountingRepository() : _inner = FakeProfileRepository();

  final ProfileRepository _inner;
  int meCalls = 0;

  @override
  Future<ParentProfile> me() {
    meCalls++;
    return _inner.me();
  }

  @override
  Future<ParentProfile> myAvatar() {
    // Counted with `me`: both are "fetch who I am", and the lifecycle test cares about the
    // fetch happening, not which route served it.
    meCalls++;
    return _inner.myAvatar();
  }

  @override
  Future<ParentProfile> setAvatar(PendingAttachment image) => _inner.setAvatar(image);

  @override
  Future<ParentProfile> removeAvatar() => _inner.removeAvatar();

  @override
  Future<ParentProfile> setChildAvatar(String childId, PendingAttachment image) =>
      _inner.setChildAvatar(childId, image);

  @override
  Future<ParentProfile> removeChildAvatar(String childId) =>
      _inner.removeChildAvatar(childId);
}
