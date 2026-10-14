import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/realtime/realtime_socket.dart';

/// Where the realtime socket actually connects.
///
/// socket.io reads a PATH on the connection URL as a namespace. The API base
/// URL always carries one — `/api/v1` is the server's global prefix — so
/// passing it through connected to a namespace nothing serves. The handshake
/// never reached the gateway, and a caller sat on "Calling…" while the other
/// side had already answered.
///
/// Every other test in this area doubles the socket, so nothing but a real
/// server could have caught it. These assert the rule directly instead.
void main() {
  group('the socket connects to the origin', () {
    test('drops the API path, which socket.io would read as a namespace', () {
      expect(
        SocketIoRealtimeSocket.originOf('http://127.0.0.1:3199/api/v1'),
        'http://127.0.0.1:3199',
      );
    });

    test('keeps a non-default port', () {
      expect(
        SocketIoRealtimeSocket.originOf('https://api.example.com:8443/api/v1'),
        'https://api.example.com:8443',
      );
    });

    test('omits the port when there is none to state', () {
      expect(
        SocketIoRealtimeSocket.originOf('https://api.example.com/api/v1'),
        'https://api.example.com',
      );
    });

    test('leaves an origin-only URL alone', () {
      expect(
        SocketIoRealtimeSocket.originOf('http://127.0.0.1:3199'),
        'http://127.0.0.1:3199',
      );
    });

    test('discards a query and a fragment as well as the path', () {
      expect(
        SocketIoRealtimeSocket.originOf('http://h:1/api/v1?x=1#y'),
        'http://h:1',
      );
    });

    test('returns something rather than throwing on a URL it cannot parse', () {
      // A misconfigured build must fail at the CONNECTION, with a socket error
      // that names the address, not inside a string helper.
      expect(SocketIoRealtimeSocket.originOf('not a url'), isNotEmpty);
    });
  });
}
