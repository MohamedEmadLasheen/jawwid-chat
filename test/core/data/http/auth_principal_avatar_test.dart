import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/data/http/http_auth_repository.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';
import 'package:jawwid_chat/shared/utils/signed_url.dart';

/// The principal carries the account avatar, and carries it as a STABLE url.
///
/// A session can outlive any signature, so the URL held in `AuthUser` must be one that
/// stays valid for the life of that session: the application's own authenticated endpoint,
/// signed server-side on each read. A presigned URL here would render once and then rot,
/// which looks exactly like "the avatar never changes".
///
/// `principalFrom` is the one place the app decides who holds a session, so it is exercised
/// directly rather than only through a scripted login.
void main() {
  Map<String, Object?> actor({Object? avatarUrl = _absent}) => {
        'actorId': 'u_1',
        'kind': 'teacher',
        'displayName': 'Ahmed Hassan',
        'locale': 'ar',
        if (avatarUrl != _absent) 'avatarUrl': avatarUrl,
      };

  test('an avatar url on the actor reaches the principal', () {
    final user = HttpAuthRepository.principalFrom(
      actor(avatarUrl: 'http://api.test/api/v1/me/avatar/image'),
    );

    expect(user.avatarUrl, 'http://api.test/api/v1/me/avatar/image');
    expect(user.id, 'u_1');
    expect(user.role, UserRole.teacher);
  });

  test('no avatarUrl field at all leaves the principal with none', () {
    expect(HttpAuthRepository.principalFrom(actor()).avatarUrl, isNull);
  });

  test('a null avatarUrl leaves the principal with none', () {
    expect(HttpAuthRepository.principalFrom(actor(avatarUrl: null)).avatarUrl,
        isNull);
  });

  test('an EMPTY avatarUrl is none, not an empty-string image request', () {
    // `Image.network('')` throws rather than falling back to initials, so an empty
    // string must never survive the mapping.
    expect(HttpAuthRepository.principalFrom(actor(avatarUrl: '')).avatarUrl,
        isNull);
  });

  test('a non-string avatarUrl is ignored rather than crashing the session', () {
    expect(HttpAuthRepository.principalFrom(actor(avatarUrl: 42)).avatarUrl,
        isNull);
  });

  group('the published path is resolved to an absolute url, once, centrally', () {
    const published = '/api/v1/me/avatar/image';

    test('a base that already carries /api/v1 does not gain a second one', () {
      expect(
        HttpAuthRepository.avatarImageUrl(
          published,
          baseUrl: 'http://Mohameds-MacBook-Pro.local:3199/api/v1',
        ),
        // Lower-cased host: `Uri` normalises it, because RFC 3986 says a host is
        // case-insensitive. Asserted deliberately rather than worked around — mDNS
        // resolves it either way, and a test that demanded the original casing would
        // be testing a spelling instead of the join.
        'http://mohameds-macbook-pro.local:3199/api/v1/me/avatar/image',
        reason: 'root-relative resolution replaces the path, it does not append',
      );
    });

    test('a bare-host base resolves just as well', () {
      expect(
        HttpAuthRepository.avatarImageUrl(published, baseUrl: 'https://api.jawwid.test'),
        'https://api.jawwid.test/api/v1/me/avatar/image',
      );
    });

    test('the url is stable: the same identity resolves identically every time', () {
      // What a refresh does — the path is a constant, so two reads cannot disagree.
      final first = HttpAuthRepository.principalFrom(
        actor(avatarUrl: published),
        baseUrl: 'https://api.jawwid.test/api/v1',
      );
      final second = HttpAuthRepository.principalFrom(
        actor(avatarUrl: published),
        baseUrl: 'https://api.jawwid.test/api/v1',
      );

      expect(first.avatarUrl, second.avatarUrl);
      expect(first.avatarUrl, 'https://api.jawwid.test/api/v1/me/avatar/image');
    });

    test('an already-absolute url passes through untouched', () {
      expect(
        HttpAuthRepository.avatarImageUrl(
          'https://cdn.jawwid.test/x.jpg',
          baseUrl: 'https://api.jawwid.test/api/v1',
        ),
        'https://cdn.jawwid.test/x.jpg',
      );
    });

    test('with no base configured the path is left as it came', () {
      expect(HttpAuthRepository.avatarImageUrl(published), published);
    });

    test('a malformed base does not take the session down', () {
      expect(
        HttpAuthRepository.avatarImageUrl(published, baseUrl: ':::not a url:::'),
        published,
        reason: 'a bad base degrades to the raw path, it does not throw',
      );
    });
  });

  group('identity never carries a credential or a key', () {
    test('the resolved url carries no SigV4 and no storage host', () {
      final user = HttpAuthRepository.principalFrom(
        actor(avatarUrl: '/api/v1/me/avatar/image'),
        baseUrl: 'http://Mohameds-MacBook-Pro.local:3199/api/v1',
      );

      final url = user.avatarUrl!;
      expect(url, isNot(contains('X-Amz-Signature')));
      expect(url, isNot(contains('X-Amz-Algorithm')));
      expect(url, isNot(contains('X-Amz-Credential')));
      expect(url, isNot(contains(':9010')), reason: 'the MinIO endpoint is not identity');
      expect(url, isNot(contains('avatars/')), reason: 'an object key is not identity');
      expect(url, endsWith('/api/v1/me/avatar/image'));
    });

    test('a presigned url is NOT what the contract sends, and is detectable if it ever is',
        () {
      // Guards the contract from the client side: if a future server regressed to signing
      // in /me, `urlAuthenticatesItself` would see it and M5 would withhold the bearer —
      // so the failure would be a visible wrong-auth, not a silent credential leak.
      const presigned =
          'http://storage.test/avatars/a.jpg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=d';
      expect(urlAuthenticatesItself(presigned), isTrue);
      expect(urlAuthenticatesItself('http://api.test/api/v1/me/avatar/image'), isFalse);
    });
  });

  test('the other principal fields still map alongside the avatar', () {
    final user = HttpAuthRepository.principalFrom(
      actor(avatarUrl: 'http://api.test/api/v1/me/avatar/image'),
    );

    expect(user.displayName, 'Ahmed Hassan');
    expect(user.locale, 'ar');
  });
}

/// Distinguishes "the key is absent" from "the key is present and null".
const Object _absent = Object();
