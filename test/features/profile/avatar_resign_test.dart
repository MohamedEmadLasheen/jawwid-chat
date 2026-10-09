import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/design/widgets/jawwid_avatar.dart';
import 'package:jawwid_chat/features/profile/application/parent_profile_controller.dart';
import 'package:jawwid_chat/features/profile/presentation/my_profile_screen.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/parent_profile.dart';

/// An expired signed avatar URL re-signs itself, a bounded number of times.
///
/// ## The defect this closes
///
/// Every `avatarUrl` is a signed URL with a five-minute life. `autoDispose` already means
/// re-entering the screen mints fresh ones — but a screen left OPEN past the TTL that then
/// rebuilds an image reached an expired URL and showed initials for as long as it stayed
/// open. A parent who had just set a photo would watch it turn back into letters.
///
/// ## Why the counting matters more than the happy path
///
/// A refetch triggered by an image failure is one line away from an infinite loop: the
/// refetch rebuilds the image, which fails again, which refetches. The first guard written
/// here deduplicated by URL and LOOKED sufficient; these tests hung, because the server
/// mints a new signature every time, so no retry ever carried a URL already seen. Hence the
/// assertions below are about HOW MANY times the server is asked.
///
/// In a widget test every `Image.network` fails — flutter_test answers HTTP with a 400 — so
/// the failure path is the DEFAULT here and no clock has to be faked. That also means these
/// tests cannot show an image SUCCEEDING; what they show is that a fresh signature reaches
/// the widget, and that the asking stops.
void main() {
  Widget harness(ProfileRepository repository, {Locale locale = const Locale('en')}) {
    return ProviderScope(
      overrides: [profileRepositoryProvider.overrideWithValue(repository)],
      child: MaterialApp(
        locale: locale,
        theme: JawwidTheme.light(isArabic: false),
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

  group('on the screen', () {
    testWidgets('an expired photo URL is re-signed, and the fresh one reaches the widget',
        (tester) async {
      final repo = _ReSigningRepository();

      await tester.pumpWidget(harness(repo));
      await tester.pumpAndSettle();

      // Asked again because the first URL failed to load, which is what expiry looks like.
      expect(repo.fetches, greaterThan(1));

      // And the widget is holding a LATER signature, not the stale one. This is the whole
      // point: without the re-sign the screen would still be pointing at `expired-1`.
      final avatar = tester.widget<JawwidAvatar>(find.byType(JawwidAvatar).first);
      expect(avatar.imageUrl, isNot(contains('sig=expired-1')));
      expect(avatar.imageUrl, contains('sig=fresh-'));
    });

    testWidgets('a PERMANENTLY broken photo cannot loop', (tester) async {
      // A photo that can never load, however often it is re-signed: a deleted object, a
      // permanent 404. Before the bound was a count, this test did not fail -- it HUNG.
      final repo = _ReSigningRepository(alwaysSameUrl: true);

      await tester.pumpWidget(harness(repo));
      await tester.pumpAndSettle();
      // Settle repeatedly, to catch a loop that merely runs slowly.
      for (var i = 0; i < 5; i++) {
        await tester.pump(const Duration(milliseconds: 100));
        await tester.pumpAndSettle();
      }

      expect(repo.fetches, lessThanOrEqualTo(_maxExpectedFetches),
          reason: 'one open plus a bounded number of re-signs, then it must stop asking');
      // It settles on initials rather than flickering, blanking or throwing.
      expect(find.byType(JawwidAvatar), findsWidgets);
      expect(tester.takeException(), isNull);
    });

    testWidgets('a parent with NO photo never asks for a re-sign', (tester) async {
      // Null is not a failure and must not look like one: no image is requested, so no
      // error fires and nothing is refetched.
      final repo = _ReSigningRepository(noPhoto: true);

      await tester.pumpWidget(harness(repo));
      await tester.pumpAndSettle();

      expect(repo.fetches, 1);
    });

    testWidgets('several avatars failing at once share one budget', (tester) async {
      // Parent plus two children, all expired on the same frame. One refetch re-signs ALL
      // of them, so this must not cost one round trip per avatar.
      final repo = _ReSigningRepository(children: 2);

      await tester.pumpWidget(harness(repo));
      await tester.pumpAndSettle();

      expect(repo.fetches, greaterThan(1));
      expect(repo.fetches, lessThanOrEqualTo(_maxExpectedFetches));
      for (final avatar in tester.widgetList<JawwidAvatar>(find.byType(JawwidAvatar))) {
        expect(avatar.imageUrl, isNot(contains('sig=expired-1')));
      }
    });
  });

  group('the budget itself', () {
    /// Driven directly, because on the screen every image fails and the budget is always
    /// spent in full -- which hides whether it is actually ENFORCED.
    ProviderContainer containerOn(ProfileRepository repo) {
      final container = ProviderContainer(
        overrides: [profileRepositoryProvider.overrideWithValue(repo)],
      );
      addTearDown(container.dispose);
      // Keep the autoDispose provider alive for the length of the test.
      final sub = container.listen(parentProfileProvider, (_, _) {});
      addTearDown(sub.close);
      return container;
    }

    test('is spent, and then refuses forever', () async {
      final repo = _ReSigningRepository();
      final container = containerOn(repo);
      await container.read(parentProfileProvider.future);
      expect(repo.fetches, 1, reason: 'opening the screen fetches once');

      final controller = container.read(parentProfileProvider.notifier);
      // Ten failures, each carrying a URL never seen before -- exactly what defeated the
      // per-URL guard.
      for (var i = 0; i < 10; i++) {
        await controller.resignAfterImageFailure('https://storage.test/avatars/p?sig=s$i');
      }

      expect(repo.fetches, _maxExpectedFetches,
          reason: 'one open plus the whole budget, and not one fetch more');
    });

    test('an empty URL is not a failure and costs nothing', () async {
      final repo = _ReSigningRepository();
      final container = containerOn(repo);
      await container.read(parentProfileProvider.future);

      await container.read(parentProfileProvider.notifier).resignAfterImageFailure('');

      expect(repo.fetches, 1);
    });
  });
}

/// One open plus the controller's whole re-sign budget.
///
/// Stated here rather than imported so that raising the budget has to be a deliberate edit
/// to this expectation too.
const _maxExpectedFetches = 1 + 3;

/// Hands out a new signature on every fetch, as the real API does.
///
/// The first is labelled `expired-1`; a widget test cannot load any of them, which is
/// precisely the condition under test.
class _ReSigningRepository implements ProfileRepository {
  _ReSigningRepository({
    this.alwaysSameUrl = false,
    this.noPhoto = false,
    this.children = 0,
  });

  /// Reproduces a photo that can never load -- a deleted object, not an expired signature.
  final bool alwaysSameUrl;
  final bool noPhoto;
  final int children;

  int fetches = 0;

  String _url(String suffix) {
    final signature =
        alwaysSameUrl ? 'expired-1' : (fetches == 1 ? 'expired-1' : 'fresh-$fetches');
    return 'https://storage.test/avatars/$suffix?expires=1&sig=$signature';
  }

  @override
  Future<ParentProfile> me() async {
    fetches++;
    return ParentProfile(
      displayName: 'Parent',
      avatarUrl: noPhoto ? null : _url('p'),
      children: [
        for (var i = 0; i < children; i++)
          ChildProfile(
            id: 'c$i',
            displayName: 'Child $i',
            avatarUrl: noPhoto ? null : _url('c$i'),
          ),
      ],
    );
  }

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnimplementedError('${invocation.memberName} is not used by this test');
}
