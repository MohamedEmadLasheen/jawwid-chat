import '../../network/api_client.dart';
import '../repositories.dart';

/// `NotificationRepository` over the published REST contract.
///
/// The endpoint already existed and is used verbatim; nothing here invents a
/// second device-token route.
class HttpNotificationRepository implements NotificationRepository {
  const HttpNotificationRepository({required ApiClient client}) : _client = client;

  final ApiClient _client;

  @override
  Future<void> registerDevice({
    required String token,
    required String platform,
    bool isVoip = false,
    String? locale,
  }) async {
    await _client.post<Map<String, Object?>>(
      '/notifications/devices',
      data: {
        'token': token,
        'platform': platform,
        'isVoip': isVoip,
        'locale': ?locale,
      },
    );
  }

  @override
  Future<void> unregisterDevice(String token) async {
    // Path-encoded: a registration token is opaque and may contain characters
    // that are not safe in a path segment.
    await _client.delete<Map<String, Object?>>(
      '/notifications/devices/${Uri.encodeComponent(token)}',
    );
  }
}
