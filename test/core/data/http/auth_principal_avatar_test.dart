import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/data/http/http_auth_repository.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

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
