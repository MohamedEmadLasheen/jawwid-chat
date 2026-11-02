/// PARENT-017: a video goes up through the same grant flow as a photo, with
/// its progress reported as it goes, its length carried to the message, and a
/// way to stop it.
///
/// Through the real HttpMessageRepository and the production uploader against
/// a local server: a fake uploader would test the fake.
library;

import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/data/http/attachment_uploader.dart';
import 'package:jawwid_chat/core/data/http/http_message_repository.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
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

void main() {
  late TestServer server;
  late Directory dir;
  late HttpMessageRepository repository;

  const conversationId = 'c1';
  const objectKey = 'conversations/c1/8a1f0c2e-0000-4000-8000-00000000c0de';
  const authorizePath = '/conversations/c1/messages/attachments/authorize';
  const storagePath = '/storage/$objectKey';

  // Several upload chunks (64 KB each), every byte value present.
  final videoBytes = Uint8List.fromList(List<int>.generate(300 * 1024, (i) => (i * 31 + 7) % 256));

  Map<String, Object?> grant() => {
        'objectKey': objectKey,
        'uploadUrl': '${server.baseUrl}$storagePath?expires=1789000000&size=${videoBytes.length}&sig=deadbeef',
        'method': 'PUT',
        'headers': const {'content-type': 'video/quicktime'},
        'expiresAt': '2026-11-02T12:00:00.000Z',
      };

  PendingAttachment video(File file) => PendingAttachment(
        filePath: file.path,
        kind: MessageKind.video,
        mimeType: 'video/quicktime',
        byteSize: file.lengthSync(),
        fileName: 'clip.mov',
        duration: const Duration(seconds: 42),
      );

  setUp(() async {
    server = await TestServer.start();
    dir = Directory.systemTemp.createTempSync('video_upload_http');
    repository = HttpMessageRepository(
      client: buildApiClient(config: ApiConfig(baseUrl: server.baseUrl), tokens: _NoTokens()),
      viewerActorId: () => 'me',
    );
  });

  tearDown(() async {
    if (dir.existsSync()) dir.deleteSync(recursive: true);
    await server.stop();
  });

  File writeVideo() => File('${dir.path}${Platform.pathSeparator}clip.mov')..writeAsBytesSync(videoBytes);

  test('a video is authorized as a video, arrives unchanged, reports progress and carries its length', () async {
    server.on('POST', authorizePath, [Reply.ok(grant())]);
    server.on('PUT', storagePath, [const Reply(201, null)]);
    final progress = <int>[];

    final uploaded = await repository.uploadAttachment(
      conversationId: conversationId,
      attachment: video(writeVideo()),
      onProgress: (sent, total) {
        expect(total, videoBytes.length);
        progress.add(sent);
      },
    );

    final authorize = server.lastRequestTo('POST', authorizePath)!;
    expect(authorize.json['kind'], 'video');
    expect(authorize.json['mimeType'], 'video/quicktime');
    expect(authorize.json['byteSize'], videoBytes.length);

    final put = server.lastRequestTo('PUT', storagePath)!;
    expect(put.headers['content-type'], 'video/quicktime');
    expect(put.headers['content-length'], '${videoBytes.length}');
    expect(put.bodyBytes, orderedEquals(videoBytes));

    // Reported as it went, not once at the end, and never backwards.
    expect(progress.length, greaterThan(1));
    expect(progress.last, videoBytes.length);
    for (var i = 1; i < progress.length; i++) {
      expect(progress[i], greaterThanOrEqualTo(progress[i - 1]));
    }

    expect(uploaded.kind, MessageKind.video);
    expect(uploaded.objectKey, objectKey);
    expect(uploaded.durationMs, 42000);
  });

  test('a cancelled upload stops, and says it was cancelled -- not a failure to retry', () async {
    server.on('POST', authorizePath, [Reply.ok(grant())]);
    server.on('PUT', storagePath, [const Reply(201, null, delay: Duration(seconds: 2))]);
    final cancel = UploadCancel();

    await expectLater(
      repository.uploadAttachment(
        conversationId: conversationId,
        attachment: video(writeVideo()),
        onProgress: (_, _) => cancel.cancel(),
        cancel: cancel,
      ),
      throwsA(isA<AppError>().having((e) => e.code, 'code', AppError.uploadCancelled)),
    );
    expect(cancel.isCancelled, isTrue);
  });
}
