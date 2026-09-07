import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/data/repositories.dart';
import '../../../core/errors/app_error.dart';
import '../../../core/network/error_mapper.dart';
import '../data/attachment_picker.dart';
import '../domain/outgoing_attachment.dart';

/// Where the chosen file is in the pipeline.
enum AttachmentStage {
  /// Chosen, and being put into storage.
  uploading,

  /// In storage. The message may now be sent.
  ready,

  /// Refused or interrupted. The user is offered a retry.
  failed,
}

/// The one attachment the composer is currently carrying.
class AttachmentDraft {
  const AttachmentDraft({
    required this.file,
    required this.stage,
    this.progress = 0,
    this.uploaded,
    this.error,
  });

  final PickedAttachment file;
  final AttachmentStage stage;

  /// 0..1. Only meaningful while [stage] is uploading.
  final double progress;

  /// Present exactly when [stage] is ready. This is what the message names.
  final OutgoingAttachment? uploaded;

  final AppError? error;

  bool get isReady => stage == AttachmentStage.ready && uploaded != null;

  AttachmentDraft copyWith({
    AttachmentStage? stage,
    double? progress,
    OutgoingAttachment? uploaded,
    AppError? error,
    bool clearError = false,
  }) {
    return AttachmentDraft(
      file: file,
      stage: stage ?? this.stage,
      progress: progress ?? this.progress,
      uploaded: uploaded ?? this.uploaded,
      error: clearError ? null : (error ?? this.error),
    );
  }
}

/// Picks a file, puts it in storage, and holds the result until it is sent.
///
/// ## The ordering, and why it is not negotiable
///
/// The upload completes BEFORE the message is composed into the outbox. That is
/// the opposite of how a text message works, and it is deliberate:
///
/// * The offline outbox persists what a queued message needs in order to be
///   sent later. It can persist a few hundred bytes of attachment metadata. It
///   cannot persist a 100 MB video, and pretending otherwise would produce a
///   queue whose entries reference files that a full disk, a cleared cache or a
///   deleted camera-roll item has since removed.
/// * So a message with an attachment is only ever queued once its bytes are
///   already safely in object storage. From that moment it behaves exactly like
///   a text message: it survives a restart, it retries with the same client id,
///   and the server deduplicates it.
///
/// The consequence, stated plainly because it is a real limitation: **an
/// attachment cannot be composed while offline.** The user is told the upload
/// failed and offered a retry, rather than being shown a queued bubble for
/// bytes that never left the device. Telling somebody their photo was sent when
/// it was not is the failure this ordering exists to prevent.
class AttachmentDraftController extends Notifier<AttachmentDraft?> {
  AttachmentDraftController(this.conversationId);

  final String conversationId;

  @override
  AttachmentDraft? build() => null;

  AttachmentPicker get _picker => ref.read(attachmentPickerProvider);
  AttachmentRepository get _attachments => ref.read(attachmentRepositoryProvider);

  /// Choose a file and begin uploading it.
  ///
  /// Returns a reason when the choice was refused, so the caller can say which
  /// file and why. Null means either "started" or "the user cancelled" — both
  /// of which need no message.
  Future<AttachmentRefusal?> pick() async {
    final picked = await _picker.pick();
    // Cancelling is not an error and is not narrated.
    if (picked == null) return null;

    if (!picked.isSupported) {
      return AttachmentRefusal(AttachmentRefusalReason.unsupportedType, picked.fileName);
    }
    if (!AttachmentLimits.fits(picked.kind!, picked.byteSize)) {
      // Refused HERE rather than after the upload. The server enforces the same
      // limit and is the authority, but it cannot tell the user anything until
      // the bytes have already crossed a mobile network.
      return AttachmentRefusal(AttachmentRefusalReason.tooLarge, picked.fileName);
    }

    state = AttachmentDraft(file: picked, stage: AttachmentStage.uploading);
    await _upload(picked);
    return null;
  }

  /// Try the upload again, with the same file.
  Future<void> retry() async {
    final draft = state;
    if (draft == null || draft.stage != AttachmentStage.failed) return;
    state = draft.copyWith(
      stage: AttachmentStage.uploading,
      progress: 0,
      clearError: true,
    );
    await _upload(draft.file);
  }

  Future<void> _upload(PickedAttachment picked) async {
    try {
      // The server mints the key and authorizes the upload against the
      // conversation. The client never composes a key: one it invented would be
      // refused when the message naming it was sent.
      final grant = await _attachments.authorizeUpload(
        conversationId: conversationId,
        kind: picked.kind!.name,
        mimeType: picked.mimeType!,
        byteSize: picked.byteSize,
      );

      await _attachments.putObject(
        grant: grant,
        filePath: picked.path,
        onProgress: (sent, total) {
          // The screen may be gone by the time a large upload reports.
          if (!ref.mounted) return;
          final current = state;
          if (current == null || current.stage != AttachmentStage.uploading) return;
          state = current.copyWith(progress: total <= 0 ? 0 : sent / total);
        },
      );

      if (!ref.mounted) return;
      state = state?.copyWith(
        stage: AttachmentStage.ready,
        progress: 1,
        uploaded: OutgoingAttachment(
          kind: picked.kind!,
          objectKey: grant.objectKey,
          mimeType: picked.mimeType!,
          byteSize: picked.byteSize,
          originalName: picked.fileName,
        ),
      );
    } catch (error) {
      if (!ref.mounted) return;
      // Left as a failed DRAFT, never silently dropped: the user chose this
      // file and must be able to see what happened and try again.
      state = state?.copyWith(
        stage: AttachmentStage.failed,
        error: ErrorMapper.map(error),
      );
    }
  }

  /// The user removed it, or it has been sent.
  void clear() => state = null;

  /// What the message should name, or null when nothing is ready.
  OutgoingAttachment? takeReady() {
    final draft = state;
    if (draft == null || !draft.isReady) return null;
    return draft.uploaded;
  }
}

enum AttachmentRefusalReason { unsupportedType, tooLarge }

class AttachmentRefusal {
  const AttachmentRefusal(this.reason, this.fileName);
  final AttachmentRefusalReason reason;
  final String fileName;
}

final attachmentDraftProvider =
    NotifierProvider.family<AttachmentDraftController, AttachmentDraft?, String>(
  AttachmentDraftController.new,
);
