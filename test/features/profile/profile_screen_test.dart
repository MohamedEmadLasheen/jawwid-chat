import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/app/shells/app_shell.dart';
import 'package:jawwid_chat/core/data/fake_backend.dart';
import 'package:jawwid_chat/core/data/fake_repositories.dart';
import 'package:jawwid_chat/core/storage/secure_token_store.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/design/widgets/jawwid_avatar.dart';
import 'package:jawwid_chat/features/auth/application/auth_controller.dart';
import 'package:jawwid_chat/features/auth/domain/auth_state.dart';
import 'package:jawwid_chat/features/conversations/presentation/chats_screen.dart';
import 'package:jawwid_chat/features/conversations/presentation/conversation_tile.dart';
import 'package:jawwid_chat/features/profile/presentation/profile_screen.dart';
import 'package:jawwid_chat/features/profile/presentation/profile_sections.dart';
import 'package:jawwid_chat/features/settings/presentation/settings_screen.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/auth.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

/// Profiles are contextual: reached by tapping an avatar or a name, never from a tab.
void main() {
  Widget harness({
    required UserRole role,
    required Widget child,
    Locale locale = const Locale('en'),
    String? avatarUrl,
    Map<String, String>? imageHeaders,
  }) {
    final backend = FakeBackend(role: role);
    addTearDown(backend.dispose);

    return ProviderScope(
      overrides: [
        currentRoleProvider.overrideWithValue(role),
        // Synchronous on purpose: the production provider awaits a token, and a test
        // that pumped a pending future would read null headers and pass for the
        // wrong reason.
        if (imageHeaders != null)
          signedImageHeadersProvider.overrideWith((ref) => imageHeaders),
          apiBaseUrlProvider.overrideWithValue('http://api.test/api/v1'),
        conversationRepositoryProvider
            .overrideWithValue(FakeConversationRepository(backend)),
        messageRepositoryProvider
            .overrideWithValue(FakeMessageRepository(backend)),
        groupRepositoryProvider.overrideWithValue(FakeGroupRepository(backend)),
        callRepositoryProvider.overrideWithValue(FakeCallRepository(backend)),
        authControllerProvider.overrideWith(
          () => _SignedIn(
            backend: backend,
            user: AuthUser(
              id: role == UserRole.parent ? 'u_parent' : 'u_teacher',
              displayName: role == UserRole.parent ? 'ولي أمر' : 'معلم',
              role: role,
              avatarUrl: avatarUrl,
            ),
          ),
        ),
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
        home: child,
      ),
    );
  }

  group('tapping an avatar or a name opens the profile, not the conversation', () {
    testWidgets('the avatar opens the profile', (tester) async {
      String? openedConversation;
      String? openedProfile;

      await tester.pumpWidget(
        harness(
          role: UserRole.parent,
          child: ChatsScreen(
            onOpenConversation: (id) => openedConversation = id,
            onOpenProfile: (id) => openedProfile = id,
          ),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byType(JawwidAvatar).first);
      await tester.pumpAndSettle();

      expect(openedProfile, isNotNull);
      expect(
        openedConversation,
        isNull,
        reason: 'the avatar tap must not also open the conversation underneath',
      );
    });

    testWidgets('the name opens the profile', (tester) async {
      String? openedConversation;
      String? openedProfile;

      await tester.pumpWidget(
        harness(
          role: UserRole.parent,
          child: ChatsScreen(
            onOpenConversation: (id) => openedConversation = id,
            onOpenProfile: (id) => openedProfile = id,
          ),
        ),
      );
      await tester.pumpAndSettle();

      final firstTile = find.byType(ConversationTile).first;
      final title = tester.widget<ConversationTile>(firstTile).conversation.title;
      await tester.tap(find.descendant(of: firstTile, matching: find.text(title)));
      await tester.pumpAndSettle();

      expect(openedProfile, isNotNull);
      expect(openedConversation, isNull);
    });

    testWidgets('the rest of the row still opens the conversation', (tester) async {
      String? openedConversation;
      String? openedProfile;

      await tester.pumpWidget(
        harness(
          role: UserRole.parent,
          child: ChatsScreen(
            onOpenConversation: (id) => openedConversation = id,
            onOpenProfile: (id) => openedProfile = id,
          ),
        ),
      );
      await tester.pumpAndSettle();

      // The preview line — clear of both the avatar and the name.
      await tester.tap(find.text('تم تأكيد موعد الحصة القادمة.').first);
      await tester.pumpAndSettle();

      expect(openedConversation, isNotNull);
      expect(openedProfile, isNull);
    });
  });

  group('group info', () {
    testWidgets('shows members with names and roles, and no contact actions',
        (tester) async {
      await tester.pumpWidget(
        harness(
          role: UserRole.parent,
          child: const ConversationProfileScreen(conversationId: 'c_group_1'),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Group info'), findsOneWidget);
      expect(find.text('Members'), findsOneWidget);
      expect(find.text('Teacher'), findsWidgets);

      // Rule 7: no message action, no call action. Absent, not disabled.
      for (final icon in [
        Icons.call,
        Icons.phone,
        Icons.message,
        Icons.chat,
        Icons.person_add,
        Icons.person_remove,
        Icons.group_add,
      ]) {
        expect(find.byIcon(icon), findsNothing, reason: '$icon must not appear');
      }
    });

    testWidgets('a teacher opening group info sees no contact or children section',
        (tester) async {
      await tester.pumpWidget(
        harness(
          role: UserRole.teacher,
          child: const ConversationProfileScreen(conversationId: 'c_group_1'),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Contact information'), findsNothing);
      expect(find.text('Children'), findsNothing);
      expect(find.byType(ChildTile), findsNothing);
    });
  });

  group('my account', () {
    testWidgets('a parent sees their children, collapsed', (tester) async {
      await tester.pumpWidget(
        harness(role: UserRole.parent, child: const MyAccountScreen()),
      );
      await tester.pumpAndSettle();

      expect(find.text('Children'), findsOneWidget);
      // Two learners in the parent fixture.
      expect(find.byType(ChildTile), findsNWidgets(2));
      expect(find.text('أحمد'), findsOneWidget);

      // Progressive disclosure: the detail rows are not on screen until expanded.
      expect(find.text('Level'), findsNothing);
      expect(find.text('Subscription'), findsNothing);
    });

    testWidgets('expanding a child reveals real data and names the gaps',
        (tester) async {
      await tester.pumpWidget(
        harness(role: UserRole.parent, child: const MyAccountScreen()),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text('أحمد'));
      await tester.pumpAndSettle();

      expect(find.text('Group'), findsOneWidget);
      expect(find.text('Teacher'), findsOneWidget);
      expect(find.text('Level'), findsOneWidget);
      expect(find.text('Subscription'), findsOneWidget);
      expect(find.text('Schedule'), findsOneWidget);

      // Level, subscription and schedule are on no contract this client can reach. They
      // say so, rather than rendering blank — a blank reads as "this child has none".
      expect(find.text('Not available yet'), findsNWidgets(3));
    });

    testWidgets('the contact file section says plainly that it holds nothing',
        (tester) async {
      await tester.pumpWidget(
        harness(role: UserRole.parent, child: const MyAccountScreen()),
      );
      await tester.pumpAndSettle();

      expect(find.text('Contact information'), findsOneWidget);
      expect(
        find.text(
          'Jawwid does not hold phone numbers or email addresses in this app yet.',
        ),
        findsOneWidget,
      );
    });

    testWidgets('a teacher account has no children section at all', (tester) async {
      await tester.pumpWidget(
        harness(role: UserRole.teacher, child: const MyAccountScreen()),
      );
      await tester.pumpAndSettle();

      expect(find.text('Children'), findsNothing);
      expect(find.byType(ChildTile), findsNothing);
    });
  });

  group('no phone-shaped string reaches any profile', () {
    final phoneShaped = RegExp(r'(?:\+|00)\d[\d\s\-().]{6,}\d|\b0\d{9,}\b');

    testWidgets('not on a group profile, not on my own account', (tester) async {
      for (final screen in <Widget>[
        const ConversationProfileScreen(conversationId: 'c_group_1'),
        const MyAccountScreen(),
      ]) {
        for (final role in UserRole.values) {
          await tester.pumpWidget(harness(role: role, child: screen));
          await tester.pumpAndSettle();

          final rendered = tester
              .widgetList<Text>(find.byType(Text))
              .map((t) => t.data ?? t.textSpan?.toPlainText() ?? '');

          for (final text in rendered) {
            expect(
              phoneShaped.hasMatch(text),
              isFalse,
              reason: 'phone-shaped string on a ${role.name} profile: "$text"',
            );
          }
        }
      }
    });
  });

  group('Settings offers exactly one way into my account', () {
    testWidgets('the identity row is the entry point, and there is only one',
        (tester) async {
      await tester.pumpWidget(
        harness(role: UserRole.parent, child: const SettingsScreen()),
      );
      await tester.pumpAndSettle();

      // The name is shown once. It used to appear as a dead header *and* as a separate
      // "My account" row, so the first thing anyone tapped did nothing.
      expect(find.text('ولي أمر'), findsOneWidget);
      expect(find.text('My account'), findsNothing);

      // And the identity row is what you tap.
      final row = find.ancestor(
        of: find.text('ولي أمر'),
        matching: find.byType(InkWell),
      );
      expect(row, findsWidgets);
      expect(
        tester.widgetList<InkWell>(row).any((w) => w.onTap != null),
        isTrue,
        reason: 'tapping your own name in Settings must open your account',
      );
    });
  });

  group('the bottom navigation is untouched', () {
    testWidgets('there is still no Profile destination', (tester) async {
      await tester.pumpWidget(
        harness(
          role: UserRole.parent,
          child: AppShell(
            role: UserRole.parent,
            currentRoute: '/chats',
            onDestinationSelected: (_) {},
            child: const SizedBox.shrink(),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byType(NavigationDestination), findsNWidgets(3));
      expect(find.text('Profile'), findsNothing);
      expect(find.text('My account'), findsNothing);
      expect(
        Shells.destinations.map((d) => d.route),
        ['/chats', '/calls', '/settings'],
      );
    });
  });

  group('the account avatar in Settings is authenticated exactly once', () {
    /// `AuthUser.avatarUrl` is a STABLE application URL, held for the life of the
    /// session, so it carries no credential of its own and needs the bearer token.
    /// Settings read `user.avatarUrl` from the day the field existed but never passed
    /// headers, so the photo 401ed and fell back to initials — indistinguishable from
    /// "no photo set", which is why this looked like "the avatar never changes".
    NetworkImage accountImage(WidgetTester tester) {
      final provider = tester
          .widgetList<Image>(find.descendant(
            of: find.byType(JawwidAvatar),
            matching: find.byType(Image),
          ))
          .first
          .image;
      // `cacheWidth`/`cacheHeight` make `Image.network` wrap the provider in a
      // `ResizeImage`, so unwrap one layer before reading the headers.
      return (provider is ResizeImage ? provider.imageProvider : provider)
          as NetworkImage;
    }

    testWidgets('a STABLE avatar url is fetched WITH the session token',
        (tester) async {
      await tester.pumpWidget(
        harness(
          role: UserRole.parent,
          avatarUrl: 'http://api.test/api/v1/me/avatar/image',
          imageHeaders: const {'Authorization': 'Bearer session-token'},
          child: const SettingsScreen(),
        ),
      );
      await tester.pumpAndSettle();

      expect(accountImage(tester).url, 'http://api.test/api/v1/me/avatar/image');
      expect(
        accountImage(tester).headers?['Authorization'],
        'Bearer session-token',
        reason: 'a stable application URL carries no credential of its own',
      );
    });

    testWidgets('a PRESIGNED avatar url is fetched with NO token',
        (tester) async {
      await tester.pumpWidget(
        harness(
          role: UserRole.parent,
          avatarUrl: 'http://storage.test/a.jpg'
              '?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=deadbeef',
          // Headers ARE available: the suppression must come from the URL shape, not
          // from an absent token.
          imageHeaders: const {'Authorization': 'Bearer session-token'},
          child: const SettingsScreen(),
        ),
      );
      await tester.pumpAndSettle();

      expect(
        accountImage(tester).headers?.containsKey('Authorization') ?? false,
        isFalse,
        reason: 'object storage rejects a request carrying two auth types',
      );
    });

    testWidgets('no avatar url shows initials and requests nothing',
        (tester) async {
      await tester.pumpWidget(
        harness(role: UserRole.parent, child: const SettingsScreen()),
      );
      await tester.pumpAndSettle();

      expect(
        find.descendant(
          of: find.byType(JawwidAvatar),
          matching: find.byType(Image),
        ),
        findsNothing,
      );
    });
  });
}

/// A session that is already established.
///
/// The real controller starts at [AuthUnknown] and reaches [AuthAuthenticated] only by
/// restoring or signing in; these tests are about the profile, not about that path, so this
/// starts where they need it and leaves every other behaviour untouched.
class _SignedIn extends AuthController {
  _SignedIn({required FakeBackend backend, required AuthUser user})
      : _user = user,
        super(
          repository: FakeAuthRepository(
            backend: backend,
            tokens: InMemoryTokenStore(),
          ),
          tokens: InMemoryTokenStore(),
          clearLocalData: _noop,
        );

  final AuthUser _user;

  static Future<void> _noop() async {}

  @override
  AuthState build() => AuthAuthenticated(_user);
}
