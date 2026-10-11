import 'dart:async';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// Does a 302 from our own endpoint carry the Bearer header to the STORAGE origin?
///
/// M1 answers `GET /api/v1/me/avatar/image` with a redirect to a presigned URL on the
/// object store. The client sends a bearer to our endpoint, because that URL is stable and
/// does not authenticate itself. If the HTTP stack then replays that header at the
/// redirect target, two bad things happen at once: the token is disclosed to the storage
/// origin, and the store sees SigV4 in the query string AND an Authorization header, which
/// S3 and MinIO refuse as "multiple authentication types" — so the photo would silently
/// fall back to initials.
///
/// This exercises the REAL `HttpClient` Flutter's image stack uses, against two real
/// sockets, because the answer is a property of that client and not of our code.
void main() {
  test('the Authorization header is NOT replayed at a cross-origin redirect', () async {
    final storageHits = <HttpHeaders>[];

    // Stands in for the object store.
    final storage = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    final storageDone = Completer<void>();
    storage.listen((req) async {
      storageHits.add(req.headers);
      req.response.statusCode = 200;
      req.response.headers.contentType = ContentType('image', 'jpeg');
      req.response.add(const [0xFF, 0xD8, 0xFF, 0xD9]);
      await req.response.close();
      if (!storageDone.isCompleted) storageDone.complete();
    });

    // Stands in for our own /me/avatar/image, which 302s to the store.
    final api = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    api.listen((req) async {
      req.response.statusCode = HttpStatus.found;
      req.response.headers.set(
        HttpHeaders.locationHeader,
        'http://127.0.0.1:${storage.port}/avatars/x.jpg'
            '?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=deadbeef',
      );
      await req.response.close();
    });

    addTearDown(() async {
      await storage.close(force: true);
      await api.close(force: true);
    });

    final client = HttpClient();
    final request = await client.getUrl(
      Uri.parse('http://127.0.0.1:${api.port}/api/v1/me/avatar/image'),
    );
    request.headers.set(HttpHeaders.authorizationHeader, 'Bearer session-token');
    final response = await request.close();
    await response.drain<void>();
    await storageDone.future;
    client.close(force: true);

    expect(storageHits, hasLength(1), reason: 'the redirect was followed');
    final forwarded = storageHits.single.value(HttpHeaders.authorizationHeader);

    expect(
      forwarded,
      isNull,
      reason: 'a bearer minted for OUR origin must not reach the storage origin; '
          'S3 refuses SigV4 + Authorization together, and the token would be disclosed',
    );
  });
}
