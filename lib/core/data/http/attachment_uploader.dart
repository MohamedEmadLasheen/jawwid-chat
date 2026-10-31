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
  });
}

/// The shortest time an upload is given to send its body: what every upload had before.
const uploadMinSendTimeout = Duration(seconds: 60);

/// The slowest uplink an upload is sized for: 1 Mbps.
const uploadAssumedBytesPerSecond = 125000;

/// A ceiling that only stops an upload that is not moving at all. Deliberately
/// NOT the signed URL's lifetime: S3, Spaces and R2 check a presigned URL's
/// expiry when the request starts, so an upload already under way may run past it.
const uploadMaxSendTimeout = Duration(minutes: 30);

/// How long sending [byteSize] bytes may take: the time 1 Mbps needs, within
/// [uploadMinSendTimeout]..[uploadMaxSendTimeout].
///
/// One fixed 60 s used to bound the whole body, so a 100 MB video failed on
/// any uplink under about 13 Mbps.
Duration uploadSendTimeout(int byteSize) {
  final needed = Duration(milliseconds: (byteSize * 1000 / uploadAssumedBytesPerSecond).ceil());
  if (needed < uploadMinSendTimeout) return uploadMinSendTimeout;
  return needed > uploadMaxSendTimeout ? uploadMaxSendTimeout : needed;
}

class DioAttachmentUploader implements AttachmentUploader {
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
  }) async {
    final sendTimeout = uploadSendTimeout(bytes.length);
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
        // Still a timeout (same message to the user); the code says it was
        // the upload, so the outbox parks it rather than re-sending the whole
        // file straight away, and the detail says how long it was given.
        throw AppError(
          AppErrorKind.timeout,
          code: AppError.uploadTimeout,
          debugDetail: 'sending ${bytes.length} bytes took longer than ${sendTimeout.inSeconds} s',
        );
      }
      // Mapped through the app's taxonomy so the outbox can tell a retryable
      // network failure from a permanent refusal.
      throw ErrorMapper.map(error);
    }
  }
}
