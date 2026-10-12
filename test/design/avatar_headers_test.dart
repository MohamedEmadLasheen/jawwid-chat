import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/data/fake_backend.dart';
import 'package:jawwid_chat/core/data/fake_repositories.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/design/widgets/jawwid_avatar.dart';
import 'package:jawwid_chat/features/conversations/presentation/conversation_tile.dart';
import 'package:jawwid_chat/features/messages/presentation/chat_screen_route.dart';
import 'package:jawwid_chat/features/profile/domain/profile_view.dart';
import 'package:jawwid_chat/features/profile/presentation/profile_screen.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/conversation.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

/// An avatar authenticates its image EXACTLY ONCE.
///
/// Two URL shapes reach these widgets and they need opposite treatment:
///
///   * a **stable** application URL (`/api/v1/me/avatar/image`) carries no credential of
///     its own, so it needs the session's bearer token or it 401s to initials;
///   * a **presigned** URL already carries SigV4 in its query string, and MinIO rejects a
///     request that also carries `Authorization` — `InvalidRequest (request has multiple
///     authentication types)`.
///
/// Every avatar that fetches an image was fixed one surface at a time, and the surfaces
/// that were missed stayed silently broken: the image just fell back to initials, which
/// looks like "no photo set" rather than like a bug. These tests pin all of them at once.
void main() {
  const stableUrl = 'http://api.test/api/v1/me/avatar/image';
  const presignedUrl = 'http://storage.test/avatars/a1.jpg'
      '?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=deadbeef';
  const headers = {'Authorization': 'Bearer session-token'};

  Widget harness(Widget child) => ProviderScope(
        overrides: [
          // Synchronous on purpose: the production provider awaits a token, and a
          // test that pumped a pending future would read null headers and pass for
          // the wrong reason.
          signedImageHeadersProvider.overrideWith((ref) => headers),
          apiBaseUrlProvider.overrideWithValue('http://api.test/api/v1'),
        ],
        child: MaterialApp(
          locale: const Locale('en'),
          theme: JawwidTheme.light(isArabic: false),
          supportedLocales: JawwidApp.supportedLocales,
          localizationsDelegates: const [
            L10n.delegate,
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
          home: Scaffold(body: child),
        ),
      );

  /// The provider `Image.network` actually fetches with.
  ///
  /// `cacheWidth`/`cacheHeight` make `Image.network` wrap the provider in a
  /// `ResizeImage`, so unwrap one layer before reading the headers.
  NetworkImage networkImage(WidgetTester tester) {
    final provider = tester.widget<Image>(find.byType(Image)).image;
    return (provider is ResizeImage ? provider.imageProvider : provider)
        as NetworkImage;
  }

  bool sendsBearer(WidgetTester tester) =>
      networkImage(tester).headers?.containsKey('Authorization') ?? false;

  Conversation conversation(String? avatarUrl) => Conversation(
        id: 'c_1',
        kind: ConversationKind.studentGroup,
        title: 'Ahmed Hassan',
        updatedAt: DateTime.utc(2026, 10, 8),
        avatarUrl: avatarUrl,
      );

  ProfileView profile(String? avatarUrl) => ProfileView(
        audience: ProfileAudience.other,
        isGroup: false,
        subject: ProfilePerson(
          id: 'p_1',
          displayName: 'Ahmed Hassan',
          role: ParticipantRole.teacher,
          avatarUrl: avatarUrl,
        ),
      );

  ProfilePerson member(String? avatarUrl) => ProfilePerson(
        id: 'p_2',
        displayName: 'Umm Yusuf',
        role: ParticipantRole.parent,
        avatarUrl: avatarUrl,
      );

  group('the chat list row', () {
    testWidgets('a STABLE avatar url is fetched WITH the session token',
        (tester) async {
      await tester.pumpWidget(harness(
        ConversationTile(
          conversation: conversation(stableUrl),
          now: DateTime.utc(2026, 10, 8),
        ),
      ));

      expect(networkImage(tester).headers?['Authorization'],
          'Bearer session-token',
          reason: 'a stable application URL carries no credential of its own');
    });

    testWidgets('a PRESIGNED avatar url is fetched with NO token',
        (tester) async {
      await tester.pumpWidget(harness(
        ConversationTile(
          conversation: conversation(presignedUrl),
          now: DateTime.utc(2026, 10, 8),
        ),
      ));

      expect(sendsBearer(tester), isFalse,
          reason: 'SigV4 in the query string IS the authentication');
    });

    testWidgets('no avatar url fetches no image at all', (tester) async {
      await tester.pumpWidget(harness(
        ConversationTile(
          conversation: conversation(null),
          now: DateTime.utc(2026, 10, 8),
        ),
      ));

      expect(find.byType(Image), findsNothing,
          reason: 'initials, not a request with a null URL');
    });
  });

  group('the group info header', () {
    testWidgets('a STABLE avatar url is fetched WITH the session token',
        (tester) async {
      await tester.pumpWidget(harness(ProfileHeader(view: profile(stableUrl))));

      expect(networkImage(tester).headers?['Authorization'],
          'Bearer session-token');
    });

    testWidgets('a PRESIGNED avatar url is fetched with NO token',
        (tester) async {
      await tester
          .pumpWidget(harness(ProfileHeader(view: profile(presignedUrl))));

      expect(sendsBearer(tester), isFalse);
    });
  });

  group('a group member row', () {
    testWidgets('a STABLE avatar url is fetched WITH the session token',
        (tester) async {
      await tester.pumpWidget(harness(MemberTile(member: member(stableUrl))));

      expect(networkImage(tester).headers?['Authorization'],
          'Bearer session-token');
    });

    testWidgets('a PRESIGNED avatar url is fetched with NO token',
        (tester) async {
      await tester.pumpWidget(harness(MemberTile(member: member(presignedUrl))));

      expect(sendsBearer(tester), isFalse);
    });
  });

  group('the open conversation header', () {
    /// The header avatar must come from the SAME conversation record the chat list row
    /// renders, resolved through the route — the header used to pass a title and nothing
    /// else, so it showed initials even for a conversation that had a photo.
    testWidgets('the route hands the conversation photo to the header',
        (tester) async {
      final backend = FakeBackend(role: UserRole.parent);
      addTearDown(backend.dispose);
      final id = backend.listConversations().first.id;

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            signedImageHeadersProvider.overrideWith((ref) => headers),
            apiBaseUrlProvider.overrideWithValue('http://api.test/api/v1'),
            conversationRepositoryProvider
                .overrideWithValue(_WithAvatar(backend, stableUrl)),
            messageRepositoryProvider
                .overrideWithValue(FakeMessageRepository(backend)),
          ],
          child: MaterialApp(
            locale: const Locale('en'),
            theme: JawwidTheme.light(isArabic: false),
            supportedLocales: JawwidApp.supportedLocales,
            localizationsDelegates: const [
              L10n.delegate,
              GlobalMaterialLocalizations.delegate,
              GlobalWidgetsLocalizations.delegate,
              GlobalCupertinoLocalizations.delegate,
            ],
            home: ChatScreenRoute(conversationId: id),
          ),
        ),
      );
      await tester.pumpAndSettle();

      final avatar = tester
          .widgetList<JawwidAvatar>(find.byType(JawwidAvatar))
          .where((a) => a.imageUrl != null);
      expect(avatar, isNotEmpty,
          reason: 'the header avatar received no URL from the route');
      expect(avatar.first.imageUrl, stableUrl);
      expect(avatar.first.imageHeaders?['Authorization'],
          'Bearer session-token');
    });
  });

  group('when there is no session', () {
    testWidgets('the avatar falls back to initials rather than a 401 image',
        (tester) async {
      // No override at all: `realtimeTokenProvider` throws by contract, the future
      // resolves to an error, and `.value` is null. The avatar must still build.
      await tester.pumpWidget(
        ProviderScope(
          child: MaterialApp(
            locale: const Locale('en'),
            theme: JawwidTheme.light(isArabic: false),
            supportedLocales: JawwidApp.supportedLocales,
            localizationsDelegates: const [
              L10n.delegate,
              GlobalMaterialLocalizations.delegate,
              GlobalWidgetsLocalizations.delegate,
              GlobalCupertinoLocalizations.delegate,
            ],
            home: Scaffold(
              body: ConversationTile(
                conversation: conversation(stableUrl),
                now: DateTime.utc(2026, 10, 8),
              ),
            ),
          ),
        ),
      );

      expect(tester.takeException(), isNull,
          reason: 'a missing token must not take down the chat list');
      expect(sendsBearer(tester), isFalse);
    });
  });
}

/// A conversation repository whose `byId` answers with a chosen avatar URL.
///
/// `Conversation.copyWith` deliberately exposes only the flags the UI toggles, so the
/// record is rebuilt field by field rather than widening a production model for a test.
class _WithAvatar extends FakeConversationRepository {
  _WithAvatar(super.backend, this.avatarUrl);

  final String? avatarUrl;

  @override
  Future<Conversation> byId(String conversationId) async {
    final c = await super.byId(conversationId);
    return Conversation(
      id: c.id,
      kind: c.kind,
      title: c.title,
      updatedAt: c.updatedAt,
      avatarUrl: avatarUrl,
      learner: c.learner,
      lastMessagePreview: c.lastMessagePreview,
      lastMessageAt: c.lastMessageAt,
      unreadCount: c.unreadCount,
      isPinned: c.isPinned,
      isMuted: c.isMuted,
      isArchived: c.isArchived,
      handledByLabel: c.handledByLabel,
      requiresApproval: c.requiresApproval,
      isReadOnly: c.isReadOnly,
    );
  }
}
