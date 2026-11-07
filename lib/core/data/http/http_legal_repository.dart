import '../../../shared/models/legal.dart';
import '../../network/api_client.dart';
import '../repositories.dart';

/// [LegalRepository] on the session's authenticated client (PD-58, API-CONTRACT §1.1c,
/// `apps/api/src/legal/legal.controller.ts`).
///
/// The account is always the token's: the body names documents, the client and the
/// language, and nothing else -- the server refuses any other field.
class HttpLegalRepository implements LegalRepository {
  HttpLegalRepository({required ApiClient client}) : _client = client;

  final ApiClient _client;

  @override
  Future<LegalStatus> current() async {
    final body = (await _client.get<Map<String, Object?>>('/me/legal')).data;
    // The block IS the body here; a body this build cannot read is never "accepted".
    return LegalStatus.fromWire(body);
  }

  @override
  Future<LegalStatus> accept({required List<LegalDocument> documents, required String client, required String locale}) async {
    final response = await _client.post<Map<String, Object?>>('/me/legal/accept', data: {
      'documents': [for (final d in documents) d.toAcceptance()],
      'client': client,
      'locale': locale,
    });
    return LegalStatus.fromWire(response.data?['legal']);
  }
}
