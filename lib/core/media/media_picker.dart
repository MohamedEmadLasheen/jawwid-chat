import 'dart:io';

import 'package:file_selector/file_selector.dart' as selector;
import 'package:image_picker/image_picker.dart';
import 'package:path/path.dart' as p;

import '../../shared/models/message.dart';
import '../data/repositories.dart';

/// Why a pick could not produce a file.
///
/// The UI branches on these rather than on an exception type, for the same
/// reason [VoiceRecorderFailure] exists: a denied photo-library permission is a
/// trip to Settings, a file that is too large is a different file, and a plain
/// failure is worth retrying. Cancellation is **not** here — a user who backs
/// out of the picker has not failed at anything, and gets null.
enum MediaPickFailure {
  permissionDenied,
  unsupported,
  tooLarge,
  typeNotAllowed,
  failed,
}

class MediaPickException implements Exception {
  const MediaPickException(this.reason, {this.detail});

  final MediaPickFailure reason;

  /// Developer-facing only. Never rendered — §31 forbids showing a parent a
  /// technical error.
  final String? detail;

  @override
  String toString() => detail == null
      ? 'MediaPickException($reason)'
      : 'MediaPickException($reason): $detail';
}

/// The photo and file seam.
///
/// Everything above this line is testable without a platform channel, a
/// permission dialog or a real photo library — which is the only reason the
/// cancel, denial and over-size paths can be covered at all.
abstract interface class MediaPicker {
  /// One photo from the device's library. Null when the user backed out.
  Future<PendingAttachment?> pickImage();

  /// One file of any allowed type. Null when the user backed out.
  Future<PendingAttachment?> pickFile();
}

/// The real thing: the system photo library and the system file picker.
class PluginMediaPicker implements MediaPicker {
  PluginMediaPicker({ImagePicker? images}) : _images = images ?? ImagePicker();

  final ImagePicker _images;

  @override
  Future<PendingAttachment?> pickImage() async {
    final XFile? picked;
    try {
      // Downscaled and re-encoded before it ever reaches the upload. A modern
      // phone camera produces 4-6 MB images that no one looks at at full size
      // in a chat bubble, and this audience is on mobile data (§21, §33).
      picked = await _images.pickImage(
        source: ImageSource.gallery,
        maxWidth: 1920,
        maxHeight: 1920,
        imageQuality: 85,
      );
    } on Exception catch (error) {
      throw MediaPickException(
        _imageFailure(error),
        detail: error.toString(),
      );
    }

    if (picked == null) return null;
    return _describe(
      path: picked.path,
      kind: MessageKind.image,
      mimeType: picked.mimeType ?? _mimeFromPath(picked.path, MessageKind.image),
      fileName: picked.name,
    );
  }

  @override
  Future<PendingAttachment?> pickFile() async {
    final selector.XFile? picked;
    try {
      picked = await selector.openFile(
        acceptedTypeGroups: const [
          // Mirrors the backend's `file` allow-list. The picker refusing an
          // unsupported type up front is better than an upload the server
          // rejects after the user has waited for it.
          selector.XTypeGroup(
            label: 'documents',
            extensions: <String>[
              'pdf',
              'doc',
              'docx',
              'xls',
              'xlsx',
              'ppt',
              'pptx',
              'txt',
              'csv',
            ],
            mimeTypes: <String>[
              'application/pdf',
              'application/msword',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'application/vnd.ms-excel',
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              'application/vnd.ms-powerpoint',
              'application/vnd.openxmlformats-officedocument.presentationml.presentation',
              'text/plain',
              'text/csv',
            ],
            uniformTypeIdentifiers: <String>[
              'com.adobe.pdf',
              'com.microsoft.word.doc',
              'org.openxmlformats.wordprocessingml.document',
              'com.microsoft.excel.xls',
              'org.openxmlformats.spreadsheetml.sheet',
              'com.microsoft.powerpoint.ppt',
              'org.openxmlformats.presentationml.presentation',
              'public.plain-text',
              'public.comma-separated-values-text',
            ],
          ),
        ],
      );
    } on Exception catch (error) {
      throw MediaPickException(MediaPickFailure.failed, detail: error.toString());
    }

    if (picked == null) return null;
    return _describe(
      path: picked.path,
      kind: MessageKind.file,
      mimeType: picked.mimeType ?? _mimeFromPath(picked.path, MessageKind.file),
      fileName: picked.name,
    );
  }

  /// Size is read here, not at send time.
  ///
  /// The backend re-checks it when it authorizes the upload, but finding out
  /// before the preview means an over-size file is refused while the user still
  /// remembers choosing it, rather than after a progress bar.
  static Future<PendingAttachment> _describe({
    required String path,
    required MessageKind kind,
    required String mimeType,
    required String fileName,
  }) async {
    final int byteSize;
    try {
      byteSize = await File(path).length();
    } on FileSystemException catch (error) {
      throw MediaPickException(MediaPickFailure.failed, detail: error.toString());
    }

    if (byteSize <= 0) {
      throw const MediaPickException(
        MediaPickFailure.failed,
        detail: 'picked file is empty',
      );
    }
    if (byteSize > AttachmentLimits.maxBytes(kind)) {
      throw const MediaPickException(MediaPickFailure.tooLarge);
    }

    return PendingAttachment(
      filePath: path,
      kind: kind,
      mimeType: mimeType,
      byteSize: byteSize,
      fileName: fileName,
    );
  }

  /// `image_picker` reports a denial as a `PlatformException`, and the code is
  /// the only thing that distinguishes it from a device that cannot pick at all.
  static MediaPickFailure _imageFailure(Exception error) {
    final text = error.toString().toLowerCase();
    if (text.contains('photo_access_denied') || text.contains('denied')) {
      return MediaPickFailure.permissionDenied;
    }
    if (text.contains('no_available_camera') || text.contains('unsupported')) {
      return MediaPickFailure.unsupported;
    }
    return MediaPickFailure.failed;
  }

  /// Last resort only. Both pickers normally report a type; this keeps a file
  /// with a known extension from being sent as `application/octet-stream`,
  /// which the backend's allow-list refuses.
  static String _mimeFromPath(String path, MessageKind kind) {
    return switch (p.extension(path).toLowerCase()) {
      '.jpg' || '.jpeg' => 'image/jpeg',
      '.png' => 'image/png',
      '.gif' => 'image/gif',
      '.webp' => 'image/webp',
      '.heic' => 'image/heic',
      '.pdf' => 'application/pdf',
      '.txt' => 'text/plain',
      '.csv' => 'text/csv',
      '.doc' => 'application/msword',
      '.docx' =>
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xls' => 'application/vnd.ms-excel',
      '.xlsx' =>
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.ppt' => 'application/vnd.ms-powerpoint',
      '.pptx' =>
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      _ => kind == MessageKind.image ? 'image/jpeg' : 'application/octet-stream',
    };
  }
}

/// The per-kind ceilings the backend enforces (`attachment.service.ts`).
///
/// Mirrored rather than guessed, and mirrored *conservatively*: the server
/// re-validates on authorize and again on send, so this only decides whether
/// the user is told early or late. A value that drifted low would refuse
/// something the server would accept, which is the safer direction.
abstract final class AttachmentLimits {
  static const imageBytes = 10 * 1024 * 1024;
  static const videoBytes = 100 * 1024 * 1024;
  static const voiceBytes = 16 * 1024 * 1024;
  static const fileBytes = 25 * 1024 * 1024;

  static int maxBytes(MessageKind kind) => switch (kind) {
        MessageKind.image => imageBytes,
        MessageKind.video => videoBytes,
        MessageKind.voice => voiceBytes,
        _ => fileBytes,
      };
}
