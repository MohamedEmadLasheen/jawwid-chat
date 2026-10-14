import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/network/api_client.dart' show TokenProvider;
import 'package:jawwid_chat/core/realtime/call_realtime_client.dart';
import 'package:jawwid_chat/core/realtime/chat_signal.dart';
import 'package:jawwid_chat/core/realtime/realtime_socket.dart';

/// The app's REAL realtime stack -- [SocketIoRealtimeSocket] under
/// [CallRealtimeClient] -- against a REAL API: a parent's client receives the
/// admin's message as a chat signal, through the server's authorization.
///
/// Skipped unless pointed at a running stack:
///
///   JAWWID_RT_ORIGIN         e.g. http://127.0.0.1:3386 (origin, no path)
///   JAWWID_RT_PARENT         a parent login
///   JAWWID_RT_ADMIN          that family's admin login
///   JAWWID_RT_OUTSIDER       a parent of ANOTHER family
///   JAWWID_RT_PASSWORD_FILE  a file holding the (shared, synthetic) password
void main() {
  final env = Platform.environment;
  final origin = env['JAWWID_RT_ORIGIN'];
  final configured = origin != null &&
      env['JAWWID_RT_PARENT'] != null &&
      env['JAWWID_RT_ADMIN'] != null &&
      env['JAWWID_RT_OUTSIDER'] != null &&
      env['JAWWID_RT_PASSWORD_FILE'] != null;

  Future<Map<String, dynamic>> call(String method, String path, {String? token, Object? body}) async {
    final client = HttpClient();
    try {
      final req = await client.openUrl(method, Uri.parse('$origin/api/v1$path'));
      req.headers.contentType = ContentType.json;
      if (token != null) req.headers.set('authorization', 'Bearer $token');
      if (body != null) req.write(jsonEncode(body));
      final res = await req.close();
      final text = await res.transform(utf8.decoder).join();
      return {'status': res.statusCode, ...((text.isEmpty ? <String, dynamic>{} : jsonDecode(text)) as Map<String, dynamic>)};
    } finally {
      client.close();
    }
  }

  Future<String> login(String username) async {
    final password = File(env['JAWWID_RT_PASSWORD_FILE']!).readAsStringSync();
    final r = await call('POST', '/auth/login', body: {'username': username, 'password': password});
    return r['accessToken'] as String;
  }

  test(
    'a parent client receives the admin\'s message live; an outsider\'s client cannot even subscribe',
    () async {
      final parent = await login(env['JAWWID_RT_PARENT']!);
      final admin = await login(env['JAWWID_RT_ADMIN']!);
      final outsider = await login(env['JAWWID_RT_OUTSIDER']!);
      final adminId = (await call('GET', '/me', token: admin))['actorId'] as String;
      final direct = await call('POST', '/conversations/direct', token: parent, body: {'withActorId': adminId});
      final conversationId = direct['id'] as String;

      final client = CallRealtimeClient(
        socket: SocketIoRealtimeSocket(baseUrl: '$origin/api/v1'), // as the app passes it
        tokens: _Fixed(parent),
      );
      addTearDown(client.dispose);
      final signals = <ChatSignal>[];
      final sub = client.chatSignals.listen(signals.add);
      addTearDown(sub.cancel);

      await _connected(client);
      final ack = await client.subscribe(conversationId);
      expect(ack.ok, isTrue, reason: 'server refused: ${ack.code}');

      final sent = await call('POST', '/conversations/$conversationId/messages', token: admin, body: {
        'type': 'text',
        'body': 'live from the admin (flutter realtime test)',
        'clientMessageId': 'flutter-live-${DateTime.now().microsecondsSinceEpoch}',
      });
      expect(sent['status'], 201);

      final deadline = DateTime.now().add(const Duration(seconds: 5));
      while (DateTime.now().isBefore(deadline) &&
          !signals.any((s) => s.kind == ChatSignalKind.messageCreated && s.conversationId == conversationId)) {
        await Future<void>.delayed(const Duration(milliseconds: 50));
      }
      final created = signals.where((s) => s.kind == ChatSignalKind.messageCreated && s.conversationId == conversationId);
      expect(created, isNotEmpty, reason: 'no message.created reached the parent client');
      expect(created.first.seq, int.parse(sent['seq'] as String));

      // The outsider's client: the SAME stack, refused by the server.
      final other = CallRealtimeClient(
        socket: SocketIoRealtimeSocket(baseUrl: '$origin/api/v1'),
        tokens: _Fixed(outsider),
      );
      addTearDown(other.dispose);
      await _connected(other);
      final refused = await other.subscribe(conversationId);
      expect(refused.ok, isFalse);
      expect(refused.code, 'COMM.NOT_CONVERSATION_MEMBER');
    },
    skip: configured ? false : 'set JAWWID_RT_* to run against a live stack',
    timeout: const Timeout(Duration(seconds: 60)),
  );
}

/// Connect and wait for the transport. The `connected` state can be emitted
/// before a listener attaches, so the current state is checked as well.
Future<void> _connected(CallRealtimeClient client) async {
  final reached = client.states.firstWhere((s) => s == CallRealtimeState.connected);
  await client.connect();
  if (client.state == CallRealtimeState.connected) return;
  await reached.timeout(const Duration(seconds: 10), onTimeout: () => throw StateError('not connected: ${client.state}'));
}

class _Fixed implements TokenProvider {
  _Fixed(this.token);
  final String token;
  @override
  Future<String?> accessToken() async => token;
  @override
  Future<String?> refresh() async => token;
  @override
  Future<void> onSessionEnded(AppError error) async {}
}
