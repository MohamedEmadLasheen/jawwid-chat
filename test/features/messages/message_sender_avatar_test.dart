import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/design/tokens.dart';
import 'package:jawwid_chat/design/widgets/jawwid_avatar.dart';
import 'package:jawwid_chat/features/messages/presentation/message_bubble.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/message.dart';
import 'package:jawwid_chat/shared/models/system_event.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

/// A group message shows who sent it — by name AND by face.
///
/// The chat named its senders but never pictured them, so a parent read "QA Admin" and
/// "QA Teacher" above anonymous initials. What is worth protecting here is not that a circle
/// appears, but the three ways this can go wrong:
///
///  * the face belonging to a DIFFERENT person than the name above it;
///  * the identity repeating on every bubble of a run, which is visual noise; and
///  * a sender with no photo losing their initials, or an outgoing message growing an
///    avatar it never had.
void main() {
  Message incoming({
    String name = 'QA Teacher',
    String? avatarUrl,
    ParticipantRole role = ParticipantRole.teacher,
    String authorId = 'actor-teacher',
    String body = 'hello',
    MessageKind kind = MessageKind.text,
  }) {
    return Message(
      clientMessageId: 'c-$authorId-$body',
      conversationId: 'conv-1',
      authorId: authorId,
      authorName: name,
      authorRole: role,
      authorAvatarUrl: avatarUrl,
      kind: kind,
      body: body,
      createdAt: DateTime(2026, 3, 11, 14, 5),
      deliveryState: DeliveryState.sent,
      isMine: false,
    );
  }

  Message mine() => Message(
        clientMessageId: 'c-mine',
        conversationId: 'conv-1',
        authorId: 'actor-parent',
        authorName: 'QA Parent',
        authorRole: ParticipantRole.parent,
        authorAvatarUrl: 'https://storage.test/avatars/parent?sig=x',
        kind: MessageKind.text,
        body: 'mine',
        createdAt: DateTime(2026, 3, 11, 14, 6),
        deliveryState: DeliveryState.sent,
        isMine: true,
      );

  Widget harness(
    Message m, {
    bool showAuthor = true,
    Locale locale = const Locale('en'),
    ThemeData? theme,
  }) {
    return MaterialApp(
      locale: locale,
      theme: theme ?? JawwidTheme.light(isArabic: locale.languageCode == 'ar'),
      supportedLocales: JawwidApp.supportedLocales,
      localizationsDelegates: const [
        L10n.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      home: Scaffold(body: MessageBubble(message: m, showAuthor: showAuthor)),
    );
  }

  JawwidAvatar? avatarOf(WidgetTester tester) {
    final found = find.byType(JawwidAvatar);
    return found.evaluate().isEmpty ? null : tester.widget<JawwidAvatar>(found.first);
  }

  // -------------------------------------------------------------------------
  group('the face matches the name', () {
    testWidgets('a teacher with a photo shows it beside their message', (tester) async {
      const url = 'https://storage.test/avatars/teacher?expires=1&sig=abc';
      await tester.pumpWidget(harness(incoming(avatarUrl: url)));
      await tester.pumpAndSettle();

      expect(avatarOf(tester)!.imageUrl, url);
      expect(find.text('QA Teacher'), findsOneWidget);
    });

    testWidgets('an admin with a photo shows THEIR photo, not the teacher\'s',
        (tester) async {
      const adminUrl = 'https://storage.test/avatars/admin?sig=admin';
      await tester.pumpWidget(harness(incoming(
        name: 'QA Admin',
        role: ParticipantRole.admin,
        authorId: 'actor-admin',
        avatarUrl: adminUrl,
      )));
      await tester.pumpAndSettle();

      final avatar = avatarOf(tester)!;
      expect(avatar.imageUrl, adminUrl);
      // The avatar's own fallback name is the sender's, so even when the image fails the
      // initials belong to the right person.
      expect(avatar.displayName, 'QA Admin');
      expect(find.text('QA Admin'), findsOneWidget);
    });

    testWidgets('the avatar takes its name from the SAME label the bubble prints',
        (tester) async {
      // The anti-mismatch property. Both come from one message, so a rename cannot leave
      // the face captioned by somebody else.
      await tester.pumpWidget(harness(incoming(name: 'عبد الرحمن')));
      await tester.pumpAndSettle();

      expect(avatarOf(tester)!.displayName, 'عبد الرحمن');
      expect(find.text('عبد الرحمن'), findsOneWidget);
    });

    testWidgets('an unresolved sender falls back to a role word, and so does the avatar',
        (tester) async {
      await tester.pumpWidget(harness(incoming(name: '', avatarUrl: null)));
      await tester.pumpAndSettle();

      final l10n = await L10n.delegate.load(const Locale('en'));
      // §25: never the actor id, for either the label or the initials.
      expect(avatarOf(tester)!.displayName, l10n.groupMemberRoleTeacher);
      expect(find.textContaining('actor-'), findsNothing);
    });
  });

  // -------------------------------------------------------------------------
  group('no photo is not a broken state', () {
    testWidgets('a sender without a photo still gets a circle, with initials',
        (tester) async {
      await tester.pumpWidget(harness(incoming(avatarUrl: null)));
      await tester.pumpAndSettle();

      final avatar = avatarOf(tester)!;
      expect(avatar.imageUrl, isNull);
      expect(avatar.displayName, 'QA Teacher');
    });

    testWidgets('an empty url is treated as no photo', (tester) async {
      await tester.pumpWidget(harness(incoming(avatarUrl: '')));
      await tester.pumpAndSettle();

      // The mapper normalises blank to null; a bubble handed one anyway must not ask the
      // network for the empty string.
      expect(avatarOf(tester)?.imageUrl ?? '', anyOf(isNull, isEmpty));
      expect(tester.takeException(), isNull);
    });
  });

  // -------------------------------------------------------------------------
  group('grouping is reused, not reinvented', () {
    testWidgets('a consecutive message from the same sender shows NO second avatar',
        (tester) async {
      await tester.pumpWidget(harness(
        incoming(avatarUrl: 'https://storage.test/avatars/t?sig=x'),
        showAuthor: false,
      ));
      await tester.pumpAndSettle();

      // Neither the name nor the face repeats: one boundary governs both.
      expect(find.byType(JawwidAvatar), findsNothing);
      expect(find.text('QA Teacher'), findsNothing);
    });

    testWidgets('the gutter is still reserved, so a run does not shift sideways',
        (tester) async {
      // Without the reserved space, the second bubble in a run would slide left and the
      // conversation would look ragged.
      await tester.pumpWidget(harness(incoming(), showAuthor: true));
      await tester.pumpAndSettle();
      final withAvatar = tester.getTopLeft(find.byType(AnimatedContainer).first).dx;

      await tester.pumpWidget(harness(incoming(), showAuthor: false));
      await tester.pumpAndSettle();
      final withoutAvatar = tester.getTopLeft(find.byType(AnimatedContainer).first).dx;

      expect(withoutAvatar, withAvatar);
    });

    testWidgets('the reserved gutter is exactly one avatar wide', (tester) async {
      await tester.pumpWidget(harness(incoming(), showAuthor: true));
      await tester.pumpAndSettle();

      final box = tester.getSize(find.byType(JawwidAvatar).first);
      expect(box.width, Sizes.avatarSm);
    });
  });

  // -------------------------------------------------------------------------
  group('what must NOT grow an avatar', () {
    testWidgets('my own outgoing message has none, and no gutter', (tester) async {
      await tester.pumpWidget(harness(mine(), showAuthor: true));
      await tester.pumpAndSettle();

      // Outgoing geometry is untouched: no avatar even though the message carries a url.
      expect(find.byType(JawwidAvatar), findsNothing);
    });

    testWidgets('a system message is not a sender message', (tester) async {
      final system = Message(
        clientMessageId: 'c-sys',
        conversationId: 'conv-1',
        authorId: null,
        authorName: '',
        authorRole: ParticipantRole.system,
        kind: MessageKind.system,
        body: '',
        systemEvent: const SystemEvent(kind: 'group.created', params: {'learner': 'Adam QA'}),
        createdAt: DateTime(2026, 3, 11, 9, 0),
        deliveryState: DeliveryState.sent,
        isMine: false,
      );

      await tester.pumpWidget(harness(system, showAuthor: true));
      await tester.pumpAndSettle();

      // It returns as a system line before a bubble is ever built, so there is nowhere for
      // an avatar to appear.
      expect(find.byType(JawwidAvatar), findsNothing);
      expect(tester.takeException(), isNull);
    });
  });

  // -------------------------------------------------------------------------
  group('media messages keep their sender identity', () {
    testWidgets('an image message still shows the sender avatar', (tester) async {
      final withPhoto = Message(
        clientMessageId: 'c-img',
        conversationId: 'conv-1',
        authorId: 'actor-teacher',
        authorName: 'QA Teacher',
        authorRole: ParticipantRole.teacher,
        authorAvatarUrl: 'https://storage.test/avatars/t?sig=x',
        kind: MessageKind.image,
        body: '',
        attachments: const [
          Attachment(
            id: 'a1',
            kind: MessageKind.image,
            url: 'https://storage.test/img.jpg?sig=y',
            fileName: 'img.jpg',
          ),
        ],
        createdAt: DateTime(2026, 3, 11, 14, 7),
        deliveryState: DeliveryState.sent,
        isMine: false,
      );

      await tester.pumpWidget(harness(withPhoto));
      await tester.pumpAndSettle();

      expect(avatarOf(tester)!.imageUrl, 'https://storage.test/avatars/t?sig=x');
      expect(tester.takeException(), isNull);
    });
  });

  // -------------------------------------------------------------------------
  group('direction and theme', () {
    testWidgets('Arabic puts the avatar on the trailing side without mirroring code',
        (tester) async {
      await tester.pumpWidget(harness(
        incoming(name: 'المعلمة'),
        locale: const Locale('ar'),
      ));
      await tester.pumpAndSettle();

      final avatarX = tester.getCenter(find.byType(JawwidAvatar).first).dx;
      final bubbleX = tester.getCenter(find.byType(AnimatedContainer).first).dx;

      // Row follows the ambient direction: in RTL the avatar sits to the RIGHT of the bubble.
      expect(avatarX, greaterThan(bubbleX));
      expect(
        Directionality.of(tester.element(find.byType(JawwidAvatar).first)),
        TextDirection.rtl,
      );
    });

    for (final (label, theme) in [
      ('light', JawwidTheme.light(isArabic: false)),
      ('dark', JawwidTheme.dark(isArabic: false)),
    ]) {
      testWidgets('$label renders the sender avatar without exception', (tester) async {
        await tester.pumpWidget(harness(
          incoming(avatarUrl: 'https://storage.test/avatars/t?sig=x'),
          theme: theme,
        ));
        await tester.pumpAndSettle();

        expect(find.byType(JawwidAvatar), findsOneWidget);
        expect(tester.takeException(), isNull);
      });
    }

    testWidgets('a long sender name does not overflow beside the avatar', (tester) async {
      await tester.pumpWidget(harness(incoming(name: 'عبد الرحمن ' * 10)));
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
    });
  });
}
