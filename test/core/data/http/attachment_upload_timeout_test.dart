import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/data/http/attachment_uploader.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';

/// The upload's send timeout scales with the file.
///
/// Dio's `sendTimeout` bounds sending the WHOLE body, and it used to be a fixed
/// 60 s: a 100 MB video then needed an uplink of at least 13 Mbps, and failed
/// as a timeout on anything slower. It is now sized for 1 Mbps, never under
/// 60 s, with a 30 min ceiling (not the URL lifetime: expiry is checked when the
/// request starts).
void main() {
  const mb = 1000 * 1000;

  group('uploadSendTimeout', () {
    test('a small file keeps the old 60 s', () {
      expect(uploadSendTimeout(0), const Duration(seconds: 60));
      expect(uploadSendTimeout(20 * 1000), const Duration(seconds: 60));
      expect(uploadSendTimeout(5 * mb), const Duration(seconds: 60)); // 40 s at 1 Mbps
    });

    test('a larger file gets the time 1 Mbps needs', () {
      expect(uploadSendTimeout(20 * mb), const Duration(seconds: 160));
      expect(uploadSendTimeout(25 * mb + 1), const Duration(milliseconds: 200001));
    });

    test('a 100 MB video gets 800 s: 1 Mbps is enough (was 60 s, i.e. 13 Mbps)', () {
      expect(uploadSendTimeout(100 * mb), const Duration(seconds: 800));
    });

    test('not capped at the signed URL lifetime; only a 30 min ceiling for an upload that is not moving', () {
      expect(uploadMaxSendTimeout, const Duration(minutes: 30));
      expect(uploadSendTimeout(225 * mb), const Duration(minutes: 30));
      expect(uploadSendTimeout(1000 * mb), const Duration(minutes: 30));
    });

    test('monotonic: a bigger file never gets less time', () {
      var previous = Duration.zero;
      for (var bytes = 0; bytes <= 300 * mb; bytes += 7 * mb) {
        final t = uploadSendTimeout(bytes);
        expect(t >= previous, isTrue, reason: '$bytes bytes');
        previous = t;
      }
    });
  });

  group('DioAttachmentUploader', () {
    late Duration? sentWith;
    late Dio dio;
    DioException? fail;

    setUp(() {
      sentWith = null;
      fail = null;
      dio = Dio(BaseOptions(sendTimeout: const Duration(seconds: 60)))
        ..interceptors.add(InterceptorsWrapper(onRequest: (options, handler) {
          sentWith = options.sendTimeout;
          final error = fail;
          if (error != null) return handler.reject(error.copyWith(requestOptions: options));
          handler.resolve(Response<void>(requestOptions: options, statusCode: 200));
        }));
    });

    test('each PUT carries the timeout sized to its own bytes', () async {
      final uploader = DioAttachmentUploader(dio: dio);
      await uploader.put('https://storage.invalid/k', bytes: Uint8List(20 * mb), headers: const {});
      expect(sentWith, const Duration(seconds: 160));
      await uploader.put('https://storage.invalid/k', bytes: Uint8List(100), headers: const {});
      expect(sentWith, const Duration(seconds: 60));
    });

    test('a 100 MB upload is given 800 s, not the old 60 s', () async {
      final uploader = DioAttachmentUploader(dio: dio);
      await uploader.put('https://storage.invalid/k', bytes: Uint8List(100 * mb), headers: const {});
      expect(sentWith, const Duration(seconds: 800));
    });

    test('running out of send time is a timeout that says it was the upload', () async {
      fail = DioException.sendTimeout(timeout: const Duration(seconds: 60), requestOptions: RequestOptions());
      final uploader = DioAttachmentUploader(dio: dio);
      final error = await uploader
          .put('https://storage.invalid/k', bytes: Uint8List(1000), headers: const {})
          .then<Object?>((_) => null, onError: (Object e) => e);
      expect(error, isA<AppError>());
      final appError = error! as AppError;
      expect(appError.kind, AppErrorKind.timeout);
      expect(appError.code, AppError.uploadTimeout);
      expect(appError.debugDetail, contains('1000 bytes'));
    });
  });
}
