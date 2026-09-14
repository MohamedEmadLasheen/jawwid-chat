import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/data/http/http_message_repository.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/network/actor_identity.dart';
import 'package:jawwid_chat/core/network/api_client.dart';
import 'package:jawwid_chat/core/network/api_config.dart';
import 'package:jawwid_chat/core/network/http_stack.dart';
import 'package:jawwid_chat/shared/models/message.dart';

import 'test_server.dart';

class _NoTokens implements TokenProvider {
  @override
  Future<String?> accessToken() async => null;

  @override
  Future<String?> refresh() async => null;

  @override
  Future<void> onSessionEnded(AppError error) async {}
}

/// The real upload path, over a real socket.
///
/// `uploadVoiceNote` is two requests, not one: an authorization through the
/// authenticated client, then a bare PUT of the bytes to whatever URL that
/// authorization named. Nothing here substitutes either half — the repository
/// is built without an `uploads` argument, so the production
/// `DioAttachmentUploader` is what talks to the server.
///
/// This is a transport test. It proves the client speaks the shape
/// `message.controller.ts` and `object-storage.ts` publish; it proves nothing
/// about whether a real deployment behaves that way.
void main() {
  late TestServer server;
  late Directory recordings;
  late HttpMessageRepository repository;

  const conversationId = 'c1';
  const objectKey = 'conversations/c1/8a1f0c2e-0000-4000-8000-00000000beef';
  const authorizePath = '/conversations/c1/messages/attachments/authorize';
  const storagePath = '/storage/$objectKey';

  /// Deliberately not text.
  ///
  /// Every byte value appears, so the payload contains sequences that are not
  /// valid UTF-8 — 0x80 and 0xFF among them. A transport that decoded, re-encoded
  /// or truncated the body could not return this unchanged, which is what makes
  /// "the bytes arrived intact" a real assertion rather than a hopeful one. A
  /// recording is not commited to the repository: the same 512 bytes are
  /// generated here every run.
  final voiceBytes = Uint8List.fromList(
    List<int>.generate(512, (i) => (i * 7 + 13) % 256),
  );

  File writeRecording(Uint8List bytes) =>
      File('${recordings.path}${Platform.pathSeparator}voice.m4a')
        ..writeAsBytesSync(bytes);

  /// The grant `SignedLocalObjectStorage.authorizeUpload` returns: a key, a URL
  /// carrying its own signature, and the content type storage signed for.
  Map<String, Object?> grant({String? url}) => {
        'objectKey': objectKey,
        'uploadUrl':
            url ?? '${server.baseUrl}$storagePath?expires=1789000000&size=512&sig=deadbeef',
        'method': 'PUT',
        'headers': const {'content-type': 'audio/mp4'},
        'expiresAt': '2026-09-14T12:00:00.000Z',
      };

  PendingVoiceNote note(File file, {int? byteSize}) => PendingVoiceNote(
        filePath: file.path,
        mimeType: 'audio/mp4',
        byteSize: byteSize ?? file.lengthSync(),
        duration: const Duration(seconds: 7),
      );

  setUp(() async {
    server = await TestServer.start();
    recordings = Directory.systemTemp.createTempSync('voice_upload_http');
    repository = HttpMessageRepository(
      client: buildApiClient(
        config: ApiConfig(baseUrl: server.baseUrl),
        tokens: _NoTokens(),
        identity: const BearerTokenIdentity(),
      ),
      viewerActorId: () => 'me',
      // No `uploads:` override on purpose. The production uploader is the
      // subject of this test; handing it a fake would test the fake.
    );
  });

  tearDown(() async {
    if (recordings.existsSync()) recordings.deleteSync(recursive: true);
    await server.stop();
  });

  test('the authorization declares what the recording actually is', () async {
    final file = writeRecording(voiceBytes);
    server.on('POST', authorizePath, [Reply.ok(grant())]);
    server.on('PUT', storagePath, [const Reply(201, null)]);

    await repository.uploadVoiceNote(
      conversationId: conversationId,
      note: note(file),
    );

    final authorize = server.lastRequestTo('POST', authorizePath);
    expect(authorize, isNotNull);
    // The backend enforces its MIME allowlist and size ceiling on these three
    // fields, so an over-limit note is refused before any bytes are spent.
    expect(authorize!.json['kind'], 'voice');
    expect(authorize.json['mimeType'], 'audio/mp4');
    expect(authorize.json['byteSize'], voiceBytes.length);
  });

  test('the bytes reach the signed url unchanged, and the result is usable', () async {
    final file = writeRecording(voiceBytes);
    server.on('POST', authorizePath, [Reply.ok(grant())]);
    server.on('PUT', storagePath, [const Reply(201, null)]);

    final uploaded = await repository.uploadVoiceNote(
      conversationId: conversationId,
      note: note(file),
    );

    final put = server.lastRequestTo('PUT', storagePath);
    expect(put, isNotNull, reason: 'the upload never reached the signed url');

    // The signature is part of the URL, so the query has to survive the client.
    expect(put!.query['sig'], 'deadbeef');
    expect(put.query['expires'], '1789000000');
    expect(put.query['size'], '512');

    // Storage signed this content type and verifies it; sending another one is
    // a 403 rather than a stored object with the wrong MIME.
    expect(put.headers['content-type'], 'audio/mp4');
    // Dio infers no length for a streamed body, so the uploader sets it. Without
    // it the reference storage refuses the upload outright.
    expect(put.headers['content-length'], '${voiceBytes.length}');

    // The point of the whole test: byte-for-byte, not merely the right size.
    expect(put.bodyBytes, orderedEquals(voiceBytes));

    // What the caller then sends as the message's attachment.
    expect(uploaded.kind, MessageKind.voice);
    expect(uploaded.objectKey, objectKey);
    expect(uploaded.mimeType, 'audio/mp4');
    expect(uploaded.byteSize, voiceBytes.length);
    expect(uploaded.durationMs, 7000);
  });

  test('a refused upload is reported, not swallowed', () async {
    final file = writeRecording(voiceBytes);
    server.on('POST', authorizePath, [Reply.ok(grant())]);
    server.on('PUT', storagePath, [const Reply(500, null)]);

    await expectLater(
      repository.uploadVoiceNote(conversationId: conversationId, note: note(file)),
      throwsA(
        isA<AppError>()
            .having((e) => e.kind, 'kind', AppErrorKind.server)
            // The outbox decides whether to retry from this, so a storage
            // failure that reported itself as permanent would strand the note.
            .having((e) => e.isTransient, 'isTransient', isTrue),
      ),
    );

    expect(server.countOf('PUT', storagePath), 1);
  });

  test('an authorization missing its url is refused before anything is sent', () async {
    final file = writeRecording(voiceBytes);
    server.on('POST', authorizePath, [
      const Reply.ok({'objectKey': objectKey, 'method': 'PUT'}),
    ]);

    await expectLater(
      repository.uploadVoiceNote(conversationId: conversationId, note: note(file)),
      throwsA(
        isA<AppError>().having(
          (e) => e.code,
          'code',
          'malformed_upload_authorization',
        ),
      ),
    );

    // Nothing was uploaded anywhere, because there was nowhere to upload to.
    expect(server.countOf('PUT', storagePath), 0);
  });

  test('a recording that changed size since it was authorized is not sent', () async {
    // The authorization bound a length; storage verifies it. Catching the drift
    // here gives a diagnosable failure instead of an opaque 403 from storage.
    final file = writeRecording(voiceBytes);
    server.on('POST', authorizePath, [Reply.ok(grant())]);
    server.on('PUT', storagePath, [const Reply(201, null)]);

    await expectLater(
      repository.uploadVoiceNote(
        conversationId: conversationId,
        note: note(file, byteSize: voiceBytes.length - 1),
      ),
      throwsA(
        isA<AppError>().having((e) => e.code, 'code', 'voice_note_size_changed'),
      ),
    );

    expect(server.countOf('PUT', storagePath), 0);
  });
}
