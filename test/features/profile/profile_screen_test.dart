import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/app/shells/app_shell.dart';
import 'package:jawwid_chat/core/data/fake_backend.dart';
import 'package:jawwid_chat/core/data/fake_repositories.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/core/storage/secure_token_store.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/design/widgets/jawwid_avatar.dart';
import 'package:jawwid_chat/features/auth/application/auth_controller.dart';
import 'package:jawwid_chat/features/auth/domain/auth_state.dart';
import 'package:jawwid_chat/features/conversations/presentation/chats_screen.dart';
import 'package:jawwid_chat/features/conversations/presentation/conversation_tile.dart';
import 'package:jawwid_chat/features/materials/data/materials_repository.dart';
import 'package:jawwid_chat/features/messages/presentation/chat_screen.dart';
import 'package:jawwid_chat/features/profile/application/profile_controller.dart';
import 'package:jawwid_chat/features/profile/data/profile_photo_repository.dart';
import 'package:jawwid_chat/features/profile/domain/profile_view.dart';
import 'package:jawwid_chat/features/profile/presentation/my_profile_screen.dart';
import 'package:jawwid_chat/features/profile/presentation/profile_screen.dart';
import 'package:jawwid_chat/features/profile/presentation/profile_sections.dart';
import 'package:jawwid_chat/features/settings/presentation/settings_screen.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/auth.dart';
import 'package:jawwid_chat/shared/models/lesson.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

/// Profiles are contextual: reached by tapping an avatar or a name, never from a tab.
void main() {
  Widget harness({
    required UserRole role,
    required Widget child,
    Locale locale = const Locale('en'),
    bool superAdmin = false,
    String? photoUrl,
    List<Override> extra = const [],
  }) {
    final backend = FakeBackend(role: role);
    addTearDown(backend.dispose);

    return ProviderScope(
      overrides: [
        currentRoleProvider.overrideWithValue(role),
        if (photoUrl != null) profilePhotoRepositoryProvider.overrideWithValue(_OnePhoto(photoUrl)),
        profileRepositoryProvider.overrideWithValue(FakeProfileRepository()),
        conversationRepositoryProvider
            .overrideWithValue(FakeConversationRepository(backend)),
        messageRepositoryProvider
            .overrideWithValue(FakeMessageRepository(backend)),
        groupRepositoryProvider.overrideWithValue(FakeGroupRepository(backend)),
        callRepositoryProvider.overrideWithValue(FakeCallRepository(backend)),
        ...extra,
        authControllerProvider.overrideWith(
          () => _SignedIn(
            backend: backend,
            // The fixture's own principal for the role (PD-20 added Sales).
            user: AuthUser(id: backend.user.id, displayName: backend.user.displayName, role: role, isSuperAdmin: superAdmin),
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

  // Owner 2026-10-24, WhatsApp-style: the WHOLE row opens the conversation --
  // its avatar and its name included. Group Info / a person's profile is reached
  // from the chat header (the last test in this group).
  group('tapping any part of a row opens the conversation, never the profile', () {
    Future<String?> tapIn(WidgetTester tester, Finder Function() target) async {
      String? openedConversation;
      await tester.pumpWidget(
        harness(
          role: UserRole.parent,
          child: ChatsScreen(onOpenConversation: (id) => openedConversation = id),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(target());
      await tester.pumpAndSettle();
      return openedConversation;
    }

    testWidgets('the avatar opens the conversation', (tester) async {
      final firstTile = find.byType(ConversationTile).first;
      final opened = await tapIn(tester, () => find.descendant(of: firstTile, matching: find.byType(JawwidAvatar)));
      expect(opened, isNotNull);
      expect(find.byType(ConversationProfileScreen), findsNothing);
    });

    testWidgets('the name opens the conversation', (tester) async {
      final firstTile = find.byType(ConversationTile).first;
      final opened = await tapIn(tester, () {
        final title = tester.widget<ConversationTile>(firstTile).conversation.title;
        return find.descendant(of: firstTile, matching: find.text(title));
      });
      expect(opened, isNotNull);
    });

    testWidgets('the rest of the row opens the conversation', (tester) async {
      final opened = await tapIn(tester, () => find.text('تم تأكيد موعد الحصة القادمة.').first);
      expect(opened, isNotNull);
    });

    testWidgets("inside the chat, the header's name and avatar open Group Info", (tester) async {
      var openedProfile = 0;
      await tester.pumpWidget(
        harness(
          role: UserRole.parent,
          child: ChatScreen(conversationId: 'c_group_1', title: 'Header title', onOpenProfile: () => openedProfile++),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Header title'));
      await tester.pumpAndSettle();
      await tester.tap(find.descendant(of: find.byType(AppBar), matching: find.byType(JawwidAvatar)));
      await tester.pumpAndSettle();
      expect(openedProfile, 2);
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

    // Systest 2026-10-28: a family group (PD-15) names no single learner -- it lists its
    // children -- so its Materials never appeared for anyone. Each child now brings its own.
    testWidgets('a FAMILY group (no single learner) shows each child\'s Materials entry', (tester) async {
      const family = ProfileView(
        audience: ProfileAudience.other,
        subject: ProfilePerson(id: 'c_family', displayName: 'family_group'),
        isGroup: true,
      );
      await tester.pumpWidget(harness(
        role: UserRole.parent,
        child: const ConversationProfileScreen(conversationId: 'c_family'),
        extra: [
          conversationProfileProvider('c_family').overrideWith((ref) async => family),
          lessonRepositoryProvider.overrideWithValue(_Children(const [
            GroupChild(id: 'k1', name: 'learner_l'),
            GroupChild(id: 'k2', name: 'learner_m'),
          ])),
          materialsRepositoryProvider.overrideWithValue(_SomeMaterials()),
        ],
      ));
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(find.byKey(const ValueKey('materials-entry-k2')), 200);
      expect(find.byKey(const ValueKey('materials-entry-k1')), findsOneWidget);
      expect(find.byKey(const ValueKey('materials-entry-k2')), findsOneWidget);
    });

    testWidgets('a LEARNER group keeps its one entry, from its learner -- never twice', (tester) async {
      await tester.pumpWidget(harness(
        role: UserRole.parent,
        child: const ConversationProfileScreen(conversationId: 'c_group_1'),
        extra: [
          // Its children list names the same learner; the entry still comes once.
          lessonRepositoryProvider.overrideWithValue(_Children(const [GroupChild(id: 'l_1', name: 'learner_l')])),
          materialsRepositoryProvider.overrideWithValue(_SomeMaterials()),
        ],
      ));
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(find.byKey(const ValueKey('materials-entry-l_1')), 200);
      expect(find.byKey(const ValueKey('materials-entry-l_1')), findsOneWidget);
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

  // Owner 2026-10-24: a parent had a Settings row to "My account" (initials, a
  // "Profile photo" section, "Children's photos", and "No children are linked to your
  // account yet") AND a separate "My profile" row with another photo control. One
  // profile per account now: My account IS the parent's own profile, with each child.
  group('my account', () {
    testWidgets("a parent's account is their one profile, with their children", (tester) async {
      await tester.pumpWidget(
        harness(role: UserRole.parent, child: const MyAccountScreen()),
      );
      await tester.pumpAndSettle();

      expect(find.byType(MyProfileScreen), findsOneWidget);
      // The children come from the server's parent profile (PD-17), not from the
      // chats: the parent fixture has two.
      expect(find.text('أحمد'), findsOneWidget);
      expect(find.text('يوسف'), findsOneWidget);
      expect(find.text('No children are linked to your account yet.'), findsNothing);
      // No second photo section beside the cards' own photo controls.
      expect(find.text("Children's photos"), findsNothing);
      expect(find.text('Profile photo'), findsNothing);
    });

    testWidgets('Settings has one entry into it, not two', (tester) async {
      await tester.pumpWidget(harness(role: UserRole.parent, child: const SettingsScreen()));
      await tester.pumpAndSettle();
      expect(find.text('My profile'), findsNothing);
      expect(find.text('Your photo, name and about'), findsNothing);
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

  // Owner 2026-10-24: "uploaded photos don't show". The photo is kept in one place
  // (`/me/photo`, written by `/me/avatar`), but Settings and My account read the
  // session's user, which carries none -- so they showed initials after an upload.
  group('my own photo shows wherever my own face is drawn', () {
    const url = 'https://api.example/media/avatars/contact.p1.self?s=sig&k=abcd1234';
    String? avatarIn(WidgetTester tester, Finder scope) =>
        tester.widget<JawwidAvatar>(find.descendant(of: scope, matching: find.byType(JawwidAvatar)).first).imageUrl;

    testWidgets('the Settings row', (tester) async {
      await tester.pumpWidget(harness(role: UserRole.parent, photoUrl: url, child: const SettingsScreen()));
      await tester.pumpAndSettle();
      expect(avatarIn(tester, find.byType(SettingsScreen)), url);
    });

    testWidgets('the My account header', (tester) async {
      await tester.pumpWidget(harness(role: UserRole.sales, photoUrl: url, child: const MyAccountScreen()));
      await tester.pumpAndSettle();
      expect(avatarIn(tester, find.byType(ProfileHeader)), url);
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

  group('PD-30: Payments left Settings for the Subscriptions tab', () {
    testWidgets('a parent no longer sees a Payments row in Settings', (tester) async {
      await tester.pumpWidget(harness(role: UserRole.parent, child: const SettingsScreen()));
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('settings-my-payments')), findsNothing);
      expect(find.text('Payments'), findsNothing);
    });

    testWidgets('a teacher does not -- absent, not disabled', (tester) async {
      await tester.pumpWidget(harness(role: UserRole.teacher, child: const SettingsScreen()));
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('settings-my-payments')), findsNothing);
      expect(find.text('Payments'), findsNothing);
    });
  });

  group('PD-20: Settings for Sales', () {
    testWidgets('labelled Sales, with no parent, teacher or photo rows', (tester) async {
      await tester.pumpWidget(harness(role: UserRole.sales, child: const SettingsScreen()));
      await tester.pumpAndSettle();

      expect(find.text('Sales'), findsOneWidget);
      expect(find.byKey(const ValueKey('settings-my-payments')), findsNothing);
      expect(find.byKey(const ValueKey('settings-my-leave')), findsNothing);
      expect(find.text('My profile'), findsNothing);
      expect(find.byIcon(Icons.workspace_premium_outlined), findsNothing);
      expect(find.byIcon(Icons.badge_outlined), findsNothing);
    });

    testWidgets('in Arabic too', (tester) async {
      await tester.pumpWidget(harness(role: UserRole.sales, child: const SettingsScreen(), locale: const Locale('ar')));
      await tester.pumpAndSettle();
      expect(find.text('المبيعات'), findsOneWidget);
    });

    testWidgets('the super admin is labelled Super admin, with the same rows (PD-20 amendment)', (tester) async {
      await tester.pumpWidget(harness(role: UserRole.sales, child: const SettingsScreen(), superAdmin: true));
      await tester.pumpAndSettle();
      expect(find.text('Super admin'), findsOneWidget);
      expect(find.text('Sales'), findsNothing);
      expect(find.text('My profile'), findsNothing);

      await tester.pumpWidget(harness(role: UserRole.sales, child: const SettingsScreen(), superAdmin: true, locale: const Locale('ar')));
      await tester.pumpAndSettle();
      expect(find.text('المدير العام'), findsOneWidget);
    });

    testWidgets('My account offers Sales no photo controls (the server refuses staff photos)', (tester) async {
      await tester.pumpWidget(harness(role: UserRole.sales, child: const MyAccountScreen()));
      await tester.pumpAndSettle();

      expect(find.text('فريق المبيعات'), findsWidgets);
      expect(find.text('Profile photo'), findsNothing);
      expect(find.text('Children'), findsNothing);
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

      // PD-30: Chats, Calls, Subscriptions, Settings -- and still no Profile.
      expect(find.byType(NavigationDestination), findsNWidgets(4));
      expect(find.text('Profile'), findsNothing);
      expect(find.text('My account'), findsNothing);
      expect(
        Shells.destinations.map((d) => d.route),
        ['/chats', '/calls', '/settings'],
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

class _OnePhoto implements ProfilePhotoRepository {
  _OnePhoto(this.url);

  final String url;

  @override
  bool get isAvailable => true;

  @override
  Future<MyPhotos> mine() async => MyPhotos(avatarUrl: url);

  @override
  Future<String?> set(PendingAttachment photo, {String? childId}) async => url;

  @override
  Future<void> remove({String? childId}) async {}
}

/// The group's children, from /conversations/:id/learners; nothing else is asked.
class _Children implements LessonRepository {
  _Children(this.children);
  final List<GroupChild> children;

  @override
  Future<List<GroupChild>> groupChildren(String conversationId) async => children;

  /// A build without progress shows none (the card hides on UnsupportedError).
  @override
  Future<ChildProgress> progress(String learnerId) async => throw UnsupportedError('no progress here');

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

/// A materials server is there; the entry asks nothing of it until it is opened.
class _SomeMaterials implements MaterialsRepository {
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}
