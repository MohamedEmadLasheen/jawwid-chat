import '../../network/api_client.dart';
import '../repositories.dart';

/// [AccountDeletionRepository] on the session's authenticated client (PD-56).
class HttpAccountDeletionRepository implements AccountDeletionRepository {
  HttpAccountDeletionRepository({required ApiClient client}) : _client = client;

  final ApiClient _client;

  @override
  Future<void> deleteAccount({required String password}) async {
    await _client.post<Map<String, Object?>>('/me/account/delete', data: {'password': password});
  }
}
