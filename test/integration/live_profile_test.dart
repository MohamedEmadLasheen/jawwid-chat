import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/data/http/http_auth_repository.dart';
import 'package:jawwid_chat/core/data/http/http_profile_repository.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/network/api_client.dart';
import 'package:jawwid_chat/core/network/api_config.dart';
import 'package:jawwid_chat/core/network/device_descriptor.dart';
import 'package:jawwid_chat/core/network/http_stack.dart';
import 'package:jawwid_chat/core/storage/secure_token_store.dart';
import 'package:jawwid_chat/shared/models/message.dart';

/// The parent profile client against a **running backend and a real database**.
///
/// `test/core/data/http/profile_over_http_test.dart` proves the wire format against a
/// scripted server: the paths, the PATCH body, the two-step upload. It cannot prove that the
/// real API agrees, because it is the one writing the replies. This suite closes that gap --
/// it signs in with `POST /auth/login`, drives `HttpProfileRepository` exactly as the app
/// does, and asserts against what a real server actually returns.
///
/// It is the only place where the whole stack for this feature runs end to end in Dart:
/// token, client, repository, API, authorization, Postgres, object storage, signed URL.
///
/// Skipped unless pointed at a server, like its sibling, so CI without a backend stays
/// green. It signs in; there is no seeded token and no bypass.
///
/// ```
/// JAWWID_LIVE_API=http://127.0.0.1:3277/api/v1 \
/// JAWWID_LIVE_PARENT_USERNAME=<subject> \
/// JAWWID_LIVE_PARENT_PASSWORD=<password> \
/// JAWWID_LIVE_OTHER_PARENT_USERNAME=<subject in a DIFFERENT family> \
/// JAWWID_LIVE_OTHER_PARENT_PASSWORD=<password> \
/// flutter test test/integration/live_profile_test.dart
/// ```
///
/// Credentials come from the environment and are never committed.
class _LiveParent {
  _LiveParent._({required this.auth, required this.profile});

  final HttpAuthRepository auth;
  final HttpProfileRepository profile;

  static Future<_LiveParent> signIn({
    required String baseUrl,
    required String username,
    required String password,
  }) async {
    final store = InMemoryTokenStore();
    late final ApiClient client;

    final auth = HttpAuthRepository(
      transport: buildAuthTransport(config: ApiConfig(baseUrl: baseUrl)),
      protected: () => client,
      device: _TestDevice(),
      currentAccessToken: () async => (await store.read())?.accessToken,
    );

    client = buildApiClient(
      config: ApiConfig(baseUrl: baseUrl),
      tokens: StoredTokenProvider(store: store, auth: auth, onEnded: (_) async {}),
    );

    final session = await auth.signIn(username: username, password: password);
    await store.write(session);

    return _LiveParent._(
      auth: auth,
      profile: HttpProfileRepository(client: client),
    );
  }
}

class _TestDevice implements DeviceDescriptor {
  @override
  Future<DeviceDescription?> describe() async => const DeviceDescription(
        platform: 'ios',
        name: 'flutter profile integration suite',
        appVersion: '0.0.0-test',
      );
}

/// A real, tiny JPEG. The server binds the signature to the declared type and size, so
/// anything that is not actually an image of this length would be refused by storage.
final _jpeg = Uint8List.fromList([
  0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, //
  0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xFF, 0xDB, 0x00, 0x43,
  0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
  0xFF, 0xD9,
]);

void main() {
  final env = Platform.environment;
  final baseUrl = env['JAWWID_LIVE_API'];
  final username = env['JAWWID_LIVE_PARENT_USERNAME'];
  final password = env['JAWWID_LIVE_PARENT_PASSWORD'];
  final otherUsername = env['JAWWID_LIVE_OTHER_PARENT_USERNAME'];
  final otherPassword = env['JAWWID_LIVE_OTHER_PARENT_PASSWORD'];

  final configured = baseUrl != null &&
      username != null &&
      password != null &&
      otherUsername != null &&
      otherPassword != null;

  late _LiveParent me;
  late _LiveParent other;
  late Directory scratch;

  group(
    'the parent profile, live',
    skip: configured
        ? false
        : 'set JAWWID_LIVE_API, JAWWID_LIVE_PARENT_* and JAWWID_LIVE_OTHER_PARENT_* to run '
            'against a real server',
    () {
      setUpAll(() async {
        me = await _LiveParent.signIn(
          baseUrl: baseUrl!,
          username: username!,
          password: password!,
        );
        other = await _LiveParent.signIn(
          baseUrl: baseUrl,
          username: otherUsername!,
          password: otherPassword!,
        );
        scratch = await Directory.systemTemp.createTemp('jawwid-live-profile');
      });

      tearDownAll(() async {
        await scratch.delete(recursive: true);
        // Leave no live sessions behind.
        await me.auth.signOut();
        await other.auth.signOut();
      });

      Future<PendingAttachment> photo() async {
        final file = File('${scratch.path}/avatar-${DateTime.now().microsecondsSinceEpoch}.jpg');
        await file.writeAsBytes(_jpeg);
        return PendingAttachment(
          filePath: file.path,
          kind: MessageKind.image,
          mimeType: 'image/jpeg',
          byteSize: _jpeg.length,
        );
      }

      test('a signed-in parent reads their own profile and their children', () async {
        final profile = await me.profile.me();

        expect(profile.displayName, isNotEmpty);
        expect(profile.children, isNotEmpty, reason: 'the QA family has learners');
        // No id the client could tamper with travels in either direction.
        expect(profile.children.every((c) => c.id.isNotEmpty), isTrue);
      });

      test('a name and an About round-trip through the real server', () async {
        final stamp = DateTime.now().microsecondsSinceEpoch;

        final saved = await me.profile.updateMe(
          name: 'Live QA $stamp',
          about: 'Set by the live suite at $stamp.',
        );
        expect(saved.displayName, 'Live QA $stamp');
        expect(saved.about, 'Set by the live suite at $stamp.');

        // And a fresh GET agrees, so what came back was persisted and not echoed.
        final reread = await me.profile.me();
        expect(reread.displayName, 'Live QA $stamp');
        expect(reread.about, 'Set by the live suite at $stamp.');
      });

      test('an omitted field is left alone, and an empty About clears it', () async {
        // The three-way distinction the client encodes -- absent, empty, value -- against a
        // server that really implements it rather than a double that was told to.
        await me.profile.updateMe(name: 'Keep This Name', about: 'temporary');

        final aboutOnly = await me.profile.updateMe(about: '');
        expect(aboutOnly.about, isNull, reason: 'empty clears');
        expect(aboutOnly.displayName, 'Keep This Name', reason: 'omitted leaves alone');
      });

      test('a blank name is refused by the server, not by the client', () async {
        await expectLater(
          me.profile.updateMe(name: '   '),
          throwsA(isA<AppError>()),
        );
        // And the profile is unharmed.
        expect((await me.profile.me()).displayName, isNotEmpty);
      });

      test("a child's own name and About round-trip, leaving siblings alone", () async {
        final before = await me.profile.me();
        final target = before.children.first;
        final others = before.children.skip(1).toList();
        final stamp = DateTime.now().microsecondsSinceEpoch;

        final saved = await me.profile.updateChild(
          target.id,
          name: 'Live Child $stamp',
          about: 'Noted at $stamp.',
        );

        final updated = saved.children.firstWhere((c) => c.id == target.id);
        expect(updated.displayName, 'Live Child $stamp');
        expect(updated.about, 'Noted at $stamp.');
        for (final sibling in others) {
          final after = saved.children.firstWhere((c) => c.id == sibling.id);
          expect(after.displayName, sibling.displayName);
          expect(after.about, sibling.about);
        }
      });

      test('a photo uploads, and the signed URL it returns really serves it', () async {
        // The whole two-step: authorize, PUT the bytes straight to storage, commit the key.
        // The URL is then fetched over plain HTTP with NO token, exactly as `Image.network`
        // would -- which is the half a widget test can never exercise.
        final saved = await me.profile.setAvatar(await photo());

        expect(saved.hasPhoto, isTrue);
        final url = saved.avatarUrl!;
        expect(url, contains('expires='));
        expect(url, contains('sig='));

        final response = await HttpClient().getUrl(Uri.parse(url)).then((r) => r.close());
        expect(response.statusCode, 200);
        final bytes = await response.fold<List<int>>([], (a, b) => a..addAll(b));
        expect(bytes, _jpeg, reason: 'the exact bytes that were uploaded');
      });

      test('the same object is refused without the signature', () async {
        final profile = await me.profile.me();
        final url = Uri.parse(profile.avatarUrl!);
        final unsigned = url.replace(queryParameters: const {});

        final response = await HttpClient().getUrl(unsigned).then((r) => r.close());
        expect(response.statusCode, anyOf(401, 403));
      });

      test('a photo can be removed', () async {
        final removed = await me.profile.removeAvatar();
        expect(removed.hasPhoto, isFalse);
        expect(removed.avatarUrl, isNull);
      });

      test("a child's photo is set and removed independently of the parent's", () async {
        final children = (await me.profile.me()).children;
        final target = children.first;

        final set = await me.profile.setChildAvatar(target.id, await photo());
        expect(set.children.firstWhere((c) => c.id == target.id).hasPhoto, isTrue);
        expect(set.hasPhoto, isFalse, reason: "the parent's own photo was removed earlier");

        final cleared = await me.profile.removeChildAvatar(target.id);
        expect(cleared.children.firstWhere((c) => c.id == target.id).hasPhoto, isFalse);
      });

      test("another family's child cannot be edited through this client", () async {
        // The client sends an id, so this is the IDOR path. The id is real -- it belongs to
        // somebody -- which is what makes the refusal meaningful.
        final mine = (await me.profile.me()).children.first;

        await expectLater(
          other.profile.updateChild(mine.id, name: 'Taken Over'),
          throwsA(isA<AppError>()),
        );

        // Unchanged, read back as its owner.
        final after = (await me.profile.me()).children.firstWhere((c) => c.id == mine.id);
        expect(after.displayName, isNot('Taken Over'));
      });

      test("another family's profile shows none of ours", () async {
        final stamp = DateTime.now().microsecondsSinceEpoch;
        await me.profile.updateMe(about: 'Private to my family, $stamp.');

        final theirs = await other.profile.me();

        expect(theirs.about ?? '', isNot(contains('$stamp')));
        final mineChildIds = (await me.profile.me()).children.map((c) => c.id).toSet();
        expect(
          theirs.children.map((c) => c.id).toSet().intersection(mineChildIds),
          isEmpty,
        );
      });
    },
  );
}
