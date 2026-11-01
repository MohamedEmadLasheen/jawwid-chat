import '../../network/api_client.dart';
import '../repositories.dart';

/// [PasswordChangeRepository] on the session's authenticated client (TEACHER-023).
class HttpPasswordChangeRepository implements PasswordChangeRepository {
  HttpPasswordChangeRepository({required ApiClient client}) : _client = client;

  final ApiClient _client;

  @override
  Future<void> change({required String currentPassword, required String newPassword}) async {
    await _client.post<Object?>('/auth/password/change', data: {
      'currentPassword': currentPassword,
      'newPassword': newPassword,
    });
  }
}
