import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/features/notifications/notification_navigator.dart';
import 'package:jawwid_chat/features/notifications/push_payload.dart';

/// Notification taps: where they go, and — more importantly — where they do not.
///
/// The rule the whole file turns on: a payload names a conversation id and that
/// is a DESTINATION, never an ACCESS. It arrived over the network, so treating
/// it as authorization would mean anyone who could deliver a notification could
/// name any conversation. The route resolves the conversation from the backend,
/// which runs the same authorization every other read does; nothing is ever
/// rendered from what the notification said.
void main() {
  group('reading a payload', () {
    test('a message notification opens its conversation', () {
      final destination = PushPayload.destinationOf({
        'eventType': 'message_published',
        'conversationId': 'conv-1',
        'notificationId': 'n-1',
      });

      expect(destination, isA<OpenConversation>());
      expect((destination as OpenConversation).location, '/chats/conv-1');
    });

    test('a call notification is a CALL, not a message', () {
      final destination = PushPayload.destinationOf({
        'eventType': 'call_started',
        'conversationId': 'conv-1',
        'callId': 'call-9',
      });

      // Message and call notifications must stay distinguishable, or an
      // incoming call arrives as a chat thread and the call is missed.
      expect(destination, isA<OpenIncomingCall>());
      expect((destination as OpenIncomingCall).callId, 'call-9');
    });

    test('a MISSED call is history: it opens the thread, never a ringing screen', () {
      final destination = PushPayload.destinationOf({
        'eventType': 'call_missed',
        'conversationId': 'conv-1',
        'callId': 'call-9',
      });

      expect(destination, isA<OpenConversation>());
    });

    test('a payload with no destination opens the app rather than failing', () {
      // A payment reminder is a real notification with no in-app screen.
      // Tapping it must open the app, which is what the user asked for.
      expect(
        PushPayload.destinationOf({'eventType': 'payment_due'}),
        isA<OpenNowhere>(),
      );
      expect(PushPayload.destinationOf({}), isA<OpenNowhere>());
    });

    test('a malformed id is refused rather than turned into a URL', () {
      // An id from a payload becomes a path segment. A traversal or a query in
      // one must not reach the router.
      for (final bad in [
        '../../settings',
        'conv-1?x=1',
        'conv 1',
        '',
        'a' * 65,
      ]) {
        expect(
          PushPayload.destinationOf({
            'eventType': 'message_published',
            'conversationId': bad,
          }),
          isA<OpenNowhere>(),
          reason: 'must not route on "$bad"',
        );
      }
    });

    test('survives the platforms disagreeing about value types', () {
      // APNs preserves JSON types; FCM stringifies everything. A payload that
      // arrives with a number where a string was expected must not throw on the
      // path that reopens the app.
      final destination = PushPayload.destinationOf({
        'eventType': 'message_published',
        'conversationId': 12345,
      });
      expect(destination, isA<OpenConversation>());
      expect((destination as OpenConversation).conversationId, '12345');
    });

    test('a call with no call id does not become a call', () {
      expect(
        PushPayload.destinationOf({
          'eventType': 'call_started',
          'conversationId': 'conv-1',
        }),
        isA<OpenNowhere>(),
      );
    });
  });

  group('when the tap is acted on', () {
    late List<String> navigated;
    late bool signedIn;

    NotificationNavigator navigator() => NotificationNavigator(
          go: (location) async => navigated.add(location),
          isSignedIn: () => signedIn,
        );

    setUp(() {
      navigated = [];
      signedIn = true;
    });

    test('warm start navigates immediately', () async {
      final n = navigator();
      await n.onReady();
      await n.onTapped({'eventType': 'message_published', 'conversationId': 'c1'});

      expect(navigated, ['/chats/c1']);
    });

    test('COLD start holds the tap until the app has a router', () async {
      final n = navigator();

      // The tap STARTED the process. There is no navigator, no session and no
      // router: the platform hands the payload to main() before any of them
      // exist. Navigating now would call into nothing.
      await n.onTapped({'eventType': 'message_published', 'conversationId': 'c1'});
      expect(navigated, isEmpty);

      await n.onReady();
      expect(navigated, ['/chats/c1']);
    });

    test('holds exactly one: the last thing the user chose', () async {
      final n = navigator();
      await n.onTapped({'eventType': 'message_published', 'conversationId': 'c1'});
      await n.onTapped({'eventType': 'message_published', 'conversationId': 'c2'});
      await n.onReady();

      // Not a queue. Navigating through the earlier ones would flash screens
      // nobody asked for on the way to the one they tapped.
      expect(navigated, ['/chats/c2']);
    });

    test('a signed-out tap waits for the session rather than bouncing', () async {
      signedIn = false;
      final n = navigator();
      await n.onReady();
      await n.onTapped({'eventType': 'message_published', 'conversationId': 'c1'});

      expect(navigated, isEmpty, reason: 'nothing opens without a session');

      // They tap, they sign in, they arrive where they were going.
      signedIn = true;
      await n.onReady();
      expect(navigated, ['/chats/c1']);
    });

    test('a session ending discards a held destination', () async {
      final n = navigator();
      await n.onTapped({'eventType': 'message_published', 'conversationId': 'c1'});

      // A notification tapped by the previous user must not navigate the next
      // one into their thread.
      n.clear();
      await n.onReady();

      expect(navigated, isEmpty);
    });

    test('a payload with no destination navigates nowhere and does not throw', () async {
      final n = navigator();
      await n.onReady();
      await n.onTapped({'eventType': 'payment_due'});
      await n.onTapped(const {});

      expect(navigated, isEmpty);
    });
  });
}
