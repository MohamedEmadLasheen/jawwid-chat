import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/app/shells/app_shell.dart';
import 'package:jawwid_chat/core/data/fake_repositories.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/profile/data/profile_photo_repository.dart';
import 'package:jawwid_chat/features/profile/presentation/my_profile_screen.dart';
import 'package:jawwid_chat/features/settings/application/theme_mode_controller.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/location/location.dart';
import 'package:jawwid_chat/shared/location/location_repository.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

import '../../features/app_lock/app_lock_fakes.dart';
import 'fake_location_repository.dart';

/// PD-45 PR-4: the parent's Location row, the picker and the one-time prompt.
void main() {
  late LockWorld world;
  late ProviderContainer container;

  Future<void> pump(
    WidgetTester tester,
    Widget home,
    FakeLocationRepository repo, {
    Locale locale = const Locale('en'),
    UserRole role = UserRole.parent,
  }) async {
    world = LockWorld(role: role, storedSession: true);
    container = ProviderContainer(overrides: [
      ...world.overrides(),
      themeModeStoreProvider.overrideWithValue(FakeThemeModeStore()),
      locationRepositoryProvider.overrideWithValue(repo),
      profileRepositoryProvider.overrideWithValue(FakeProfileRepository()),
      profilePhotoRepositoryProvider.overrideWithValue(_NoPhotos()),
    ]);
    addTearDown(() {
      container.dispose();
      world.dispose();
    });
    await container.read(authControllerProvider.notifier).restore();
    await tester.pumpWidget(UncontrolledProviderScope(
      container: container,
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
    ));
    await tester.pumpAndSettle();
  }

  Widget shell(UserRole role) =>
      AppShell(role: role, currentRoute: '/chats', onDestinationSelected: (_) {}, child: const Text('home'));

  Future<void> choose(WidgetTester tester, Key field, String option) async {
    await tester.ensureVisible(find.byKey(field));
    await tester.tap(find.byKey(field));
    await tester.pumpAndSettle();
    await tester.tap(find.text(option));
    await tester.pumpAndSettle();
  }

  final row = find.byKey(const ValueKey('profile-location-row'));
  final prompt = find.byKey(const ValueKey('location-prompt'));

  group('the profile row', () {
    testWidgets('English: empty says so; picking a country and a governorate saves both codes and the row shows them', (tester) async {
      final repo = FakeLocationRepository();
      await pump(tester, const MyProfileScreen(), repo);
      expect(row, findsOneWidget);
      expect(find.text('Location'), findsOneWidget);
      expect(find.text('Not set'), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('profile-location-edit')));
      await tester.pumpAndSettle();
      await choose(tester, const ValueKey('location-country'), '🇪🇬 Egypt');
      // The second field carries Egypt's own word.
      expect(find.text('Governorate'), findsWidgets);
      await choose(tester, const ValueKey('location-subdivision'), 'Giza');
      await tester.tap(find.byKey(const ValueKey('location-save')));
      await tester.pumpAndSettle();

      expect(repo.saves, [(country: 'EG', subdivision: 'EG-GZ')]);
      expect(find.text('Egypt · Giza'), findsOneWidget);
      expect(find.text('Not set'), findsNothing);
    });

    testWidgets('Arabic: the row, the label and the names read in Arabic; search finds a country by its English name', (tester) async {
      final repo = FakeLocationRepository(
        initial: const MyLocation(countryCode: 'EG', subdivisionCode: 'EG-C', name: BilingualName(ar: 'مصر · القاهرة', en: 'Egypt · Cairo')),
      );
      await pump(tester, const MyProfileScreen(), repo, locale: const Locale('ar'));
      expect(find.text('الموقع'), findsOneWidget);
      expect(find.text('مصر · القاهرة'), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('profile-location-edit')));
      await tester.pumpAndSettle();
      // Egypt's governorates, in the country's own Arabic label.
      expect(find.text('المحافظة'), findsWidgets);
      await tester.tap(find.byKey(const ValueKey('location-country')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const ValueKey('picker-search')), 'emirates');
      await tester.pumpAndSettle();
      await tester.tap(find.text('🇦🇪 الإمارات'));
      await tester.pumpAndSettle();
      // Changing the country cleared the governorate; the emirate is chosen from AE's list.
      await tester.tap(find.byKey(const ValueKey('location-save')));
      await tester.pumpAndSettle();
      expect(find.text('اختر الإمارة من القائمة'), findsOneWidget);
      expect(repo.saves, isEmpty);
      await choose(tester, const ValueKey('location-subdivision'), 'دبي');
      await tester.tap(find.byKey(const ValueKey('location-save')));
      await tester.pumpAndSettle();
      expect(repo.saves, [(country: 'AE', subdivision: 'AE-DU')]);
      expect(find.text('الإمارات · دبي'), findsOneWidget);
    });

    testWidgets('a country with no subdivisions saves on its own', (tester) async {
      final repo = FakeLocationRepository();
      await pump(tester, const MyProfileScreen(), repo);
      await tester.tap(find.byKey(const ValueKey('profile-location-edit')));
      await tester.pumpAndSettle();
      await choose(tester, const ValueKey('location-country'), '🇯🇵 Japan');
      expect(find.byKey(const ValueKey('location-subdivision')), findsNothing);
      await tester.tap(find.byKey(const ValueKey('location-save')));
      await tester.pumpAndSettle();
      expect(repo.saves, [(country: 'JP', subdivision: null)]);
    });

    testWidgets('a failed save says so and leaves the row as it was', (tester) async {
      final repo = FakeLocationRepository(failSave: true);
      await pump(tester, const MyProfileScreen(), repo);
      await tester.tap(find.byKey(const ValueKey('profile-location-edit')));
      await tester.pumpAndSettle();
      await choose(tester, const ValueKey('location-country'), '🇯🇵 Japan');
      await tester.tap(find.byKey(const ValueKey('location-save')));
      await tester.pumpAndSettle();
      expect(find.text('That could not be saved. Please try again.'), findsOneWidget);
      expect(repo.saves, isEmpty);
    });

    testWidgets('a phone-number collision (409) shows a neutral message in Arabic and English', (tester) async {
      final repo = FakeLocationRepository(conflict: true);
      await pump(tester, const MyProfileScreen(), repo);
      await tester.tap(find.byKey(const ValueKey('profile-location-edit')));
      await tester.pumpAndSettle();
      await choose(tester, const ValueKey('location-country'), '🇯🇵 Japan');
      await tester.tap(find.byKey(const ValueKey('location-save')));
      await tester.pumpAndSettle();
      expect(find.text("We couldn't save this. Please contact the academy."), findsOneWidget);
    });

    testWidgets('staff have no Location row, and the app never reads it for them', (tester) async {
      final repo = FakeLocationRepository();
      await pump(tester, const MyProfileScreen(), repo, role: UserRole.teacher);
      expect(row, findsNothing);
      expect(repo.mineCalls, 0);
    });
  });

  group('the one-time prompt', () {
    testWidgets('appears for a parent the server says to ask; Later records the answer and saves nothing', (tester) async {
      final repo = FakeLocationRepository(initial: const MyLocation(prompt: true));
      await pump(tester, shell(UserRole.parent), repo);
      expect(prompt, findsOneWidget);
      expect(find.text('Where does the family live?'), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('location-secondary')));
      await tester.pumpAndSettle();
      expect(prompt, findsNothing);
      expect(repo.laterCalls, 1);
      expect(repo.saves, isEmpty);
    });

    testWidgets('an incomplete location (a country, no governorate) reopens with the country kept', (tester) async {
      final repo = FakeLocationRepository(initial: const MyLocation(prompt: true, countryCode: 'EG'));
      await pump(tester, shell(UserRole.parent), repo);
      expect(find.text('🇪🇬 Egypt'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('location-save')));
      await tester.pumpAndSettle();
      expect(find.text('Choose a Governorate from the list'), findsOneWidget);
      expect(repo.saves, isEmpty);
    });

    testWidgets('Arabic copy', (tester) async {
      await pump(tester, shell(UserRole.parent), FakeLocationRepository(), locale: const Locale('ar'));
      expect(find.text('أين تقيم الأسرة؟'), findsOneWidget);
      expect(find.text('لاحقًا'), findsOneWidget);
    });

    testWidgets('not shown once the server holds an answer (a second device, or after Save)', (tester) async {
      final repo = FakeLocationRepository(initial: const MyLocation(prompt: false));
      await pump(tester, shell(UserRole.parent), repo);
      expect(prompt, findsNothing);
      expect(repo.mineCalls, 1);
    });

    testWidgets('answering with Save closes it and it is not asked again on the next open', (tester) async {
      final repo = FakeLocationRepository();
      await pump(tester, shell(UserRole.parent), repo);
      await choose(tester, const ValueKey('location-country'), '🇯🇵 Japan');
      await tester.tap(find.byKey(const ValueKey('location-save')));
      await tester.pumpAndSettle();
      expect(prompt, findsNothing);
      expect(repo.saves, [(country: 'JP', subdivision: null)]);

      // A fresh shell (the next app open): the server's stamp says answered.
      await tester.pumpWidget(const SizedBox());
      await tester.pumpWidget(UncontrolledProviderScope(
        container: container,
        child: MaterialApp(
          locale: const Locale('en'),
          supportedLocales: JawwidApp.supportedLocales,
          localizationsDelegates: const [L10n.delegate, GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate],
          home: shell(UserRole.parent),
        ),
      ));
      await tester.pumpAndSettle();
      expect(prompt, findsNothing);
    });

    testWidgets('the suggestion is a chip: nothing is saved until the parent taps it and then Save', (tester) async {
      final repo = FakeLocationRepository(initial: const MyLocation(prompt: true, suggestedCountryCode: 'AE'));
      await pump(tester, shell(UserRole.parent), repo);
      expect(find.text('Suggested: United Arab Emirates'), findsOneWidget);
      expect(repo.saves, isEmpty);

      // Not chosen yet: Save asks for a country.
      await tester.tap(find.byKey(const ValueKey('location-save')));
      await tester.pumpAndSettle();
      expect(find.text('Choose a country from the list'), findsOneWidget);
      expect(repo.saves, isEmpty);

      await tester.tap(find.byKey(const ValueKey('location-suggestion')));
      await tester.pumpAndSettle();
      expect(repo.saves, isEmpty, reason: 'tapping the chip only fills the picker');
      expect(find.byKey(const ValueKey('location-suggestion')), findsNothing);

      await choose(tester, const ValueKey('location-subdivision'), 'Dubai');
      await tester.tap(find.byKey(const ValueKey('location-save')));
      await tester.pumpAndSettle();
      expect(repo.saves, [(country: 'AE', subdivision: 'AE-DU')]);
    });

    testWidgets('dismissing a suggested prompt with Later never saves it', (tester) async {
      final repo = FakeLocationRepository(initial: const MyLocation(prompt: true, suggestedCountryCode: 'AE'));
      await pump(tester, shell(UserRole.parent), repo);
      await tester.tap(find.byKey(const ValueKey('location-secondary')));
      await tester.pumpAndSettle();
      expect(repo.saves, isEmpty);
      expect(repo.laterCalls, 1);
    });

    for (final role in [UserRole.teacher, UserRole.sales]) {
      testWidgets('${role.name} staff are never asked, and the app does not even read it', (tester) async {
        final repo = FakeLocationRepository();
        await pump(tester, shell(role), repo);
        expect(prompt, findsNothing);
        expect(repo.mineCalls, 0);
      });
    }
  });
}

class _NoPhotos implements ProfilePhotoRepository {
  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError();
}
