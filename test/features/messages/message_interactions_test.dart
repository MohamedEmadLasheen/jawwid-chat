import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/data/fake_backend.dart';
import 'package:jawwid_chat/core/data/fake_repositories.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/features/conversations/application/conversations_controller.dart';
import 'package:jawwid_chat/features/messages/application/messages_controller.dart';
import 'package:jawwid_chat/shared/models/message.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

/// Acting on a message: reactions, deletes, photos and files, and the
/// bookkeeping that makes unread honest.
///
/// Every one of these applies optimistically. That is a deliberate trade for
/// this audience — see `MessagesController` — and the price of it is that the
/// rollback path has to be exercised as thoroughly as the happy one, because a
/// bubble silently reappearing is indistinguishable from a bug.
void main() {
  late FakeBackend backend;
  late ProviderContainer container;
  late Directory scratch;

  const conversationId = 'c_support';

  setUp(() {
    backend = FakeBackend(role: UserRole.parent);
    scratch = Directory.systemTemp.createTempSync('jawwid_attachment_test');
    container = ProviderContainer(
      overrides: [
        currentRoleProvider.overrideWithValue(UserRole.parent),
        conversationRepositoryProvider
            .overrideWithValue(FakeConversationRepository(backend)),
        messageRepositoryProvider
            .overrideWithValue(FakeMessageRepository(backend)),
      ],
    );
  });

  tearDown(() {
    container.dispose();
    backend.dispose();
    if (scratch.existsSync()) scratch.deleteSync(recursive: true);
  });

  MessagesController messages() =>
      container.read(messagesControllerProvider(conversationId).notifier);

  MessagesState read() =>
      container.read(messagesControllerProvider(conversationId));

  Future<void> settle() =>
      Future<void>.delayed(const Duration(milliseconds: 20));

  /// A real file on disk, because the upload path reads its bytes.
  PendingAttachment photoOnDisk({int bytes = 2048, String name = 'photo.jpg'}) {
    final file = File('${scratch.path}${Platform.pathSeparator}$name')
      ..writeAsBytesSync(List<int>.filled(bytes, 7));
    return PendingAttachment(
      filePath: file.path,
      kind: MessageKind.image,
      mimeType: 'image/jpeg',
      byteSize: bytes,
      fileName: name,
    );
  }

  group('reactions', () {
    test('a reaction appears immediately, before any round trip', () async {
      final controller = messages();
      await settle();

      final target = read().log.messages.first;
      final pending = controller.react(target, '❤️');

      final reacted = read().log.byServerId(target.id!)!;
      expect(reacted.reactions.single.emoji, '❤️');
      expect(reacted.reactions.single.mine, isTrue);
      expect(reacted.reactions.single.count, 1);

      await pending;
    });

    test('a second emoji replaces the first, because the server upserts',
        () async {
      final controller = messages();
      await settle();

      final target = read().log.messages.first;
      await controller.react(target, '❤️');
      await controller.react(read().log.byServerId(target.id!)!, '👍');

      final reacted = read().log.byServerId(target.id!)!;
      expect(
        reacted.reactions.map((r) => r.emoji),
        ['👍'],
        reason: 'one reaction per person per message',
      );
    });

    test('tapping the reaction you already left takes it off', () async {
      final controller = messages();
      await settle();

      final target = read().log.messages.first;
      await controller.toggleReaction(target, '👏');
      expect(read().log.byServerId(target.id!)!.reactions, hasLength(1));

      await controller.toggleReaction(read().log.byServerId(target.id!)!, '👏');
      expect(read().log.byServerId(target.id!)!.reactions, isEmpty);
    });

    test('a refused reaction rolls back and is re-thrown', () async {
      final controller = messages();
      await settle();

      final target = read().log.messages.first;
      backend.nextFailure = const AppError(AppErrorKind.network);

      await expectLater(
        controller.react(target, '❤️'),
        throwsA(isA<AppError>()),
        reason: 'the screen must be able to say the tap did not take',
      );
      expect(
        read().log.byServerId(target.id!)!.reactions,
        isEmpty,
        reason: 'an optimistic reaction that failed must not stay on screen',
      );
    });
  });

  group('deleting', () {
    test('delete for me hides the message here', () async {
      final controller = messages();
      await settle();

      final target = read().log.messages.first;
      await controller.deleteForMe(target);

      expect(read().log.byServerId(target.id!)!.isDeleted, isTrue);
    });

    test('a refused delete puts the message back', () async {
      final controller = messages();
      await settle();

      final target = read().log.messages.first;
      backend.nextFailure = const AppError(AppErrorKind.network);

      await expectLater(
        controller.deleteForMe(target),
        throwsA(isA<AppError>()),
      );
      expect(read().log.byServerId(target.id!)!.isDeleted, isFalse);
    });

    test('delete for everyone on someone else\'s message is refused by the '
        'backend and rolled back', () async {
      final controller = messages();
      await settle();

      // The seeded message is from Jawwid, not from this parent. The UI never
      // offers this — see message_actions_test — but the backend is the
      // authority, and this proves the client honours its refusal.
      final target = read().log.messages.first;
      expect(target.isMine, isFalse);

      await expectLater(
        controller.deleteForEveryone(target),
        throwsA(
          isA<AppError>().having(
            (e) => e.kind,
            'kind',
            AppErrorKind.forbidden,
          ),
        ),
      );
      expect(read().log.byServerId(target.id!)!.isDeleted, isFalse);
    });

    test('deleting a message still in the outbox discards it rather than '
        'calling an endpoint about a message nobody has', () async {
      final controller = messages();
      await settle();

      backend.persistentFailure = const AppError(AppErrorKind.network);
      final clientId = controller.send('لم تُرسل بعد');
      await settle();

      final queued = read().log.byClientId(clientId)!;
      expect(queued.id, isNull);

      await controller.deleteForMe(queued);
      expect(read().log.byClientId(clientId)!.isDeleted, isTrue);
    });
  });

  group('photos and files', () {
    test('a photo is echoed immediately, pointing at the local file', () async {
      final controller = messages();
      await settle();

      final photo = photoOnDisk();
      final clientId = controller.sendAttachment(photo);

      final echo = read().log.byClientId(clientId)!;
      expect(echo.kind, MessageKind.image);
      expect(echo.deliveryState.isLocal, isTrue);
      expect(
        echo.attachments.single.url,
        photo.filePath,
        reason: 'the sender sees their own photo while it uploads',
      );
      expect(echo.attachments.single.isLocal, isTrue);
    });

    test('the bytes go to storage before the message is sent', () async {
      final controller = messages();
      await settle();

      final photo = photoOnDisk();
      final clientId = controller.sendAttachment(photo);
      await settle();

      final confirmed = read().log.byClientId(clientId)!;
      expect(confirmed.deliveryState, DeliveryState.sent);
      // The confirmed attachment is addressed by what storage kept, not by the
      // path the user picked from — which is deleted or moved out from under
      // the app as soon as the picker's staging copy is cleaned up.
      expect(confirmed.attachments.single.url, isNot(photo.filePath));
    });

    test('a caption rides along in the same message', () async {
      final controller = messages();
      await settle();

      final clientId = controller.sendAttachment(
        photoOnDisk(),
        body: 'واجب أحمد',
      );
      await settle();

      expect(read().log.byClientId(clientId)!.body, 'واجب أحمد');
    });

    test('an over-size file is refused and the message is left failed, '
        'never silently dropped', () async {
      final controller = messages();
      await settle();

      // Past the 10 MiB image ceiling the backend enforces.
      final huge = PendingAttachment(
        filePath: photoOnDisk(bytes: 16).filePath,
        kind: MessageKind.image,
        mimeType: 'image/jpeg',
        byteSize: 11 * 1024 * 1024,
      );

      final clientId = controller.sendAttachment(huge);
      await settle();

      final failed = read().log.byClientId(clientId)!;
      expect(failed.deliveryState, DeliveryState.failed);
      expect(failed.canRetry, isTrue, reason: '§21 — never lose it silently');
    });

    test('a file keeps its name so the bubble has something to show', () async {
      final controller = messages();
      await settle();

      final document = PendingAttachment(
        filePath: photoOnDisk(name: 'Homework.pdf').filePath,
        kind: MessageKind.file,
        mimeType: 'application/pdf',
        byteSize: 2048,
        fileName: 'Homework.pdf',
      );

      final clientId = controller.sendAttachment(document);
      await settle();

      expect(
        read().log.byClientId(clientId)!.attachments.single.fileName,
        'Homework.pdf',
      );
    });
  });

  group('unread', () {
    test('marking read clears the badge and the total', () async {
      final conversations =
          container.read(conversationsControllerProvider.notifier);
      await container.read(conversationsControllerProvider.future);

      expect(container.read(totalUnreadProvider), greaterThan(0));

      await conversations.markRead(conversationId, throughSequence: 99);

      expect(container.read(totalUnreadProvider), 0);
    });

    test('a failure to record it is swallowed — the parent did read them',
        () async {
      final conversations =
          container.read(conversationsControllerProvider.notifier);
      await container.read(conversationsControllerProvider.future);

      backend.nextFailure = const AppError(AppErrorKind.network);

      // Must not throw: this is bookkeeping the user did not ask for.
      await conversations.markRead(conversationId, throughSequence: 99);
    });

    test('a conversation opened before the list loaded is still reported read',
        () async {
      // Straight from a notification: the chat screen is up before the
      // conversation list is. The badge must not survive that.
      final conversations =
          container.read(conversationsControllerProvider.notifier);

      await conversations.markRead('c_group_1', throughSequence: 99);

      await container.read(conversationsControllerProvider.future);
      final group = container
          .read(conversationsControllerProvider)
          .value!
          .expand((s) => s.conversations)
          .firstWhere((c) => c.id == 'c_group_1');
      expect(group.unreadCount, 0);
    });

    test('marking an already-read conversation does nothing', () async {
      final conversations =
          container.read(conversationsControllerProvider.notifier);
      await container.read(conversationsControllerProvider.future);

      await conversations.markRead(conversationId, throughSequence: 99);
      backend.persistentFailure = const AppError(AppErrorKind.server);

      // No second call, so the poisoned backend is never reached.
      await conversations.markRead(conversationId, throughSequence: 99);
      expect(container.read(totalUnreadProvider), 0);
    });
  });
}
