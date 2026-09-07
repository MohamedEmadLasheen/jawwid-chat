import '../../../shared/models/message.dart';

/// An object that is ALREADY IN STORAGE, waiting to be named by a message.
///
/// ## Why this exists rather than a file path
///
/// The offline outbox persists what a queued message needs in order to be sent
/// later. It can persist this — a few hundred bytes of metadata — and it
/// cannot persist a video. So the upload happens BEFORE the message is queued,
/// and what the queue holds is a reference to bytes that are already safely in
/// object storage.
///
/// That ordering is the whole design, and it is what keeps the offline
/// guarantees honest. If a message could be queued with a file path, then a
/// device that ran out of space, had the file deleted from its camera roll, or
/// was simply restarted could produce a queued message whose attachment no
/// longer exists — and the user would have been shown a bubble saying it was
/// sent.
class OutgoingAttachment {
  const OutgoingAttachment({
    required this.kind,
    required this.objectKey,
    required this.mimeType,
    required this.byteSize,
    this.originalName,
    this.durationMs,
    this.width,
    this.height,
  });

  final MessageKind kind;

  /// The key the SERVER minted in `POST …/messages/attachments/authorize`.
  ///
  /// Never composed on this side. The server binds it to the conversation and
  /// refuses a key that does not belong there, so a client-composed key would
  /// simply be rejected — and inventing one here would be a client trying to
  /// choose where its bytes live.
  final String objectKey;

  final String mimeType;
  final int byteSize;
  final String? originalName;
  final int? durationMs;
  final int? width;
  final int? height;

  /// The shape `POST /conversations/:id/messages` expects in `attachments[]`.
  Map<String, Object?> toWire() => {
        'kind': kind.name,
        'objectKey': objectKey,
        'mimeType': mimeType,
        'byteSize': byteSize,
        'originalName': ?originalName,
        'durationMs': ?durationMs,
        'width': ?width,
        'height': ?height,
      };

  /// For the local outbox. Same shape, so there is one serialization to reason
  /// about rather than two that can drift.
  Map<String, Object?> toJson() => toWire();

  static OutgoingAttachment fromJson(Map<String, Object?> json) {
    return OutgoingAttachment(
      kind: MessageKind.values.firstWhere(
        (k) => k.name == json['kind'],
        orElse: () => MessageKind.file,
      ),
      objectKey: (json['objectKey'] as String?) ?? '',
      mimeType: (json['mimeType'] as String?) ?? 'application/octet-stream',
      byteSize: (json['byteSize'] as num?)?.toInt() ?? 0,
      originalName: json['originalName'] as String?,
      durationMs: (json['durationMs'] as num?)?.toInt(),
      width: (json['width'] as num?)?.toInt(),
      height: (json['height'] as num?)?.toInt(),
    );
  }
}

/// A file the user has chosen, before anything has been done with it.
class PickedAttachment {
  const PickedAttachment({
    required this.path,
    required this.fileName,
    required this.byteSize,
    required this.kind,
    required this.mimeType,
  });

  final String path;
  final String fileName;
  final int byteSize;

  /// Null when the extension is not one the server accepts.
  ///
  /// Nullable rather than a sentinel, because "the user cancelled" and "the
  /// user chose a .exe" are different outcomes and only one of them deserves a
  /// message. The picker returns null for the first and this for the second, so
  /// the composer can name the file it refused.
  final MessageKind? kind;
  final String? mimeType;

  bool get isSupported => kind != null && mimeType != null;
}

/// What the server will accept, mirrored on this side.
///
/// MIRRORED, not re-decided: `AttachmentService`'s `ALLOWED_MIME` and
/// `MAX_BYTES` are the authority and reject anything outside them. This copy
/// exists so a 300 MB video is refused with an explanation the instant it is
/// chosen, rather than after it has been uploaded — the server cannot tell the
/// user anything until the bytes have already crossed a mobile network.
///
/// A type that is allowed here and refused there is a bug in this table. A type
/// refused here and allowed there merely means the client is more conservative,
/// which is the safe direction.
abstract final class AttachmentLimits {
  /// Extension → (kind, MIME). Only what the server's allowlist admits.
  static const byExtension = <String, (MessageKind, String)>{
    'jpg': (MessageKind.image, 'image/jpeg'),
    'jpeg': (MessageKind.image, 'image/jpeg'),
    'png': (MessageKind.image, 'image/png'),
    'webp': (MessageKind.image, 'image/webp'),
    'heic': (MessageKind.image, 'image/heic'),
    'gif': (MessageKind.image, 'image/gif'),
    'mp4': (MessageKind.video, 'video/mp4'),
    'mov': (MessageKind.video, 'video/quicktime'),
    'webm': (MessageKind.video, 'video/webm'),
    'mp3': (MessageKind.voice, 'audio/mpeg'),
    'm4a': (MessageKind.voice, 'audio/mp4'),
    'aac': (MessageKind.voice, 'audio/aac'),
    'ogg': (MessageKind.voice, 'audio/ogg'),
    'wav': (MessageKind.voice, 'audio/wav'),
    'pdf': (MessageKind.file, 'application/pdf'),
    'zip': (MessageKind.file, 'application/zip'),
    'doc': (MessageKind.file, 'application/msword'),
    'docx': (
      MessageKind.file,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ),
    'xlsx': (
      MessageKind.file,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ),
    'txt': (MessageKind.file, 'text/plain'),
  };

  /// Mirrors ATTACHMENT_MAX_BYTES_* on the server.
  static const maxBytes = <MessageKind, int>{
    MessageKind.image: 10 * 1024 * 1024,
    MessageKind.video: 100 * 1024 * 1024,
    MessageKind.voice: 16 * 1024 * 1024,
    MessageKind.file: 25 * 1024 * 1024,
  };

  /// Resolve a file name to what the server calls it, or null if unsupported.
  static (MessageKind, String)? classify(String fileName) {
    final dot = fileName.lastIndexOf('.');
    if (dot < 0 || dot == fileName.length - 1) return null;
    return byExtension[fileName.substring(dot + 1).toLowerCase()];
  }

  static bool fits(MessageKind kind, int byteSize) {
    final max = maxBytes[kind];
    return max != null && byteSize > 0 && byteSize <= max;
  }
}
