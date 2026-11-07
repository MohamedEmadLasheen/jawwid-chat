import '../../../shared/models/legal.dart';
import '../../network/api_client.dart';
import '../../storage/secure_token_store.dart';
import '../repositories.dart';
import 'http_auth_repository.dart';

/// [PasswordChangeRepository] on the session's authenticated client (TEACHER-023).
class HttpPasswordChangeRepository implements PasswordChangeRepository {
  HttpPasswordChangeRepository({
    required ApiClient client,
    required TokenStore tokens,
    void Function(LegalStatus legal)? onLegal,
  })  : _client = client,
        _tokens = tokens,
        _onLegal = onLegal;

  final ApiClient _client;
  final TokenStore _tokens;

  /// PD-58: the new token pair's `legal` block, handed on when the server sent one.
  final void Function(LegalStatus legal)? _onLegal;

  /// The server ROTATES this device's session on a change -- a refresh token that leaked
  /// from this device is dead with it -- and answers with the successor's token pair. It is
  /// stored before returning: the next request, and the next refresh, must present the new
  /// pair, because the old one is already revoked.
  @override
  Future<void> change({required String currentPassword, required String newPassword}) async {
    final response = await _client.post<Map<String, Object?>>('/auth/password/change', data: {
      'currentPassword': currentPassword,
      'newPassword': newPassword,
    });
    final session = HttpAuthRepository.sessionFrom(response.data);
    await _tokens.write(session);
    final legal = session.legal;
    if (legal != null) _onLegal?.call(legal);
  }
}
