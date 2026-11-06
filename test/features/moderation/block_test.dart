import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/data/fake_repositories.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/messages/presentation/message_actions.dart';
import 'package:jawwid_chat/features/messages/presentation/message_bubble.dart';
import 'package:jawwid_chat/features/moderation/application/blocks_controller.dart';
import 'package:jawwid_chat/features/moderation/application/direct_counterpart.dart';
import 'package:jawwid_chat/features/moderation/data/block_repository.dart';
import 'package:jawwid_chat/features/moderation/presentation/block_actions.dart';
import 'package:jawwid_chat/features/moderation/presentation/blocked_people_screen.dart';
import 'package:jawwid_chat/features/profile/domain/profile_view.dart';
import 'package:jawwid_chat/features/profile/presentation/profile_screen.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/message.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

/// PD-57 (WP-2B, ENG-07): Block and Unblock -- the confirmation and what it promises (lessons
/// continue, the academy is told), the placeholder for a hidden message, the composer of a
/// direct chat with someone blocked, Settings -> Blocked people, who is never offered Block,
/// and calm answers to the contract's error codes. Each in English and in Arabic (RTL).
void main() {
  Future<L10n> l10nFor(Locale locale) => L10n.delegate.load(locale);

  PersonBlock blockOf(String id, String personId, {String kind = 'teacher', String name = 'Ustadh Kareem'}) =>
      PersonBlock(
        id: id,
        subject: BlockSubject(kind: kind, id: personId),
        name: name,
        createdAt: DateTime.utc(2026, 11, 1, 12),
      );

  Widget wrap(
    Widget home, {
    required Locale locale,
    UserRole role = UserRole.parent,
    List<Override> overrides = const [],
  }) {
    return ProviderScope(
      overrides: [
        currentRoleProvider.overrideWithValue(role),
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
  }

  const teacher = ProfilePerson(
    id: 't9',
    displayName: 'Ustadh Kareem',
    role: ParticipantRole.teacher,
    actorKind: 'teacher',
  );

  for (final locale in const [Locale('en'), Locale('ar')]) {
    final tag = locale.languageCode;
    final rtl = tag == 'ar';

    group('blocking from a profile [$tag]', () {
      testWidgets('the confirmation says what a block does, that lessons continue and that the academy is told', (
        tester,
      ) async {
        final l10n = await l10nFor(locale);
        final repo = FakeBlockRepository();
        await tester.pumpWidget(
          wrap(
            const BlockPersonTile(person: teacher),
            locale: locale,
            overrides: [blockRepositoryProvider.overrideWithValue(repo)],
          ),
        );
        await tester.pumpAndSettle();

        await tester.tap(find.byKey(const ValueKey('profile-block-person')));
        await tester.pumpAndSettle();

        expect(find.text(l10n.blockConfirmTitle('Ustadh Kareem')), findsOneWidget);
        expect(find.text(l10n.blockConfirmBody), findsOneWidget);
        expect(find.text(l10n.blockConfirmLessons), findsOneWidget);
        expect(find.text(l10n.blockConfirmAcademy), findsOneWidget);
        // The plain words, so a reword cannot quietly drop the promise.
        if (!rtl) {
          expect(l10n.blockConfirmLessons, contains('lesson calls'));
          expect(l10n.blockConfirmLessons, contains('lesson cards'));
          expect(l10n.blockConfirmLessons, contains('academy'));
          expect(l10n.blockConfirmAcademy, contains('academy is told'));
        } else {
          expect(l10n.blockConfirmLessons, contains('الدروس'));
          expect(l10n.blockConfirmAcademy, contains('الأكاديمية'));
        }
        expect(
          Directionality.of(tester.element(find.byKey(const ValueKey('block-confirm')))),
          rtl ? TextDirection.rtl : TextDirection.ltr,
        );
        expect(repo.blocked, isEmpty, reason: 'nothing is sent before the user confirms');

        // Cancel sends nothing.
        await tester.tap(find.byKey(const ValueKey('block-cancel')));
        await tester.pumpAndSettle();
        expect(repo.blocked, isEmpty);
      });

      testWidgets('confirming blocks {kind, id}, says so calmly, and the row turns into Unblock', (tester) async {
        final l10n = await l10nFor(locale);
        final repo = FakeBlockRepository();
        await tester.pumpWidget(
          wrap(
            const BlockPersonTile(person: teacher),
            locale: locale,
            overrides: [blockRepositoryProvider.overrideWithValue(repo)],
          ),
        );
        await tester.pumpAndSettle();

        await tester.tap(find.byKey(const ValueKey('profile-block-person')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const ValueKey('block-confirm')));
        await tester.pumpAndSettle();

        expect(repo.blocked, [const BlockSubject(kind: 'teacher', id: 't9')]);
        expect(find.text(l10n.blockedSnack('Ustadh Kareem')), findsOneWidget);
        expect(find.byKey(const ValueKey('profile-unblock-person')), findsOneWidget);
        expect(find.text(l10n.unblockPersonAction), findsOneWidget);

        // And back: Unblock, with its own confirmation.
        await tester.tap(find.byKey(const ValueKey('profile-unblock-person')));
        await tester.pumpAndSettle();
        expect(find.text(l10n.unblockConfirmTitle('Ustadh Kareem')), findsOneWidget);
        await tester.tap(find.byKey(const ValueKey('unblock-confirm')));
        await tester.pumpAndSettle();
        expect(repo.unblocked, hasLength(1));
        expect(find.byKey(const ValueKey('profile-block-person')), findsOneWidget);
      });

      testWidgets('a group member row offers Block beside Report, with a spoken label naming the person', (
        tester,
      ) async {
        final l10n = await l10nFor(locale);
        final repo = FakeBlockRepository();
        const view = ProfileView(
          audience: ProfileAudience.other,
          subject: ProfilePerson(id: 'c_group', displayName: 'Yusuf'),
          isGroup: true,
          members: [
            ProfilePerson(id: 'me', displayName: 'Me', role: ParticipantRole.parent, actorKind: 'contact'),
            teacher,
            ProfilePerson(id: 'm_system', displayName: 'Jawwid', role: ParticipantRole.system),
            // No actorKind from the server: no Block, never a guess from the role.
            ProfilePerson(id: 'm_unknown', displayName: 'Someone', role: ParticipantRole.teacher),
          ],
        );
        await tester.pumpWidget(
          wrap(
            const ProfileBody(view: view),
            locale: locale,
            overrides: [blockRepositoryProvider.overrideWithValue(repo)],
          ),
        );
        await tester.pumpAndSettle();

        expect(find.byKey(const ValueKey('member-block-me')), findsNothing);
        expect(find.byKey(const ValueKey('member-block-m_system')), findsNothing);
        expect(find.byKey(const ValueKey('member-block-m_unknown')), findsNothing);
        expect(find.byTooltip('${l10n.blockAction}: Ustadh Kareem'), findsOneWidget);

        await tester.tap(find.byKey(const ValueKey('member-block-t9')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const ValueKey('block-confirm')));
        await tester.pumpAndSettle();
        expect(repo.blocked, [const BlockSubject(kind: 'teacher', id: 't9')]);
        expect(find.byTooltip('${l10n.unblockAction}: Ustadh Kareem'), findsOneWidget);
      });
    });

    testWidgets('the kind is the server\'s actorKind: a teacher whose memberRole is admin blocks as teacher [$tag]', (
      tester,
    ) async {
      final repo = FakeBlockRepository();
      await tester.pumpWidget(
        wrap(
          const BlockPersonTile(
            person: ProfilePerson(
              id: 't9',
              displayName: 'Ustadh Kareem',
              role: ParticipantRole.admin,
              actorKind: 'teacher',
            ),
          ),
          locale: locale,
          overrides: [blockRepositoryProvider.overrideWithValue(repo)],
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('profile-block-person')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('block-confirm')));
      await tester.pumpAndSettle();
      expect(repo.blocked, [const BlockSubject(kind: 'teacher', id: 't9')]);
    });

    group('who is never offered Block [$tag]', () {
      Future<void> expectNoBlock(
        WidgetTester tester,
        ProfilePerson person, {
        UserRole role = UserRole.parent,
        bool available = true,
      }) async {
        await tester.pumpWidget(
          wrap(
            BlockPersonTile(person: person),
            locale: locale,
            role: role,
            overrides: [if (available) blockRepositoryProvider.overrideWithValue(FakeBlockRepository())],
          ),
        );
        await tester.pumpAndSettle();
        expect(find.byKey(const ValueKey('profile-block-person')), findsNothing);
        expect(find.byKey(const ValueKey('profile-unblock-person')), findsNothing);
      }

      testWidgets('a staff viewer (Sales, the Super Admin) sees no Block at all', (tester) async {
        await expectNoBlock(tester, teacher, role: UserRole.sales);
        await expectNoBlock(
          tester,
          const ProfilePerson(id: 'p1', displayName: 'Umm Yusuf', role: ParticipantRole.parent, actorKind: 'contact'),
          role: UserRole.sales,
        );
      });

      testWidgets('nobody is offered to block themselves', (tester) async {
        await expectNoBlock(
          tester,
          const ProfilePerson(id: 'me', displayName: 'Me', role: ParticipantRole.parent, actorKind: 'contact'),
        );
      });

      testWidgets('the official account (a system actor) and an unknown kind are protected', (tester) async {
        await expectNoBlock(
          tester,
          const ProfilePerson(id: 'jawwid', displayName: 'Jawwid', role: ParticipantRole.system),
        );
        await expectNoBlock(tester, const ProfilePerson(id: 'x', displayName: 'X', role: ParticipantRole.unknown));
        await expectNoBlock(tester, const ProfilePerson(id: 'x', displayName: 'X'));
        // A known role but no actorKind from the server: nothing, never a guess.
        await expectNoBlock(tester, const ProfilePerson(id: 't9', displayName: 'T', role: ParticipantRole.teacher));
      });

      testWidgets('a build without the block routes offers nothing', (tester) async {
        await expectNoBlock(tester, teacher, available: false);
      });

      test('the rule itself', () {
        ProfilePerson p(String id, String? kind) => ProfilePerson(id: id, displayName: 'N', actorKind: kind);
        expect(mayBlockPerson(person: p('t9', 'teacher'), viewerId: 'me', viewerRole: UserRole.parent), isTrue);
        expect(mayBlockPerson(person: p('s1', 'staff'), viewerId: 'me', viewerRole: UserRole.teacher), isTrue);
        expect(mayBlockPerson(person: p('p1', 'contact'), viewerId: 'me', viewerRole: UserRole.teacher), isTrue);
        expect(mayBlockPerson(person: p('p1', 'contact'), viewerId: 'me', viewerRole: UserRole.sales), isFalse);
        expect(mayBlockPerson(person: p('me', 'contact'), viewerId: 'me', viewerRole: UserRole.parent), isFalse);
        expect(mayBlockPerson(person: p('j', null), viewerId: 'me', viewerRole: UserRole.parent), isFalse);
        expect(mayBlockPerson(person: p('j', 'system'), viewerId: 'me', viewerRole: UserRole.parent), isFalse);
        expect(mayBlockPerson(person: p('t9', 'teacher'), viewerId: 'me', viewerRole: null), isFalse);
        expect(
          blockSubjectKind(
            const ProfilePerson(id: 't9', displayName: 'N', role: ParticipantRole.admin, actorKind: 'teacher'),
          ),
          'teacher',
        );
      });
    });

    group('errors are calm and inline [$tag]', () {
      Future<void> failWith(WidgetTester tester, String code, String Function(L10n) expected) async {
        final l10n = await l10nFor(locale);
        final repo = FakeBlockRepository(refuseWith: code);
        await tester.pumpWidget(
          wrap(
            const BlockPersonTile(person: teacher),
            locale: locale,
            overrides: [blockRepositoryProvider.overrideWithValue(repo)],
          ),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const ValueKey('profile-block-person')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const ValueKey('block-confirm')));
        await tester.pumpAndSettle();

        // The dialog stays open with a calm sentence, the button works again, nothing technical.
        expect(find.byKey(const ValueKey('block-error')), findsOneWidget);
        expect(find.text(expected(l10n)), findsOneWidget);
        expect(tester.widget<FilledButton>(find.byKey(const ValueKey('block-confirm'))).onPressed, isNotNull);
        expect(find.textContaining('COMM.'), findsNothing);
        expect(find.textContaining('COMMON.'), findsNothing);
        expect(find.textContaining('refused'), findsNothing);
        expect(find.byKey(const ValueKey('profile-unblock-person')), findsNothing);
      }

      testWidgets(
        '403 not allowed (a protected target the client could not tell)',
        (tester) => failWith(tester, BlockErrors.notAllowed, (l) => l.blockErrorNotAllowed),
      );
      testWidgets(
        '404 no shared conversation',
        (tester) => failWith(tester, BlockErrors.noSharedConversation, (l) => l.blockErrorNoSharedConversation),
      );
      testWidgets(
        '429 rate limited',
        (tester) => failWith(tester, BlockErrors.rateLimited, (l) => l.blockErrorRateLimited),
      );
      testWidgets(
        '403 terms not accepted',
        (tester) => failWith(tester, BlockErrors.termsNotAccepted, (l) => l.blockErrorTerms),
      );
      testWidgets('anything else', (tester) => failWith(tester, 'COMMON.SOMETHING_NEW', (l) => l.blockErrorGeneric));

      test('the mapping', () async {
        final l10n = await l10nFor(locale);
        expect(
          blockErrorText(const AppError(AppErrorKind.forbidden, code: BlockErrors.notAllowed), l10n),
          l10n.blockErrorNotAllowed,
        );
        expect(
          blockErrorText(const AppError(AppErrorKind.notFound, code: BlockErrors.noSharedConversation), l10n),
          l10n.blockErrorNoSharedConversation,
        );
        expect(blockErrorText(const AppError(AppErrorKind.rateLimited), l10n), l10n.blockErrorRateLimited);
        expect(blockErrorText(const AppError(AppErrorKind.network), l10n), l10n.blockErrorGeneric);
      });

      testWidgets('a failed unblock is calm too, and the person stays blocked', (tester) async {
        final l10n = await l10nFor(locale);
        final repo = FakeBlockRepository(blocks: [blockOf('b1', 't9')], refuseUnblockWith: 'COMMON.SOMETHING');
        await tester.pumpWidget(
          wrap(
            const BlockPersonTile(person: teacher),
            locale: locale,
            overrides: [blockRepositoryProvider.overrideWithValue(repo)],
          ),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const ValueKey('profile-unblock-person')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const ValueKey('unblock-confirm')));
        await tester.pumpAndSettle();

        expect(find.byKey(const ValueKey('unblock-error')), findsOneWidget);
        expect(find.text(l10n.unblockErrorGeneric), findsOneWidget);
        expect(find.textContaining('COMMON.'), findsNothing);
      });
    });

    group('in a chat [$tag]', () {
      Message hidden({String id = 'm1', String authorId = 't9'}) => Message(
        id: id,
        clientMessageId: id,
        conversationId: 'c1',
        sequence: 4,
        kind: MessageKind.text,
        authorId: authorId,
        authorName: 'Ustadh Kareem',
        authorRole: ParticipantRole.teacher,
        createdAt: DateTime.utc(2026, 11, 1, 9),
        deliveryState: DeliveryState.delivered,
        isHiddenByBlock: true,
      );

      testWidgets('a hidden message is one line, read aloud, with Unblock one tap (and a confirmation) away', (
        tester,
      ) async {
        final l10n = await l10nFor(locale);
        final repo = FakeBlockRepository(blocks: [blockOf('b1', 't9')]);
        await tester.pumpWidget(
          wrap(
            MessageBubble(message: hidden(), showAuthor: true),
            locale: locale,
            overrides: [blockRepositoryProvider.overrideWithValue(repo)],
          ),
        );
        await tester.pumpAndSettle();

        expect(find.text(l10n.hiddenByBlockPlaceholder), findsOneWidget);
        final handle = tester.ensureSemantics();
        expect(find.bySemanticsLabel(RegExp(RegExp.escape(l10n.hiddenByBlockPlaceholder))), findsWidgets);
        handle.dispose();
        expect(
          Directionality.of(tester.element(find.text(l10n.hiddenByBlockPlaceholder))),
          rtl ? TextDirection.rtl : TextDirection.ltr,
        );

        await tester.tap(find.byKey(const ValueKey('hidden-by-block-unblock')));
        await tester.pumpAndSettle();
        expect(find.text(l10n.unblockConfirmTitle('Ustadh Kareem')), findsOneWidget);
        await tester.tap(find.byKey(const ValueKey('unblock-confirm')));
        await tester.pumpAndSettle();

        expect(repo.unblocked, ['b1']);
        expect(find.text(l10n.unblockedSnack('Ustadh Kareem')), findsOneWidget);
      });

      test('a hidden message offers no actions (nothing to reply to, copy or report)', () {
        expect(canActOn(hidden()), isFalse);
      });

      testWidgets('a build without the block routes shows the line but no Unblock', (tester) async {
        final l10n = await l10nFor(locale);
        await tester.pumpWidget(wrap(MessageBubble(message: hidden(), showAuthor: true), locale: locale));
        await tester.pumpAndSettle();
        expect(find.text(l10n.hiddenByBlockPlaceholder), findsOneWidget);
        expect(find.byKey(const ValueKey('hidden-by-block-unblock')), findsNothing);
      });

      testWidgets('a direct chat with someone blocked: the composer gives way to "You blocked {name}"', (tester) async {
        final l10n = await l10nFor(locale);
        final repo = FakeBlockRepository(blocks: [blockOf('b1', 't9')]);
        await tester.pumpWidget(
          wrap(
            const BlockedComposerGate(
              conversationId: 'c1',
              child: TextField(key: ValueKey('composer')),
            ),
            locale: locale,
            overrides: [
              blockRepositoryProvider.overrideWithValue(repo),
              directCounterpartProvider('c1').overrideWith((ref) async => teacher),
            ],
          ),
        );
        await tester.pumpAndSettle();

        expect(find.byKey(const ValueKey('composer')), findsNothing);
        expect(find.text(l10n.blockedComposerNotice('Ustadh Kareem')), findsOneWidget);

        await tester.tap(find.byKey(const ValueKey('blocked-composer-unblock')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const ValueKey('unblock-confirm')));
        await tester.pumpAndSettle();

        expect(repo.unblocked, ['b1']);
        expect(find.byKey(const ValueKey('composer')), findsOneWidget);
        expect(find.byKey(const ValueKey('blocked-composer')), findsNothing);
      });

      testWidgets('the composer stays for someone not blocked, and for a group', (tester) async {
        final repo = FakeBlockRepository(blocks: [blockOf('b1', 'someone_else')]);
        await tester.pumpWidget(
          wrap(
            const BlockedComposerGate(
              conversationId: 'c1',
              child: TextField(key: ValueKey('composer')),
            ),
            locale: locale,
            overrides: [
              blockRepositoryProvider.overrideWithValue(repo),
              directCounterpartProvider('c1').overrideWith((ref) async => teacher),
            ],
          ),
        );
        await tester.pumpAndSettle();
        expect(find.byKey(const ValueKey('composer')), findsOneWidget);

        // A fresh scope: a group has no counterpart, so the composer stays even with blocks.
        await tester.pumpWidget(const SizedBox());
        await tester.pumpWidget(
          wrap(
            const BlockedComposerGate(
              conversationId: 'c2',
              child: TextField(key: ValueKey('composer')),
            ),
            locale: locale,
            overrides: [
              blockRepositoryProvider.overrideWithValue(FakeBlockRepository(blocks: [blockOf('b1', 't9')])),
              directCounterpartProvider('c2').overrideWith((ref) async => null),
            ],
          ),
        );
        await tester.pumpAndSettle();
        expect(find.byKey(const ValueKey('composer')), findsOneWidget);
      });
    });

    group('Settings -> Blocked people [$tag]', () {
      Widget screen(BlockRepository repo) => wrap(
        const BlockedPeopleScreen(),
        locale: locale,
        overrides: [blockRepositoryProvider.overrideWithValue(repo)],
      );

      testWidgets('lists each block, and Unblock removes it', (tester) async {
        final l10n = await l10nFor(locale);
        final repo = FakeBlockRepository(
          blocks: [
            blockOf('b1', 't9'),
            blockOf('b2', 's1', kind: 'staff', name: ''),
          ],
        );
        await tester.pumpWidget(screen(repo));
        await tester.pumpAndSettle();

        expect(find.text(l10n.blockedPeopleTitle), findsOneWidget);
        expect(find.byKey(const ValueKey('blocked-person-b1')), findsOneWidget);
        expect(find.byKey(const ValueKey('blocked-person-b2')), findsOneWidget);
        expect(find.text('Ustadh Kareem'), findsOneWidget);
        // No name: a neutral word, never an id.
        expect(find.text('s1'), findsNothing);
        expect(find.byTooltip('${l10n.unblockAction}: Ustadh Kareem'), findsOneWidget);

        await tester.tap(find.byKey(const ValueKey('blocked-unblock-b1')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const ValueKey('unblock-confirm')));
        await tester.pumpAndSettle();

        expect(repo.unblocked, ['b1']);
        expect(find.byKey(const ValueKey('blocked-person-b1')), findsNothing);
        expect(find.byKey(const ValueKey('blocked-person-b2')), findsOneWidget);
        expect(
          Directionality.of(tester.element(find.byKey(const ValueKey('blocked-person-b2')))),
          rtl ? TextDirection.rtl : TextDirection.ltr,
        );
      });

      testWidgets('an empty list says so calmly', (tester) async {
        final l10n = await l10nFor(locale);
        await tester.pumpWidget(screen(FakeBlockRepository()));
        await tester.pumpAndSettle();
        expect(find.text(l10n.blockedPeopleEmptyTitle), findsOneWidget);
        expect(find.text(l10n.blockedPeopleEmptyBody), findsOneWidget);
      });

      testWidgets('a failed load is calm, with a retry', (tester) async {
        final l10n = await l10nFor(locale);
        await tester.pumpWidget(screen(FakeBlockRepository(failListWith: const AppError(AppErrorKind.network))));
        await tester.pumpAndSettle();
        expect(find.text(l10n.blockedPeopleLoadError), findsOneWidget);
        expect(find.text(l10n.retryAction), findsOneWidget);
        expect(find.textContaining('AppError'), findsNothing);
      });
    });
  }
}
