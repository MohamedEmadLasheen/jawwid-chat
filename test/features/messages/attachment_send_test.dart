import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/features/messages/application/attachment_draft.dart';
import 'package:jawwid_chat/features/messages/data/attachment_picker.dart';
import 'package:jawwid_chat/features/messages/domain/outgoing_attachment.dart';
import 'package:jawwid_chat/shared/models/message.dart';

/// Sending an attachment from the phone.
///
/// THE ORDERING THIS FILE PROTECTS. The bytes reach object storage BEFORE the
/// message is queued. That is the opposite of a text message, and it is what
/// keeps the offline guarantees honest: the outbox can persist a few hundred
/// bytes of metadata across a restart and cannot persist a 100 MB video, so a
/// message is only ever queued once its attachment is somewhere durable.
///
/// The consequence is a real limitation and is asserted as one: an attachment
/// cannot be composed offline. The user is told the upload failed and offered a
/// retry, rather than shown a queued bubble for bytes that never left the
/// device.
class _FakePicker implements AttachmentPicker {
  _FakePicker(this.result);
  PickedAttachment? result;

  @override
  Future<PickedAttachment?> pick() async => result;
}

class _RecordingAttachments implements AttachmentRepository {
  final authorized = <(String, String, String, int)>[];
  final uploaded = <String>[];

  AppError? failAuthorize;
  AppError? failUpload;
  int uploadCalls = 0;

  @override
  Future<UploadGrant> authorizeUpload({
    required String conversationId,
    required String kind,
    required String mimeType,
    required int byteSize,
  }) async {
    authorized.add((conversationId, kind, mimeType, byteSize));
    if (failAuthorize != null) throw failAuthorize!;
    return UploadGrant(
      // The SERVER mints the key, under the conversation's own prefix. The
      // client never composes one: an invented key is refused when the message
      // naming it is sent.
      objectKey: 'conversations/$conversationId/object-1',
      uploadUrl: 'https://storage.example/put',
      headers: {'content-type': mimeType},
      expiresAt: DateTime.now().add(const Duration(minutes: 5)),
    );
  }

  @override
  Future<void> putObject({
    required UploadGrant grant,
    required String filePath,
    void Function(int sent, int total)? onProgress,
  }) async {
    uploadCalls += 1;
    if (failUpload != null) throw failUpload!;
    onProgress?.call(50, 100);
    onProgress?.call(100, 100);
    uploaded.add(grant.objectKey);
  }
}

PickedAttachment picked({
  String name = 'photo.jpg',
  int size = 2048,
  MessageKind? kind = MessageKind.image,
  String? mime = 'image/jpeg',
}) =>
    PickedAttachment(
      path: '/tmp/$name',
      fileName: name,
      byteSize: size,
      kind: kind,
      mimeType: mime,
    );

void main() {
  late _FakePicker picker;
  late _RecordingAttachments attachments;
  late ProviderContainer container;

  const conversationId = 'conv-1';

  AttachmentDraftController controller() =>
      container.read(attachmentDraftProvider(conversationId).notifier);
  AttachmentDraft? draft() => container.read(attachmentDraftProvider(conversationId));

  setUp(() {
    picker = _FakePicker(picked());
    attachments = _RecordingAttachments();
    container = ProviderContainer(
      overrides: [
        attachmentPickerProvider.overrideWithValue(picker),
        attachmentRepositoryProvider.overrideWithValue(attachments),
      ],
    );
  });

  tearDown(() => container.dispose());

  group('selecting', () {
    test('an image is authorized and uploaded', () async {
      expect(await controller().pick(), isNull);

      expect(attachments.authorized, [(conversationId, 'image', 'image/jpeg', 2048)]);
      expect(attachments.uploaded, ['conversations/conv-1/object-1']);
      expect(draft()!.isReady, isTrue);
    });

    test('a video, an audio file and a document each classify correctly', () async {
      for (final (name, kind, mime) in [
        ('clip.mp4', 'video', 'video/mp4'),
        ('note.m4a', 'voice', 'audio/mp4'),
        ('report.pdf', 'file', 'application/pdf'),
      ]) {
        picker.result = picked(
          name: name,
          kind: MessageKind.values.byName(kind),
          mime: mime,
        );
        controller().clear();
        await controller().pick();

        expect(attachments.authorized.last.$2, kind);
        expect(attachments.authorized.last.$3, mime);
      }
    });

    test('cancelling is not an error and leaves no draft', () async {
      picker.result = null;
      expect(await controller().pick(), isNull);
      expect(draft(), isNull);
      expect(attachments.authorized, isEmpty);
    });

    test('an unsupported type is refused BY NAME, before any upload', () async {
      picker.result = picked(name: 'malware.exe', kind: null, mime: null);

      final refusal = await controller().pick();

      expect(refusal?.reason, AttachmentRefusalReason.unsupportedType);
      // Named, because "that cannot be sent" tells somebody who picked from a
      // grid of forty photos nothing.
      expect(refusal?.fileName, 'malware.exe');
      expect(attachments.authorized, isEmpty);
      expect(draft(), isNull);
    });

    test('a file over the limit is refused before it crosses the network', () async {
      picker.result = picked(name: 'huge.mp4', size: 300 * 1024 * 1024,
          kind: MessageKind.video, mime: 'video/mp4');

      final refusal = await controller().pick();

      expect(refusal?.reason, AttachmentRefusalReason.tooLarge);
      // The server enforces the same limit and remains the authority — but it
      // cannot say anything until 300 MB has already been uploaded.
      expect(attachments.authorized, isEmpty);
    });
  });

  group('uploading', () {
    test('reports progress while it runs', () async {
      final seen = <double>[];
      final sub = container.listen(
        attachmentDraftProvider(conversationId),
        (_, next) {
          if (next?.stage == AttachmentStage.uploading) seen.add(next!.progress);
        },
      );

      await controller().pick();
      sub.close();

      expect(seen, contains(0.5));
    });

    test('a failed upload leaves a retryable draft, not a queued message', () async {
      attachments.failUpload = const AppError(AppErrorKind.network);

      await controller().pick();

      expect(draft()!.stage, AttachmentStage.failed);
      expect(draft()!.isReady, isFalse);
      // Nothing is ready, so nothing can be named by a message. This is the
      // guarantee: the user is never shown a sent bubble for bytes that did not
      // leave the device.
      expect(controller().takeReady(), isNull);
    });

    test('a failed authorization is a failed draft, not a lost file', () async {
      attachments.failAuthorize = const AppError(AppErrorKind.network);

      await controller().pick();

      expect(draft()!.stage, AttachmentStage.failed);
      // The chosen file is still there to retry with.
      expect(draft()!.file.fileName, 'photo.jpg');
    });

    test('retry re-uploads the same file and succeeds', () async {
      attachments.failUpload = const AppError(AppErrorKind.network);
      await controller().pick();
      expect(draft()!.stage, AttachmentStage.failed);

      attachments.failUpload = null;
      await controller().retry();

      expect(draft()!.isReady, isTrue);
      expect(attachments.uploadCalls, 2);
    });

    test('retry does nothing when there is nothing to retry', () async {
      await controller().pick();
      expect(draft()!.isReady, isTrue);

      await controller().retry();

      // A ready draft is not re-uploaded; that would create a second object for
      // one file.
      expect(attachments.uploadCalls, 1);
    });

    test('an expired signed URL reads as transient, not as a refusal', () async {
      // 403 from storage means the signature lapsed, not that this person may
      // not send an attachment — the API already authorized them. Surfacing it
      // as a permission failure would tell a parent they are not allowed.
      attachments.failUpload = const AppError(AppErrorKind.network, code: 'upload_403');
      await controller().pick();

      expect(draft()!.error!.isTransient, isTrue);
    });
  });

  group('removing', () {
    test('clearing discards the draft so nothing is sent', () async {
      await controller().pick();
      controller().clear();

      expect(draft(), isNull);
      expect(controller().takeReady(), isNull);
    });
  });

  group('what the message carries', () {
    test('metadata naming an object already in storage — never a file path', () async {
      await controller().pick();
      final ready = controller().takeReady()!;

      expect(ready.objectKey, 'conversations/conv-1/object-1');
      expect(ready.mimeType, 'image/jpeg');
      expect(ready.byteSize, 2048);
      expect(ready.originalName, 'photo.jpg');

      // The wire shape the server expects. A path would be meaningless to it,
      // and would be unpersistable in the outbox.
      expect(ready.toWire(), containsPair('objectKey', 'conversations/conv-1/object-1'));
      expect(ready.toWire().containsKey('path'), isFalse);
    });

    test('survives the outbox round trip, so a queued attachment message restarts',
        () async {
      await controller().pick();
      final ready = controller().takeReady()!;

      final restored = OutgoingAttachment.fromJson(ready.toJson());

      expect(restored.objectKey, ready.objectKey);
      expect(restored.kind, ready.kind);
      expect(restored.byteSize, ready.byteSize);
      expect(restored.mimeType, ready.mimeType);
    });
  });
}
