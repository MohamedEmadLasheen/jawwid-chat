import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/features/messages/application/messages_controller.dart';
import 'package:jawwid_chat/shared/models/message.dart';

/// A repository that records what it was asked to send and can be told to fail.
class _RecordingMessageRepository implements MessageRepository {
  final sent = <OutgoingMessage>[];
  final history_ = <Message>[];

  AppError? failWith;
  int failuresRemaining = 0;
  int _sequence = 0;

  /// Every voice note this repository was asked to upload, so a test can prove
  /// a retry did not push the same bytes twice.
  final uploads = <PendingVoiceNote>[];
  AppError? uploadFailure;
  int uploadFailuresRemaining = 0;

  @override
  Future<Page<Message>> history(
    String conversationId, {
    String? beforeCursor,
    int limit = 30,
  }) async =>
      Page(items: List.of(history_), hasMore: false);

  @override
  Future<List<Message>> since(
    String conversationId, {
    required int afterSequence,
  }) async =>
      history_.where((m) => (m.sequence ?? 0) > afterSequence).toList();

  @override
  Future<Message> send(OutgoingMessage message) async {
    sent.add(message);

    if (failuresRemaining > 0) {
      failuresRemaining--;
      throw failWith ?? const AppError(AppErrorKind.network);
    }

    // Idempotent: the same client id yields the same server message.
    final existing =
        history_.where((m) => m.clientMessageId == message.clientMessageId);
    if (existing.isNotEmpty) return existing.first;

    final confirmed = Message(
      id: 'srv_${++_sequence}',
      clientMessageId: message.clientMessageId,
      conversationId: message.conversationId,
      sequence: _sequence,
      kind: message.kind,
      body: message.body,
      attachments: [
        for (final a in message.attachments)
          Attachment(
            id: 'att_${a.objectKey}',
            kind: a.kind,
            mimeType: a.mimeType,
            byteSize: a.byteSize,
            durationMs: a.durationMs,
            url: 'https://signed.invalid/${a.objectKey}',
          ),
      ],
      createdAt: DateTime.utc(2026, 9, 5, 12, _sequence),
      deliveryState: DeliveryState.sent,
      isMine: true,
    );
    history_.add(confirmed);
    return confirmed;
  }

  @override
  Future<UploadedAttachment> uploadVoiceNote({
    required String conversationId,
    required PendingVoiceNote note,
  }) async {
    uploads.add(note);

    if (uploadFailuresRemaining > 0) {
      uploadFailuresRemaining--;
      throw uploadFailure ?? const AppError(AppErrorKind.network);
    }

    return UploadedAttachment(
      kind: MessageKind.voice,
      objectKey: 'conversations/$conversationId/voice_${uploads.length}',
      mimeType: note.mimeType,
      byteSize: note.byteSize,
      durationMs: note.duration.inMilliseconds,
    );
  }

  @override
  Future<UploadedAttachment> uploadAttachment({
    required String conversationId,
    required PendingAttachment attachment,
  }) async {
    attachmentUploads.add(attachment);
    if (uploadFailuresRemaining > 0) {
      uploadFailuresRemaining--;
      throw uploadFailure ?? const AppError(AppErrorKind.network);
    }

    return UploadedAttachment(
      kind: attachment.kind,
      objectKey:
          'conversations/$conversationId/${attachment.kind.name}_${attachmentUploads.length}',
      mimeType: attachment.mimeType,
      byteSize: attachment.byteSize,
    );
  }

  /// Every photo or document handed to the upload step, in order.
  final attachmentUploads = <PendingAttachment>[];

  @override
  Future<void> react({
    required String conversationId,
    required String messageId,
    required String emoji,
  }) async {
    reactions.add((messageId, emoji));
  }

  @override
  Future<void> removeReaction({
    required String conversationId,
    required String messageId,
    required String emoji,
  }) async {
    reactionRemovals.add((messageId, emoji));
  }

  /// (messageId, emoji) for every reaction added and removed.
  final reactions = <(String, String)>[];
  final reactionRemovals = <(String, String)>[];

  @override
  Future<void> deleteForMe({
    required String conversationId,
    required String messageId,
  }) async {
    deletedForMe.add(messageId);
    if (deleteFailure != null) throw deleteFailure!;
  }

  @override
  Future<void> deleteForEveryone({
    required String conversationId,
    required String messageId,
  }) async {
    deletedForEveryone.add(messageId);
    if (deleteFailure != null) throw deleteFailure!;
  }

  final deletedForMe = <String>[];
  final deletedForEveryone = <String>[];

  /// Set to make either delete refuse, so the rollback path is reachable.
  AppError? deleteFailure;

  @override
  Future<void> setTyping(String conversationId, {required bool isTyping}) async {}
}

void main() {
  late _RecordingMessageRepository repository;
  late ProviderContainer container;

  setUp(() {
    repository = _RecordingMessageRepository();
    container = ProviderContainer(
      overrides: [messageRepositoryProvider.overrideWithValue(repository)],
    );
  });

  tearDown(() => container.dispose());

  MessagesController controller() =>
      container.read(messagesControllerProvider('c1').notifier);

  MessagesState read() => container.read(messagesControllerProvider('c1'));

  /// Let the microtask queue and any zero-length timers run.
  Future<void> settle() => Future<void>.delayed(const Duration(milliseconds: 10));

  group('sending', () {
    test('echoes the message immediately as queued, never as sent', () async {
      final c = controller();
      await settle();

      c.send('السلام عليكم');

      final echo = read().log.messages.single;
      expect(echo.deliveryState.isLocal, isTrue);
      expect(
        echo.deliveryState,
        anyOf(DeliveryState.queued, DeliveryState.sending),
        reason: 'the client may only author queued/sending/failed',
      );
      expect(echo.sequence, isNull, reason: 'ordering is the server\'s to assign');
    });

    test('the confirmed message replaces the echo rather than duplicating it', () async {
      final c = controller();
      await settle();

      c.send('مرحبا');
      await settle();

      expect(read().log.length, 1);
      expect(read().log.messages.single.deliveryState, DeliveryState.sent);
      expect(read().log.messages.single.sequence, 1);
    });

    test('a retry reuses the same client message id', () async {
      final c = controller();
      await settle();

      repository.failuresRemaining = 1;
      final clientId = c.send('مرحبا');
      await settle();

      expect(read().log.byClientId(clientId)?.deliveryState, DeliveryState.failed);

      await c.retry(clientId);
      await settle();

      expect(repository.sent, hasLength(2));
      expect(
        repository.sent.map((m) => m.clientMessageId).toSet(),
        {clientId},
        reason: 'the server must see one id so it can deduplicate',
      );
      expect(read().log.length, 1, reason: 'no duplicate message may appear');
    });

    test('each composed message gets its own id', () async {
      final c = controller();
      await settle();

      final first = c.send('one');
      await settle();
      final second = c.send('two');
      await settle();

      expect(first, isNot(second));
      expect(read().log.length, 2);
    });
  });

  group('failure handling', () {
    test('a network failure marks the message failed and flags offline', () async {
      final c = controller();
      await settle();

      repository.failuresRemaining = 1;
      final clientId = c.send('مرحبا');
      await settle();

      expect(read().log.byClientId(clientId)?.deliveryState, DeliveryState.failed);
      expect(read().isOffline, isTrue);
      expect(read().log.byClientId(clientId)?.canRetry, isTrue);
    });

    test('a policy refusal is not retried automatically', () async {
      final c = controller();
      await settle();

      repository.failWith =
          const AppError(AppErrorKind.forbidden, code: 'not_allowed');
      repository.failuresRemaining = 1;

      c.send('مرحبا');
      await settle();
      await settle();

      expect(
        repository.sent,
        hasLength(1),
        reason: 'a forbidden send would fail identically forever',
      );
      expect(read().isOffline, isFalse);
    });

    test('a discarded message is gone: no "deleted" ghost, and what waited behind it goes (PARENT-005)', () async {
      final c = controller();
      await settle();

      repository.failuresRemaining = 1;
      final first = c.send('one');
      await settle();
      // `one` backs off and holds its place; `two` waits behind it.
      final second = c.send('two');
      await settle();
      expect(repository.sent.map((m) => m.body), ['one']);

      c.discard(first);
      await settle();
      expect(read().log.byClientId(first), isNull, reason: 'a never-sent message leaves no bubble');
      expect(read().log.byClientId(second)?.deliveryState, DeliveryState.sent);
      expect(repository.sent.map((m) => m.body), ['one', 'two']);
    });
  });

  group('a failed attachment never holds up the chat (PARENT-005)', () {
    const photo = PendingAttachment(filePath: '/tmp/p.jpg', kind: MessageKind.image, mimeType: 'image/jpeg', byteSize: 1200);

    test('a photo whose upload failed steps aside: the text sent after it is delivered', () async {
      final c = controller();
      await settle();

      repository.uploadFailuresRemaining = 1;
      final photoId = c.sendAttachment(photo);
      await settle();
      expect(read().log.byClientId(photoId)?.deliveryState, DeliveryState.failed);

      final textId = c.send('and a text');
      await settle();
      expect(read().log.byClientId(textId)?.deliveryState, DeliveryState.sent);
      expect(repository.sent.map((m) => m.body), ['and a text']);
      // The photo keeps its own Retry.
      expect(read().log.byClientId(photoId)?.canRetry, isTrue);
    });

    test('a photo parked after its upload ran out of time is not re-sent on its own, and does not hold the text', () async {
      final c = controller();
      await settle();

      repository
        ..uploadFailure = const AppError(AppErrorKind.timeout, code: AppError.uploadTimeout)
        ..uploadFailuresRemaining = 1;
      c.sendAttachment(photo);
      await settle();

      final textId = c.send('text');
      await settle();
      await settle();
      expect(read().log.byClientId(textId)?.deliveryState, DeliveryState.sent);
      expect(repository.attachmentUploads, hasLength(1), reason: 'parked: only an explicit retry uploads it again');
    });

    test('discarding the failed photo removes it, and its retry is never scheduled again', () async {
      final c = controller();
      await settle();

      repository.uploadFailuresRemaining = 1;
      final photoId = c.sendAttachment(photo);
      await settle();
      c.discard(photoId);
      await settle();
      expect(read().log.byClientId(photoId), isNull);
      expect(read().log.messages, isEmpty);
    });

    test('storage that cannot be reached is not "offline": the API answered (no banner)', () async {
      final c = controller();
      await settle();

      repository.uploadFailuresRemaining = 1;
      c.sendAttachment(photo);
      await settle();
      expect(read().isOffline, isFalse);
    });
  });

  group('history and resync', () {
    test('loads the first page into the log', () async {
      repository.history_.add(
        Message(
          id: 'srv_seed',
          clientMessageId: 'seed',
          conversationId: 'c1',
          sequence: 1,
          kind: MessageKind.text,
          body: 'أهلا',
          createdAt: DateTime.utc(2026, 9, 5),
          deliveryState: DeliveryState.delivered,
        ),
      );

      controller();
      await settle();

      expect(read().log.length, 1);
      expect(read().isLoadingInitial, isFalse);
    });

    test('resync fetches only what came after the highest known sequence', () async {
      final c = controller();
      await settle();

      c.send('first');
      await settle();

      repository.history_.add(
        Message(
          id: 'srv_new',
          clientMessageId: 'from_other_device',
          conversationId: 'c1',
          sequence: 99,
          kind: MessageKind.text,
          body: 'رسالة جديدة',
          createdAt: DateTime.utc(2026, 9, 5, 13),
          deliveryState: DeliveryState.delivered,
        ),
      );

      await c.resync();

      expect(read().log.length, 2);
      expect(read().log.highestSequence, 99);
    });

    test('a realtime arrival for another conversation is ignored', () async {
      final c = controller();
      await settle();

      c.onRealtimeMessage(
        Message(
          id: 'srv_x',
          clientMessageId: 'elsewhere',
          conversationId: 'OTHER',
          sequence: 5,
          kind: MessageKind.text,
          createdAt: DateTime.utc(2026, 9, 5),
          deliveryState: DeliveryState.delivered,
        ),
      );

      expect(read().log.isEmpty, isTrue);
    });
  });
}
