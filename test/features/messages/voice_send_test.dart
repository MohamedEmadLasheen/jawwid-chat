import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/features/messages/application/messages_controller.dart';
import 'package:jawwid_chat/shared/models/message.dart';

/// A repository that records uploads and sends separately, so a test can tell
/// which of the two a retry repeated.
class _VoiceRepository implements MessageRepository {
  final sent = <OutgoingMessage>[];
  final uploads = <PendingVoiceNote>[];
  final history_ = <Message>[];

  int uploadFailures = 0;
  int sendFailures = 0;
  int _sequence = 0;

  @override
  Future<Page<Message>> history(
    String conversationId, {
    String? beforeCursor,
    int limit = 30,
  }) async =>
      Page(items: List.of(history_), hasMore: false);

  @override
  Future<List<Message>> since(String conversationId, {required int afterSequence}) async =>
      history_.where((m) => (m.sequence ?? 0) > afterSequence).toList();

  @override
  Future<UploadedAttachment> uploadVoiceNote({
    required String conversationId,
    required PendingVoiceNote note,
  }) async {
    uploads.add(note);
    if (uploadFailures > 0) {
      uploadFailures--;
      throw const AppError(AppErrorKind.network);
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
  Future<Message> send(OutgoingMessage message) async {
    sent.add(message);
    if (sendFailures > 0) {
      sendFailures--;
      throw const AppError(AppErrorKind.network);
    }

    final existing = history_.where((m) => m.clientMessageId == message.clientMessageId);
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
  Future<UploadedAttachment> uploadAttachment({
    required String conversationId,
    required PendingAttachment attachment,
  }) async {
    attachmentUploads.add(attachment);
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
  const conversationId = 'conv_1';

  late _VoiceRepository repository;
  late ProviderContainer container;
  late Directory scratch;

  setUp(() {
    repository = _VoiceRepository();
    container = ProviderContainer(
      overrides: [messageRepositoryProvider.overrideWithValue(repository)],
    );
    scratch = Directory.systemTemp.createTempSync('jawwid_voice_send');
  });

  tearDown(() {
    container.dispose();
    if (scratch.existsSync()) scratch.deleteSync(recursive: true);
  });

  PendingVoiceNote note({Duration duration = const Duration(seconds: 4)}) {
    final file = File('${scratch.path}/note_${DateTime.now().microsecondsSinceEpoch}.ogg')
      ..writeAsBytesSync(List<int>.filled(1024, 3));
    return PendingVoiceNote(
      filePath: file.path,
      mimeType: 'audio/ogg',
      byteSize: file.lengthSync(),
      duration: duration,
    );
  }

  MessagesController controller() =>
      container.read(messagesControllerProvider(conversationId).notifier);
  MessagesState state() => container.read(messagesControllerProvider(conversationId));

  Future<void> settle() => Future<void>.delayed(const Duration(milliseconds: 20));

  group('sending a voice message', () {
    test('appears in the log immediately, before any upload', () async {
      final id = controller().sendVoice(note());

      final echo = state().log.messages.singleWhere((m) => m.clientMessageId == id);
      expect(echo.kind, MessageKind.voice);
      expect(echo.deliveryState.isLocal, isTrue);
      // The echo points at the local file so the sender can replay their own
      // note while it is still uploading.
      expect(echo.attachments.single.isLocal, isTrue);
      expect(echo.attachments.single.durationMs, 4000);
    });

    test('uploads the bytes, then sends the object key', () async {
      controller().sendVoice(note());
      await settle();

      expect(repository.uploads, hasLength(1));
      expect(repository.sent, hasLength(1));

      final outgoing = repository.sent.single;
      expect(outgoing.kind, MessageKind.voice);
      expect(outgoing.attachments.single.objectKey, isNotEmpty);
      expect(outgoing.attachments.single.durationMs, 4000);
      // The recording is gone from the payload once it is in storage.
      expect(outgoing.needsUpload, isFalse);
    });

    test('the confirmed message carries the signed URL and replaces the echo', () async {
      final id = controller().sendVoice(note());
      await settle();

      final messages = state().log.messages.where((m) => m.clientMessageId == id);
      // Reconciled by client id: one bubble, not the echo plus the confirmation.
      expect(messages, hasLength(1));
      expect(messages.single.deliveryState, DeliveryState.sent);
      expect(messages.single.attachments.single.url, startsWith('https://'));
    });

    test('the temp recording is deleted once the message is sent', () async {
      final draft = note();
      controller().sendVoice(draft);
      await settle();
      await settle();

      expect(File(draft.filePath).existsSync(), isFalse);
    });
  });

  group('retries', () {
    test('a failed send is retried without uploading the bytes again', () async {
      repository.sendFailures = 1;

      final id = controller().sendVoice(note());
      await settle();
      expect(state().log.messages.single.deliveryState, DeliveryState.failed);
      expect(repository.uploads, hasLength(1));

      await controller().retry(id);
      await settle();

      // The second attempt re-sent the object key rather than pushing the same
      // audio a second time. This is the whole point of promoting the upload
      // into the queued payload.
      expect(repository.uploads, hasLength(1));
      expect(repository.sent, hasLength(2));
      expect(state().log.messages.single.deliveryState, DeliveryState.sent);
    });

    test('a failed upload leaves the message retryable and sends nothing', () async {
      repository.uploadFailures = 1;

      final id = controller().sendVoice(note());
      await settle();

      expect(state().log.messages.single.deliveryState, DeliveryState.failed);
      // Nothing was sent: a message whose audio never landed must not appear as
      // an empty voice bubble to anyone.
      expect(repository.sent, isEmpty);

      await controller().retry(id);
      await settle();

      expect(repository.uploads, hasLength(2));
      expect(repository.sent, hasLength(1));
      expect(state().log.messages.single.deliveryState, DeliveryState.sent);
    });

    test('the same client message id is reused across a retry', () async {
      repository.sendFailures = 1;
      final id = controller().sendVoice(note());
      await settle();
      await controller().retry(id);
      await settle();

      expect(repository.sent.map((m) => m.clientMessageId).toSet(), {id});
    });
  });

  group('duplicate suppression', () {
    test('a realtime arrival of our own note does not double the bubble', () async {
      final id = controller().sendVoice(note());
      await settle();

      final confirmed = repository.history_.single;
      controller().onRealtimeMessage(confirmed);

      expect(state().log.messages.where((m) => m.clientMessageId == id), hasLength(1));
    });

    test('an incoming voice note from someone else is added', () async {
      controller().onRealtimeMessage(
        Message(
          id: 'srv_incoming',
          clientMessageId: 'srv_incoming',
          conversationId: conversationId,
          sequence: 99,
          kind: MessageKind.voice,
          createdAt: DateTime.utc(2026, 9, 5, 13),
          deliveryState: DeliveryState.delivered,
          attachments: const [
            Attachment(
              id: 'att_incoming',
              kind: MessageKind.voice,
              url: 'https://signed.invalid/incoming',
              durationMs: 8000,
            ),
          ],
        ),
      );

      final incoming = state().log.messages.single;
      expect(incoming.kind, MessageKind.voice);
      expect(incoming.attachments.single.duration, const Duration(seconds: 8));
    });
  });

  group('discarding', () {
    test('discarding a queued voice note deletes its recording', () async {
      repository.sendFailures = 1;
      final draft = note();
      final id = controller().sendVoice(draft);
      await settle();

      controller().discard(id);
      await settle();

      expect(File(draft.filePath).existsSync(), isFalse);
    });
  });
}
