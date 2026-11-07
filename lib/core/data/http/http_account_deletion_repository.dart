import '../../network/api_client.dart';
import '../repositories.dart';

/// [AccountDeletionRepository] on the session's authenticated client (PD-56; O-3 requests).
class HttpAccountDeletionRepository implements AccountDeletionRepository {
  HttpAccountDeletionRepository({required ApiClient client}) : _client = client;

  final ApiClient _client;

  @override
  Future<AccountDeletionOutcome> deleteAccount({required String password}) async {
    final body = (await _client.post<Map<String, Object?>>('/me/account/delete', data: {'password': password})).data;
    final request = body?['request'];
    if (body?['deleted'] == false && request is Map) {
      return AccountDeletionOutcome.requested(AccountDeletionRequest.fromJson(request.cast<String, Object?>()));
    }
    return const AccountDeletionOutcome.deleted();
  }

  @override
  Future<AccountDeletionStatus> status() async {
    final body = (await _client.get<Map<String, Object?>>('/me/account/deletion')).data ?? const <String, Object?>{};
    final request = body['request'];
    return AccountDeletionStatus(
      immediate: body['immediate'] != false,
      request: request is Map ? AccountDeletionRequest.fromJson(request.cast<String, Object?>()) : null,
      deadlineIfRequested: DateTime.parse(body['deadlineIfRequested'] as String),
    );
  }

  @override
  Future<AccountDeletionRequest> cancelRequest() async {
    final body = (await _client.post<Map<String, Object?>>('/me/account/deletion-request/cancel', data: const <String, Object?>{})).data;
    return AccountDeletionRequest.fromJson((body?['request'] as Map).cast<String, Object?>());
  }
}
