import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/data/http/http_notification_repository.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/network/api_client.dart';
import 'package:jawwid_chat/core/network/api_config.dart';
import 'package:jawwid_chat/core/realtime/realtime_client.dart';
import 'package:jawwid_chat/core/realtime/realtime_events.dart';

/// The realtime transport, and what it means for the notification centre.
///
/// The property under test throughout: realtime is a SPEED-UP, not a source of
/// truth. Every event that arrives here is already in the database; a missed one
/// costs latency and is recovered by the re-sync on reconnect.
void main() {
  group('the transport carries the server contract, and only that', () {
    test('forwards a known event', () async {
      final client = InertRealtimeClient();
      addTearDown(client.dispose);

      final received = <RealtimeEvent>[];
      client.events.listen(received.add);

      client.emit(RealtimeEvents.notificationCreated, {'notificationId': 'n1'});
      await Future<void>.delayed(Duration.zero);

      expect(received.single.name, RealtimeEvents.notificationCreated);
      expect(received.single.payload['notificationId'], 'n1');
    });

    test('drops an event outside the contract', () async {
      final client = InertRealtimeClient();
      addTearDown(client.dispose);

      final received = <RealtimeEvent>[];
      client.events.listen(received.add);

      // A server that starts emitting something this build does not know must
      // not be able to push an unrecognised payload into the app's event stream.
      client.emit('admin.family_flagged', {'familyId': 'f1'});
      await Future<void>.delayed(Duration.zero);

      expect(received, isEmpty);
    });

    test('declares every event the backend contract names', () {
      // Mirrors apps/api/src/communication/contracts/events.ts. A rename on
      // either side should break a build rather than silently stop an event.
      expect(RealtimeEvents.all, contains('message.created'));
      expect(RealtimeEvents.all, contains('call.incoming'));
      expect(RealtimeEvents.all, contains('call.ended'));
      expect(RealtimeEvents.all, contains('approval.requested'));
      expect(RealtimeEvents.all, contains('notification.created'));
      expect(RealtimeEvents.all, hasLength(19));
    });
  });

  group('the notification repository consumes the SHARED transport', () {
    ({HttpNotificationRepository repository, InertRealtimeClient realtime}) harness() {
      final realtime = InertRealtimeClient();
      addTearDown(realtime.dispose);

      final repository = HttpNotificationRepository(
        client: ApiClient(dio: Dio(), tokens: _NoTokens()),
        realtime: realtime,
      );
      addTearDown(repository.dispose);

      return (repository: repository, realtime: realtime);
    }

    test('a notification.created event reaches the incoming stream', () async {
      final h = harness();
      final received = <String>[];
      h.repository.incoming.listen((n) => received.add(n.id));

      h.realtime.emit(RealtimeEvents.notificationCreated, {
        'notificationId': 'n1',
        'title': 'Ahmed’s teacher',
        'body': 'Sent you a message.',
        'conversationId': 'c1',
      });
      await Future<void>.delayed(Duration.zero);

      expect(received, ['n1']);
    });

    test('an event for another feature is ignored, not mishandled', () async {
      final h = harness();
      final received = <String>[];
      h.repository.incoming.listen((n) => received.add(n.id));

      // The transport is shared: the messages feature will listen to this one.
      // The notification repository takes its own event and leaves the rest.
      h.realtime.emit(RealtimeEvents.messageCreated, {
        'conversationId': 'c1',
        'messageId': 'm1',
      });
      await Future<void>.delayed(Duration.zero);

      expect(received, isEmpty);
    });

    test('a malformed payload is dropped rather than breaking the stream', () async {
      final h = harness();
      final received = <String>[];
      var errored = false;
      h.repository.incoming.listen(
        (n) => received.add(n.id),
        onError: (Object _) => errored = true,
      );

      h.realtime.emit(RealtimeEvents.notificationCreated, {'title': 'no id here'});
      // …and a good one right after, to prove the stream still works.
      h.realtime.emit(RealtimeEvents.notificationCreated, {'notificationId': 'n2'});
      await Future<void>.delayed(Duration.zero);

      expect(errored, isFalse);
      expect(received, ['n2']);
    });
  });

  group('the realtime URL is derived from the API URL', () {
    test('strips the HTTP-only version prefix', () {
      // The backend mounts /api/v1 on HTTP only (main.ts setGlobalPrefix); the
      // gateway is attached to the server root.
      const config = ApiConfig(baseUrl: 'https://api.jawwid.test/api/v1');
      expect(config.realtimeBaseUrl, 'https://api.jawwid.test');
    });

    test('keeps a non-default port', () {
      const config = ApiConfig(baseUrl: 'http://10.0.2.2:3000/api/v1');
      expect(config.realtimeBaseUrl, 'http://10.0.2.2:3000');
    });

    test('is the same origin as the API, so the two cannot be configured apart', () {
      const config = ApiConfig(baseUrl: 'https://api.jawwid.test/api/v1');
      expect(
        Uri.parse(config.realtimeBaseUrl).origin,
        Uri.parse(config.baseUrl).origin,
      );
    });
  });

  group('a connection gap', () {
    test('status transitions are observable, so the UI can say "reconnecting"', () async {
      final client = InertRealtimeClient();
      addTearDown(client.dispose);

      final seen = <RealtimeStatus>[];
      client.status.listen(seen.add);

      await client.connect('token');
      client.setStatus(RealtimeStatus.disconnected);
      client.setStatus(RealtimeStatus.reconnecting);
      client.setStatus(RealtimeStatus.connected);
      await Future<void>.delayed(Duration.zero);

      // `reconnecting` is distinct from `disconnected` on purpose: a parent on a
      // train should see one and not the other.
      expect(seen, [
        RealtimeStatus.connected,
        RealtimeStatus.disconnected,
        RealtimeStatus.reconnecting,
        RealtimeStatus.connected,
      ]);
    });
  });
}

/// The ApiClient needs a TokenProvider; these tests never make a request.
class _NoTokens implements TokenProvider {
  @override
  Future<String?> accessToken() async => null;

  @override
  Future<String?> refresh() async => null;

  @override
  Future<void> onSessionEnded(AppError error) async {}
}
