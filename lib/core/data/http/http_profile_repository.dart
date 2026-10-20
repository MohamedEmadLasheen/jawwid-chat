import '../../../shared/models/parent_profile.dart';
import '../../errors/app_error.dart';
import '../../network/api_client.dart';
import '../repositories.dart';

/// `ProfileRepository` over the published REST contract.
///
/// | Method | Path | Purpose |
/// |---|---|---|
/// | GET | `/me/profile` | the caller's own profile and their family's children |
/// | PATCH | `/me/profile` | save the caller's own name and/or About |
/// | PATCH | `/me/children/:id` | the same, for a child of the caller's family |
///
/// ## None of these take a parent id
///
/// There is no `:parentId` above, because the server reads the caller from the bearer
/// token. The one id that travels is a CHILD's, and it carries no authority: the server
/// resolves it only inside the caller's own family, so a learner belonging to anybody else
/// is simply not found.
///
/// ## The photos are not here
///
/// They are the account photos, set through `HttpProfilePhotoRepository` (`/me/avatar`,
/// `/me/children/:id/avatar`). `GET /me/profile` carries their links.
class HttpProfileRepository implements ProfileRepository {
  HttpProfileRepository({required ApiClient client}) : _client = client;

  final ApiClient _client;

  @override
  Future<ParentProfile> me() async {
    final response = await _client.get<Map<String, Object?>>('/me/profile');
    return _profile(response.data);
  }

  @override
  Future<ParentProfile> updateMe({String? name, String? about}) async {
    final response = await _client.patch<Map<String, Object?>>(
      '/me/profile',
      data: _edit(name: name, about: about),
    );
    return _profile(response.data);
  }

  @override
  Future<ParentProfile> updateChild(String childId, {String? name, String? about}) async {
    final response = await _client.patch<Map<String, Object?>>(
      '/me/children/$childId',
      data: _edit(name: name, about: about),
    );
    return _profile(response.data);
  }

  // -------------------------------------------------------------------------

  /// The PATCH body for an edit.
  ///
  /// A field is sent only when the caller passed one, because the contract treats an absent
  /// field as "leave it alone". An empty About is sent deliberately — that is how a parent
  /// clears it — so only `null` means "do not touch".
  static Map<String, Object?> _edit({String? name, String? about}) => {
        'name': ?name,
        'about': ?about,
      };

  static ParentProfile _profile(Map<String, Object?>? json) {
    if (json == null) {
      throw const AppError(
        AppErrorKind.server,
        code: 'malformed_profile',
        debugDetail: 'the profile response carried no body',
      );
    }
    final rows = (json['children'] as List?) ?? const [];
    return ParentProfile(
      displayName: (json['displayName'] as String?) ?? '',
      relationship: _text(json['relationship']),
      signInIdentity: _text(json['signInIdentity']),
      about: _text(json['about']),
      avatarUrl: _text(json['avatarUrl']),
      canMessage: json['canMessage'] != false,
      children: [
        for (final row in rows)
          if (row is Map<String, Object?> && (row['id'] as String?) != null)
            ChildProfile(
              id: row['id']! as String,
              displayName: (row['displayName'] as String?) ?? '',
              level: _text(row['level']),
              about: _text(row['about']),
              avatarUrl: _text(row['avatarUrl']),
            ),
      ],
    );
  }

  /// Blank is absent. A server that sends `""` means "nothing here", and the UI must draw
  /// that as the empty state rather than as an empty string.
  static String? _text(Object? raw) {
    if (raw is! String) return null;
    final trimmed = raw.trim();
    return trimmed.isEmpty ? null : trimmed;
  }
}
