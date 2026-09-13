import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/data/fake_backend.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/shared/models/message.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

/// A fixture build has no backend, so it *is* the storage. If it does not keep
/// the recording, a voice note cannot be played back after it is sent — which
/// is not a cosmetic gap: the sender's own copy is deleted the moment the send
/// is confirmed, so the note is simply gone.
void main() {
  late FakeBackend backend;
  late Directory recordings;

  setUp(() {
    backend = FakeBackend(role: UserRole.parent);
    recordings = Directory.systemTemp.createTempSync('voice_source');
  });

  tearDown(() {
    backend.dispose();
    if (recordings.existsSync()) recordings.deleteSync(recursive: true);
  });

  /// Stands in for a recording: the bytes are arbitrary, but they are the bytes
  /// that must come back out.
  File writeRecording(String name, Uint8List bytes) =>
      File('${recordings.path}${Platform.pathSeparator}$name')
        ..writeAsBytesSync(bytes);

  Message send(UploadedAttachment uploaded) => backend.send(
        OutgoingMessage(
          clientMessageId: 'c1',
          conversationId: 'c_support',
          kind: MessageKind.voice,
          attachments: [uploaded],
        ),
      );

  test('a sent voice note is playable after the sender drops its copy', () {
    final bytes = Uint8List.fromList(List.generate(2048, (i) => i % 256));
    final recording = writeRecording('voice_1.m4a', bytes);

    final uploaded = backend.uploadVoiceNote(
      'c_support',
      PendingVoiceNote(
        filePath: recording.path,
        mimeType: 'audio/mp4',
        byteSize: bytes.length,
        duration: const Duration(seconds: 7),
      ),
    );
    final confirmed = send(uploaded);

    // MessagesController deletes the temp recording as soon as the send is
    // confirmed, so from here the fixture's copy is the only one there is.
    recording.deleteSync();

    final url = confirmed.attachments.single.url;
    expect(url, isNotNull);
    // VoicePlayer sends an http(s) url to setUrl and anything else to
    // setFilePath. A fixture build has nothing serving http, so a url the
    // player would fetch is a url that cannot play.
    expect(
      url!.startsWith('http'),
      isFalse,
      reason: 'a fixture build cannot fetch a note over the network',
    );
    expect(File(url).existsSync(), isTrue);
    expect(File(url).readAsBytesSync(), bytes);
    // AVFoundation picks its demuxer from the extension.
    expect(url.endsWith('.m4a'), isTrue);
  });

  test('two notes are kept apart', () {
    final first = writeRecording('a.m4a', Uint8List.fromList([1, 2, 3]));
    final second = writeRecording('b.m4a', Uint8List.fromList([9, 9, 9, 9]));

    PendingVoiceNote note(File f) => PendingVoiceNote(
          filePath: f.path,
          mimeType: 'audio/mp4',
          byteSize: f.lengthSync(),
          duration: const Duration(seconds: 3),
        );

    final a = backend.uploadVoiceNote('c_support', note(first));
    final b = backend.uploadVoiceNote('c_support', note(second));

    final urlA = send(a).attachments.single.url!;
    final urlB = backend
        .send(
          OutgoingMessage(
            clientMessageId: 'c2',
            conversationId: 'c_support',
            kind: MessageKind.voice,
            attachments: [b],
          ),
        )
        .attachments
        .single
        .url!;

    expect(urlA, isNot(urlB));
    expect(File(urlA).readAsBytesSync(), [1, 2, 3]);
    expect(File(urlB).readAsBytesSync(), [9, 9, 9, 9]);
  });

  test('a note with no file behind it still sends', () {
    // Most tests hand this fixture a name rather than a recording. That must
    // stay a send that succeeds, not a crash.
    final uploaded = backend.uploadVoiceNote(
      'c_support',
      const PendingVoiceNote(
        filePath: '/nowhere/voice.m4a',
        mimeType: 'audio/mp4',
        byteSize: 1024,
        duration: Duration(seconds: 2),
      ),
    );

    final url = send(uploaded).attachments.single.url;
    expect(url, startsWith('https://fixtures.invalid/'));
  });

  test('dispose removes what the fixture kept', () {
    final recording = writeRecording('c.m4a', Uint8List.fromList([7, 7]));
    final uploaded = backend.uploadVoiceNote(
      'c_support',
      PendingVoiceNote(
        filePath: recording.path,
        mimeType: 'audio/mp4',
        byteSize: 2,
        duration: const Duration(seconds: 2),
      ),
    );
    final url = send(uploaded).attachments.single.url!;
    expect(File(url).existsSync(), isTrue);

    backend.dispose();

    expect(File(url).existsSync(), isFalse);
  });
}
