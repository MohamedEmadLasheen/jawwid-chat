import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/data/fake_repositories.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/moderation/application/direct_counterpart.dart';
import 'package:jawwid_chat/features/moderation/data/moderation_repository.dart';
import 'package:jawwid_chat/features/profile/application/profile_controller.dart';
import 'package:jawwid_chat/features/profile/domain/profile_view.dart';
import 'package:jawwid_chat/features/profile/presentation/profile_screen.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

/// PD-57 (#464 fix): a one-to-one profile reports the conversation's OTHER PERSON -- their
/// actor id and kind -- never the conversation id, and offers nothing when that person
/// cannot be established. The lookup itself over HTTP: direct_counterpart_over_http_test.
void main() {
  group('the one-to-one profile', () {
    Widget wrap(Widget home, {required Locale locale, List<Override> overrides = const []}) => ProviderScope(
      overrides: [
        currentRoleProvider.overrideWithValue(UserRole.parent),
        principalIdProvider.overrideWithValue('me'),
        ...overrides,
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
        home: Scaffold(body: home),
      ),
    );

    for (final locale in const [Locale('en'), Locale('ar')]) {
      final tag = locale.languageCode;

      testWidgets('reports the counterpart by their id and kind, never the conversation id [$tag]', (tester) async {
        final l10n = await L10n.delegate.load(locale);
        final repo = FakeModerationRepository();
        await tester.pumpWidget(
          wrap(
            const ConversationReportTile(conversationId: 'c1'),
            locale: locale,
            overrides: [
              moderationRepositoryProvider.overrideWithValue(repo),
              directCounterpartProvider('c1').overrideWith(
                (ref) async => const ProfilePerson(
                  id: 't9',
                  displayName: 'Ustadh Kareem',
                  role: ParticipantRole.teacher,
                  actorKind: 'teacher',
                ),
              ),
            ],
          ),
        );
        await tester.pumpAndSettle();

        await tester.tap(find.byKey(const ValueKey('profile-report-person')));
        await tester.pumpAndSettle();
        expect(find.text(l10n.reportSheetPersonIntro), findsOneWidget);
        await tester.tap(find.byKey(ValueKey('report-reason-${ReportReason.harassment.wire}')));
        await tester.pumpAndSettle();
        final send = find.byKey(const ValueKey('report-submit'));
        await tester.ensureVisible(send);
        await tester.tap(send);
        await tester.pumpAndSettle();

        expect(repo.bodies.single, {
          'targetKind': 'person',
          'subject': {'kind': 'teacher', 'id': 't9'},
          'reason': 'harassment',
        });
      });

      testWidgets('offers no Report when the counterpart cannot be established [$tag]', (tester) async {
        await tester.pumpWidget(
          wrap(
            const ConversationReportTile(conversationId: 'c1'),
            locale: locale,
            overrides: [
              moderationRepositoryProvider.overrideWithValue(FakeModerationRepository()),
              directCounterpartProvider('c1').overrideWith((ref) async => null),
            ],
          ),
        );
        await tester.pumpAndSettle();
        expect(find.byKey(const ValueKey('profile-report-person')), findsNothing);
      });

      testWidgets('a counterpart with no actorKind is offered nothing, whatever its role [$tag]', (tester) async {
        await tester.pumpWidget(
          wrap(
            const ConversationReportTile(conversationId: 'c1'),
            locale: locale,
            overrides: [
              moderationRepositoryProvider.overrideWithValue(FakeModerationRepository()),
              directCounterpartProvider('c1').overrideWith(
                (ref) async =>
                    const ProfilePerson(id: 't9', displayName: 'Ustadh Kareem', role: ParticipantRole.teacher),
              ),
            ],
          ),
        );
        await tester.pumpAndSettle();
        expect(find.byKey(const ValueKey('profile-report-person')), findsNothing);
      });

      testWidgets('the profile screen wires it: a 1:1 conversation reports the person, not itself [$tag]', (
        tester,
      ) async {
        final repo = FakeModerationRepository();
        await tester.pumpWidget(
          wrap(
            const ConversationProfileScreen(conversationId: 'c1'),
            locale: locale,
            overrides: [
              moderationRepositoryProvider.overrideWithValue(repo),
              conversationProfileProvider('c1').overrideWith(
                (ref) async => const ProfileView(
                  audience: ProfileAudience.other,
                  subject: ProfilePerson(id: 'c1', displayName: 'Ustadh Kareem'),
                  isGroup: false,
                ),
              ),
              directCounterpartProvider('c1').overrideWith(
                (ref) async => const ProfilePerson(
                  id: 's1',
                  displayName: 'Noura',
                  role: ParticipantRole.admin,
                  actorKind: 'staff',
                ),
              ),
            ],
          ),
        );
        await tester.pumpAndSettle();

        final tile = find.byKey(const ValueKey('profile-report-person'));
        expect(tile, findsOneWidget);
        await tester.ensureVisible(tile);
        await tester.tap(tile);
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(ValueKey('report-reason-${ReportReason.spam.wire}')));
        await tester.pumpAndSettle();
        final send = find.byKey(const ValueKey('report-submit'));
        await tester.ensureVisible(send);
        await tester.tap(send);
        await tester.pumpAndSettle();

        expect(repo.bodies.single['subject'], {'kind': 'staff', 'id': 's1'});
      });
    }
  });
}
