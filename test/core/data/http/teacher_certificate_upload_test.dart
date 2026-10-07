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
/// WHY THIS FILE EXISTS. The first version of this client PUT the bytes on a
/// bare Dio with no credential, reasoning that a signed URL is already a
/// capability. Against the reference storage that is wrong: `StorageController`
/// is not public, and the route answers 401. A real QA run caught it, not a
/// test — so these assert the wire contract that run established.
///
/// The security property being pinned is narrow and specific: the signature
/// authorizes the OBJECT, the header authenticates the CALLER, and the
/// credential travels in the header and NOWHERE else.

class _Tokens implements TokenProvider {
  _Tokens(this.token);
  final String? token;
  int reads = 0;

  @override
  Future<String?> accessToken() async {
    reads += 1;
    return token;
  }

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

  /// Records every request both Dios make.
  ({
    HttpTeacherProfileRepository repository,
    List<RequestOptions> requests,
  }) build({
    String? token = 'session-token-abc123',
    int uploadStatus = 201,
  }) {
    final requests = <RequestOptions>[];

    final apiDio = Dio(BaseOptions(baseUrl: 'https://api.example/api/v1'));
    apiDio.httpClientAdapter = _Adapter((options) {
      requests.add(options);
      final path = options.path;
      if (path.endsWith('/certificates/upload')) {
        return _json({
          'uploadUrl': 'https://storage.example/api/v1/storage/obj_1?expires=1&sig=abc',
          'uploadToken': 'teacher-certificates/t1/obj_1',
          'expiresAt': '2030-01-01T00:00:00.000Z',
        });
      }
      return _json({'published': null, 'draft': null});
    });

    final uploadDio = Dio();
    uploadDio.httpClientAdapter = _Adapter((options) {
      requests.add(options);
      return ResponseBody.fromString('', uploadStatus);
    });

    return (
      repository: HttpTeacherProfileRepository(
        client: ApiClient(dio: apiDio, tokens: _Tokens(token)),
        tokens: _Tokens(token),
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

  test('the upload PUT carries the session Authorization header', () async {
    final h = build();
    await h.repository.addCertificate(file: pending(), title: 'Ijazah');

    final put = h.requests.firstWhere((r) => r.method == 'PUT');
    expect(put.headers['Authorization'], 'Bearer session-token-abc123');
    expect(put.headers[Headers.contentTypeHeader], 'application/pdf');
  });

  test('the signed URL is used verbatim and never carries the credential',
      () async {
    final h = build();
    await h.repository.addCertificate(file: pending(), title: 'Ijazah');

    final put = h.requests.firstWhere((r) => r.method == 'PUT');
    final url = put.uri.toString();

    // Exactly what the server returned — not rebuilt, not appended to.
    expect(url, 'https://storage.example/api/v1/storage/obj_1?expires=1&sig=abc');
    expect(url, isNot(contains('session-token-abc123')));
    expect(put.uri.queryParameters.containsKey('token'), isFalse);
    expect(put.uri.queryParameters.containsKey('access_token'), isFalse);
  });

  test('the credential never reaches the object key or the attach body', () async {
    final h = build();
    await h.repository.addCertificate(file: pending(), title: 'Ijazah');

    final attach = h.requests.lastWhere((r) => r.method == 'POST');
    final body = attach.data as Map<String, Object?>;
    expect(body['uploadToken'], 'teacher-certificates/t1/obj_1');
    expect('$body', isNot(contains('session-token-abc123')));
  });

  test('a 401 from storage surfaces as an error and no certificate is attached',
      () async {
    final h = build(uploadStatus: 401);

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

  test('upload progress is still reported', () async {
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

  test('a session with no token sends no Authorization header at all', () async {
    // Rather than an empty "Bearer ": a malformed credential is worse than none,
    // and the server should answer 401 either way.
    final h = build(token: null);
    await h.repository.addCertificate(file: pending(), title: 'Ijazah');

    final put = h.requests.firstWhere((r) => r.method == 'PUT');
    expect(put.headers.containsKey('Authorization'), isFalse);
  });
}

ResponseBody _json(Map<String, Object?> body) => ResponseBody.fromString(
      _encode(body),
      200,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );

String _encode(Map<String, Object?> body) {
  final buffer = StringBuffer('{');
  var first = true;
  body.forEach((key, value) {
    if (!first) buffer.write(',');
    first = false;
    buffer.write('"$key":');
    if (value == null) {
      buffer.write('null');
    } else if (value is String) {
      buffer.write('"$value"');
    } else {
      buffer.write('$value');
    }
  });
  buffer.write('}');
  return buffer.toString();
}

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
