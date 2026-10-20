import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/data/http/http_teacher_profile_repository.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/network/api_client.dart';
import 'package:jawwid_chat/shared/models/teacher_profile.dart';

/// Certificate upload, over the wire.
///
/// The upload URL authorizes itself on both backends: an S3 presigned URL
/// carries SigV4 in its query string, and the reference storage's `/storage`
/// route is `@Public()` and checks its own signature. So the property pinned
/// here is that the session's credential goes NOWHERE near the upload -- not in
/// a header, not in the URL -- and that the PUT carries exactly the headers
/// storage signed, because S3 refuses one whose headers differ.

class _Tokens implements TokenProvider {
  _Tokens(this.token);
  final String? token;

  @override
  Future<String?> accessToken() async => token;

  @override
  Future<String?> refresh() async => token;

  @override
  Future<void> onSessionEnded(AppError error) async {}
}

void main() {
  late Directory tempDir;
  late File file;

  setUp(() {
    tempDir = Directory.systemTemp.createTempSync('cert-upload-test');
    file = File('${tempDir.path}/cert.pdf')..writeAsBytesSync(List.filled(64, 0x25));
  });
  tearDown(() => tempDir.deleteSync(recursive: true));

  const sigV4 = 'X-Amz-Algorithm=AWS4-HMAC-SHA256'
      '&X-Amz-Credential=AKIAEXAMPLE%2F20261008%2Fauto%2Fs3%2Faws4_request'
      '&X-Amz-Date=20261008T120000Z'
      '&X-Amz-Expires=300'
      '&X-Amz-SignedHeaders=content-length%3Bcontent-type%3Bhost'
      '&X-Amz-Signature=0123456789abcdef';
  const presignedUrl = 'http://minio.example:9010/bucket/teacher-certificates/t1/obj_1?$sigV4';

  /// Records every request both Dios make.
  ({HttpTeacherProfileRepository repository, List<RequestOptions> requests}) build({
    int uploadStatus = 201,
    String uploadUrl = presignedUrl,
    Map<String, String>? grantHeaders = const {'content-type': 'application/pdf'},
  }) {
    final requests = <RequestOptions>[];

    final apiDio = Dio(BaseOptions(baseUrl: 'https://api.example/api/v1'));
    apiDio.httpClientAdapter = _Adapter((options) {
      requests.add(options);
      if (options.path.endsWith('/certificates/upload')) {
        return _json({
          'uploadUrl': uploadUrl,
          'uploadToken': 'teacher-certificates/t1/obj_1',
          'expiresAt': '2030-01-01T00:00:00.000Z',
          'headers': ?grantHeaders,
        });
      }
      return _json({'name': 'Ustadh Teacher'});
    });

    final uploadDio = Dio();
    uploadDio.httpClientAdapter = _Adapter((options) {
      requests.add(options);
      return ResponseBody.fromString('', uploadStatus);
    });

    return (
      repository: HttpTeacherProfileRepository(
        client: ApiClient(dio: apiDio, tokens: _Tokens('session-token-abc123')),
        uploader: uploadDio,
      ),
      requests: requests,
    );
  }

  PendingCertificateFile pending() => PendingCertificateFile(
        filePath: file.path,
        mimeType: 'application/pdf',
        byteSize: file.lengthSync(),
      );

  test('the PUT carries exactly the signed headers and no Authorization', () async {
    final h = build();
    await h.repository.addCertificate(file: pending(), title: 'Ijazah');

    final put = h.requests.firstWhere((r) => r.method == 'PUT');
    expect(put.headers.keys.map((k) => k.toLowerCase()), isNot(contains('authorization')),
        reason: 'the URL authorizes itself; a second credential is refused by S3');
    expect(put.headers['content-type'], 'application/pdf');
    expect(put.headers[Headers.contentLengthHeader], file.lengthSync());
  });

  test('the reference storage URL gets no Authorization either', () async {
    // Its /storage route is @Public() and checks its own signature.
    final h = build(uploadUrl: 'https://api.example/api/v1/storage/obj_1?expires=1&sig=abc');
    await h.repository.addCertificate(file: pending(), title: 'Ijazah');

    final put = h.requests.firstWhere((r) => r.method == 'PUT');
    expect(put.headers.keys.map((k) => k.toLowerCase()), isNot(contains('authorization')));
  });

  test('extra signed headers are sent as storage signed them', () async {
    final h = build(grantHeaders: const {'content-type': 'application/pdf', 'x-amz-meta-kind': 'certificate'});
    await h.repository.addCertificate(file: pending(), title: 'Ijazah');

    final put = h.requests.firstWhere((r) => r.method == 'PUT');
    expect(put.headers['x-amz-meta-kind'], 'certificate');
  });

  test('a grant that names no headers still sends the declared type', () async {
    final h = build(grantHeaders: null);
    await h.repository.addCertificate(file: pending(), title: 'Ijazah');

    final put = h.requests.firstWhere((r) => r.method == 'PUT');
    expect(put.headers[Headers.contentTypeHeader], 'application/pdf');
  });

  test('the signed URL is used verbatim and never carries the credential', () async {
    final h = build();
    await h.repository.addCertificate(file: pending(), title: 'Ijazah');

    final put = h.requests.firstWhere((r) => r.method == 'PUT');
    // The signature the server minted is untouched -- not re-encoded, not
    // stripped, not appended to.
    expect(put.uri.queryParameters['X-Amz-Signature'], '0123456789abcdef');
    expect(put.uri.toString(), isNot(contains('session-token-abc123')));
    expect(put.uri.queryParameters.containsKey('token'), isFalse);
    expect(put.uri.queryParameters.containsKey('access_token'), isFalse);
  });

  test('the attach body carries the token and no credential', () async {
    final h = build();
    await h.repository.addCertificate(file: pending(), title: 'Ijazah');

    final attach = h.requests.lastWhere((r) => r.method == 'POST');
    final body = attach.data as Map<String, Object?>;
    expect(body['uploadToken'], 'teacher-certificates/t1/obj_1');
    expect('$body', isNot(contains('session-token-abc123')));
  });

  test('a refused upload surfaces as an error and no certificate is attached', () async {
    final h = build(uploadStatus: 403);

    await expectLater(
      h.repository.addCertificate(file: pending(), title: 'Ijazah'),
      throwsA(isA<Object>()),
    );
    // Authorize happened; attach did not.
    expect(h.requests.where((r) => r.path.endsWith('/certificates/upload')).length, 1);
    expect(
      h.requests.where((r) => r.method == 'POST' && r.path.endsWith('/certificates')).length,
      0,
    );
  });

  test('upload progress is reported', () async {
    final h = build();
    final seen = <int>[];
    await h.repository.addCertificate(
      file: pending(),
      title: 'Ijazah',
      onProgress: (sent, total) => seen.add(sent),
    );
    // The adapter completes immediately, so the contract asserted is that the
    // callback is wired through rather than how many ticks a real socket emits.
    expect(seen, isNotEmpty);
  });

  test('renaming sends the name and returns what the SERVER stored', () async {
    final h = build();

    // The adapter answers with the canonical name regardless of what was sent,
    // which is exactly the drift this contract must not allow.
    final stored = await h.repository.updateName('  Ustadh   Teacher  ');
    expect(stored, 'Ustadh Teacher');

    final patch = h.requests.firstWhere((r) => r.method == 'PATCH');
    expect(patch.path, endsWith('/me/teacher-profile/name'));
    expect((patch.data as Map<String, Object?>)['name'], '  Ustadh   Teacher  ');
  });
}

ResponseBody _json(Map<String, Object?> body) => ResponseBody.fromString(
      jsonEncode(body),
      200,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );

class _Adapter implements HttpClientAdapter {
  _Adapter(this.handler);
  final ResponseBody Function(RequestOptions options) handler;

  @override
  void close({bool force = false}) {}

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    // Drain the body so a streamed upload behaves like a real one.
    if (requestStream != null) await requestStream.drain<void>();
    return handler(options);
  }
}
