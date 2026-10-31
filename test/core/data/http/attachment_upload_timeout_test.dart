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
/// 60 s, and capped at the signed URL's lifetime.
void main() {
  const mb = 1000 * 1000;
  final now = DateTime.utc(2026, 10, 31, 12);

  group('uploadSendTimeout', () {
    test('a small file keeps the old 60 s', () {
      expect(uploadSendTimeout(20 * 1000), const Duration(seconds: 60));
      expect(uploadSendTimeout(5 * mb), const Duration(seconds: 60)); // 40 s at 1 Mbps
    });

    test('a larger file gets the time 1 Mbps needs', () {
      expect(uploadSendTimeout(20 * mb), const Duration(seconds: 160));
      expect(uploadSendTimeout(25 * mb + 1), const Duration(milliseconds: 200001));
    });

    test('a 100 MB video is no longer held to 60 s: capped at the default URL lifetime (5 min)', () {
      expect(uploadSendTimeout(100 * mb), uploadMaxSendTimeout);
      expect(uploadMaxSendTimeout, const Duration(minutes: 5));
      expect(uploadSendTimeout(100 * mb) > const Duration(seconds: 60), isTrue);
    });

    test("the grant's expiry is the ceiling when it names one", () {
      final in10 = now.add(const Duration(minutes: 10));
      expect(uploadSendTimeout(100 * mb, expiresAt: in10, now: now), const Duration(minutes: 10));
      expect(uploadSendTimeout(20 * mb, expiresAt: in10, now: now), const Duration(seconds: 160));
    });

    test('an expiry already close or past never cuts below 60 s', () {
      expect(uploadSendTimeout(100 * mb, expiresAt: now.add(const Duration(seconds: 20)), now: now),
          const Duration(seconds: 60));
      expect(uploadSendTimeout(100 * mb, expiresAt: now.subtract(const Duration(minutes: 1)), now: now),
          uploadMaxSendTimeout);
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

    test('and the grant expiry caps it', () async {
      final uploader = DioAttachmentUploader(dio: dio);
      final soon = DateTime.now().add(const Duration(seconds: 90));
      await uploader.put('https://storage.invalid/k', bytes: Uint8List(100 * mb), headers: const {}, expiresAt: soon);
      expect(sentWith!.inSeconds, inInclusiveRange(85, 90));
    });

    test('running out of send time is a retryable timeout that says it was the upload', () async {
      fail = DioException.sendTimeout(timeout: const Duration(seconds: 60), requestOptions: RequestOptions());
      final uploader = DioAttachmentUploader(dio: dio);
      final error = await uploader
          .put('https://storage.invalid/k', bytes: Uint8List(1000), headers: const {})
          .then<Object?>((_) => null, onError: (Object e) => e);
      expect(error, isA<AppError>());
      final appError = error! as AppError;
      expect(appError.kind, AppErrorKind.timeout);
      expect(appError.code, DioAttachmentUploader.uploadTimeoutCode);
      expect(appError.debugDetail, contains('1000 bytes'));
    });
  });
}
