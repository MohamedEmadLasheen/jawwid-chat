import 'dart:io';

import 'package:dio/dio.dart';

import '../../errors/app_error.dart';
import '../../network/api_client.dart';
import '../repositories.dart';

/// `AttachmentRepository` over the published REST contract, plus the presigned
/// PUT that follows it.
///
/// ## Two different clients, on purpose
///
/// The authorization call goes through [ApiClient], which carries the session's
/// bearer token. The upload does NOT: it goes to object storage on a different
/// host, and the presigned URL's signature IS its authorization. Sending the
/// session token there would hand a third-party storage service a credential
/// for this system, which no amount of convenience justifies.
///
/// The upload client is therefore a bare Dio with no interceptors, no base URL
/// and no default headers.
class HttpAttachmentRepository implements AttachmentRepository {
  HttpAttachmentRepository({required ApiClient client, Dio? uploader})
      : _client = client,
        _uploader = uploader ?? Dio();

  final ApiClient _client;
  final Dio _uploader;

  @override
  Future<UploadGrant> authorizeUpload({
    required String conversationId,
    required String kind,
    required String mimeType,
    required int byteSize,
  }) async {
    final response = await _client.post<Map<String, Object?>>(
      '/conversations/$conversationId/messages/attachments/authorize',
      data: {'kind': kind, 'mimeType': mimeType, 'byteSize': byteSize},
    );

    final data = response.data;
    final objectKey = data?['objectKey'] as String?;
    final uploadUrl = data?['uploadUrl'] as String?;
    if (objectKey == null || uploadUrl == null) {
      // Without both, there is nothing to upload to and nothing to name in the
      // message. Failing here beats uploading into the void.
      throw const AppError(
        AppErrorKind.server,
        code: 'malformed_upload_authorization',
        debugDetail: 'authorize response carried no objectKey or uploadUrl',
      );
    }

    return UploadGrant(
      objectKey: objectKey,
      uploadUrl: uploadUrl,
      headers: _headersOf(data?['headers']),
      expiresAt: DateTime.tryParse((data?['expiresAt'] as String?) ?? ''),
    );
  }

  @override
  Future<void> putObject({
    required UploadGrant grant,
    required String filePath,
    void Function(int sent, int total)? onProgress,
  }) async {
    final file = File(filePath);
    final length = await file.length();

    try {
      await _uploader.put<void>(
        grant.uploadUrl,
        // Streamed rather than read into memory: a 100 MB video loaded whole is
        // an out-of-memory crash on a modest phone.
        data: file.openRead(),
        options: Options(
          headers: {
            ...grant.headers,
            // Required for a streamed body; without it the request is chunked
            // and S3 rejects it.
            Headers.contentLengthHeader: length,
          },
          // Storage speaks HTTP, not this API's error envelope, so the status
          // is interpreted here rather than by the shared error mapper.
          validateStatus: (status) => status != null && status < 400,
        ),
        onSendProgress: onProgress,
      );
    } on DioException catch (error) {
      final status = error.response?.statusCode;
      throw AppError(
        // 403 from storage is an EXPIRED or malformed signature, not a policy
        // decision about this user — the API already authorized them. Treating
        // it as a permission failure would tell the parent they may not send an
        // attachment, when the truth is that they took too long and should try
        // again.
        status == 403 ? AppErrorKind.network : _kindFor(status),
        code: status == null ? 'upload_failed' : 'upload_$status',
        debugDetail: 'object storage rejected the upload',
      );
    }
  }

  /// The server states the Content-Type it validated, and the client must send
  /// exactly that. Read defensively: a header map that is not a map means the
  /// upload goes out with no content type rather than throwing on a cast in the
  /// middle of a send.
  static Map<String, String> _headersOf(Object? raw) {
    if (raw is! Map) return const {};
    return {
      for (final entry in raw.entries)
        entry.key.toString(): '${entry.value}',
    };
  }

  static AppErrorKind _kindFor(int? status) {
    if (status == null) return AppErrorKind.network;
    if (status >= 500) return AppErrorKind.server;
    return AppErrorKind.network;
  }
}
