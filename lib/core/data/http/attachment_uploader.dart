import 'dart:typed_data';

import 'package:dio/dio.dart';

import '../../errors/app_error.dart';
import '../../network/error_mapper.dart';

/// Transfers attachment bytes to a pre-signed URL.
///
/// This is a separate seam from [ApiClient] on purpose. A signed upload URL
/// carries its own authorization and, in any deployment that is not the local
/// reference storage, points at a host that is not our API. Reusing the
/// authenticated client would send the user's access token there — so the two
/// stacks are kept apart structurally rather than by remembering not to.
abstract interface class AttachmentUploader {
  Future<void> put(
    String uploadUrl, {
    required Uint8List bytes,
    required Map<String, String> headers,
    DateTime? expiresAt,
  });
}

/// The shortest time an upload is given to send its body: what every upload had before.
const uploadMinSendTimeout = Duration(seconds: 60);

/// The slowest uplink an upload is sized for: 1 Mbps.
const uploadAssumedBytesPerSecond = 125000;

/// The ceiling when the grant gives no expiry: the default signed-URL lifetime
/// (STORAGE_SIGNED_URL_TTL_SECONDS = 300).
const uploadMaxSendTimeout = Duration(minutes: 5);

/// How long sending [byteSize] bytes may take: long enough at 1 Mbps, never
/// under [uploadMinSendTimeout], and never past the signed URL's lifetime
/// ([expiresAt] when the grant names it, else [uploadMaxSendTimeout]).
///
/// One fixed 60 s used to bound the whole body, so a 100 MB video failed on
/// any uplink under about 13 Mbps.
Duration uploadSendTimeout(int byteSize, {DateTime? expiresAt, DateTime? now}) {
  final needed = Duration(milliseconds: (byteSize * 1000 / uploadAssumedBytesPerSecond).ceil());
  final remaining = expiresAt?.difference(now ?? DateTime.now());
  var cap = remaining != null && remaining > Duration.zero ? remaining : uploadMaxSendTimeout;
  if (cap < uploadMinSendTimeout) cap = uploadMinSendTimeout;
  if (needed < uploadMinSendTimeout) return uploadMinSendTimeout;
  return needed > cap ? cap : needed;
}

class DioAttachmentUploader implements AttachmentUploader {
  /// The AppError code of an upload whose body did not finish sending in time.
  static const uploadTimeoutCode = 'upload_timeout';

  DioAttachmentUploader({Dio? dio, Duration timeout = uploadMinSendTimeout})
      : _dio = dio ??
            Dio(
              BaseOptions(
                sendTimeout: timeout,
                receiveTimeout: timeout,
                connectTimeout: const Duration(seconds: 15),
              ),
            );

  final Dio _dio;

  @override
  Future<void> put(
    String uploadUrl, {
    required Uint8List bytes,
    required Map<String, String> headers,
    DateTime? expiresAt,
  }) async {
    final sendTimeout = uploadSendTimeout(bytes.length, expiresAt: expiresAt);
    try {
      await _dio.put<void>(
        uploadUrl,
        data: Stream<List<int>>.value(bytes),
        options: Options(
          headers: {
            ...headers,
            // Storage signs the length it authorized; Dio will not infer one for
            // a stream body, and without it the upload is rejected.
            Headers.contentLengthHeader: bytes.length,
          },
          // Whatever the storage layer answers with, only 2xx means stored.
          validateStatus: (status) => status != null && status >= 200 && status < 300,
          // Sized to the file: Dio's sendTimeout bounds sending the WHOLE body.
          sendTimeout: sendTimeout,
        ),
      );
    } on AppError {
      rethrow;
    } catch (error) {
      if (error is DioException && error.type == DioExceptionType.sendTimeout) {
        // Still a timeout (retryable, same message to the user); the code and
        // detail say which one, and how long it was given.
        throw AppError(
          AppErrorKind.timeout,
          code: uploadTimeoutCode,
          debugDetail: 'sending ${bytes.length} bytes took longer than ${sendTimeout.inSeconds} s',
        );
      }
      // Mapped through the app's taxonomy so the outbox can tell a retryable
      // network failure from a permanent refusal.
      throw ErrorMapper.map(error);
    }
  }
}
