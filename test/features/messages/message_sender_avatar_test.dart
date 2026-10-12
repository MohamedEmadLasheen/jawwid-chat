import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/design/widgets/jawwid_avatar.dart';
import 'package:jawwid_chat/features/messages/presentation/message_bubble.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/message.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

/// The sender's face beside an incoming bubble (Tier 2, message-author half).
///
/// The author's photo is a SHORT-LIVED SIGNED url, minted for the response that carried
/// it — unlike `AuthUser.avatarUrl`, which is the stable endpoint for the signed-in actor
/// alone. So the bubble must not send a bearer with it: object storage refuses a request
/// carrying two auth types, and the fallback to initials would look exactly like "this
/// person has no photo".
void main() {
  const headers = {'Authorization': 'Bearer session-token'};
  const presigned = 'http://storage.test/avatars/teacher/t1/p.jpg'
      '?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=deadbeef';
  const reference = 'http://api.test/api/v1/storage/avatars%2Fteacher%2Ft1%2Fp.jpg'
      '?expires=1&sig=abc';

  Message message({
    String? authorAvatarUrl,
    bool isMine = false,
    String authorName = 'Ahmed Hassan',
  }) {
    return Message(
      id: 'srv_1',
      clientMessageId: 'cmid_1',
      conversationId: 'conv_1',
      sequence: 1,
      authorId: isMine ? 'me' : 'them',
      authorName: authorName,
      authorAvatarUrl: authorAvatarUrl,
      authorRole: ParticipantRole.teacher,
      kind: MessageKind.text,
      body: 'hello',
      createdAt: DateTime.utc(2026, 10, 11, 12),
      deliveryState: DeliveryState.delivered,
      isMine: isMine,
    );
  }

  Widget harness(Message m, {bool showAuthor = true, bool withSession = true}) {
    return ProviderScope(
      overrides: [
        if (withSession)
          // Synchronous on purpose: a pending future would read null headers and let a
          // test pass for the wrong reason.
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
        home: Scaffold(body: MessageBubble(message: m, showAuthor: showAuthor)),
      ),
    );
  }

  /// The provider `Image.network` actually fetches with.
  ///
  /// `cacheWidth`/`cacheHeight` make `Image.network` wrap the provider in a `ResizeImage`,
  /// so unwrap one layer before reading the headers.
  NetworkImage networkImage(WidgetTester tester) {
    final provider = tester.widget<Image>(find.byType(Image)).image;
    return (provider is ResizeImage ? provider.imageProvider : provider) as NetworkImage;
  }

  testWidgets('an incoming message shows the sender\'s photo', (tester) async {
    await tester.pumpWidget(harness(message(authorAvatarUrl: presigned)));

    expect(find.byType(JawwidAvatar), findsOneWidget);
    expect(networkImage(tester).url, presigned);
  });

  testWidgets('a PRESIGNED author photo is fetched with NO bearer', (tester) async {
    await tester.pumpWidget(harness(message(authorAvatarUrl: presigned)));

    expect(
      networkImage(tester).headers?.containsKey('Authorization') ?? false,
      isFalse,
      reason: 'SigV4 in the query string IS the authentication; two would be refused',
    );
  });

  testWidgets('a REFERENCE-storage author photo still gets the bearer', (tester) async {
    // The local signer's URLs carry `expires`/`sig`, not SigV4, so they are not
    // self-authenticating and the session token is what gets them served.
    await tester.pumpWidget(harness(message(authorAvatarUrl: reference)));

    expect(networkImage(tester).headers?['Authorization'], 'Bearer session-token');
  });

  testWidgets('an author with no photo falls back to initials, fetching nothing',
      (tester) async {
    await tester.pumpWidget(harness(message()));

    expect(find.byType(JawwidAvatar), findsOneWidget);
    expect(find.byType(Image), findsNothing);
  });

  testWidgets('my own message gets no avatar and no gutter', (tester) async {
    await tester.pumpWidget(harness(message(isMine: true, authorAvatarUrl: presigned)));

    expect(find.byType(JawwidAvatar), findsNothing,
        reason: 'you know who you are; the outgoing geometry is unchanged');
    expect(find.byType(Image), findsNothing);
  });

  testWidgets('a continuing run reserves the gutter but draws no second avatar',
      (tester) async {
    await tester.pumpWidget(
      harness(message(authorAvatarUrl: presigned), showAuthor: false),
    );

    // Same boundary that decides whether to print the name, reused rather than reinvented.
    expect(find.byType(JawwidAvatar), findsNothing);
    // The space is still reserved, so the thread does not shift sideways mid-run.
    expect(find.byType(SizedBox), findsWidgets);
  });

  testWidgets('with no session the bubble still renders, headers simply absent',
      (tester) async {
    await tester.pumpWidget(
      harness(message(authorAvatarUrl: reference), withSession: false),
    );

    expect(tester.takeException(), isNull,
        reason: 'a missing token must not take down the thread');
    expect(networkImage(tester).headers?.containsKey('Authorization') ?? false, isFalse);
  });
}
