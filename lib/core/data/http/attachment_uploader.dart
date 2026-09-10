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

class DioAttachmentUploader implements AttachmentUploader {
  DioAttachmentUploader({Dio? dio, Duration timeout = const Duration(seconds: 60)})
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
        ),
      );
    } on AppError {
      rethrow;
    } catch (error) {
      // Mapped through the app's taxonomy so the outbox can tell a retryable
      // network failure from a permanent refusal.
      throw ErrorMapper.map(error);
    }
  }
}
