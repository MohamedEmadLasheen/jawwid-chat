import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/design/widgets/jawwid_avatar.dart';
import 'package:jawwid_chat/shared/utils/signed_url.dart';

/// Whether the session header rides along with an avatar image request.
///
/// ## Why this needs a test of its own
///
/// Two storage backends sit behind one widget and want OPPOSITE things. An S3 presigned
/// URL carries SigV4 in its query string and S3 -- MinIO included -- refuses a request that
/// also sends `Authorization`: "request has multiple authentication types". A stable
/// application URL is the reverse and is authenticated by the header alone.
///
/// Both failures are quiet. `Image.network` does not surface an HTTP error to the user; it
/// runs `errorBuilder`, which draws initials -- and initials are exactly what a person with
/// no photo looks like. So the wrong choice here does not crash, it just silently shows the
/// wrong thing forever, which is why the rule is asserted rather than trusted.
///
/// The predicate itself is tested first, because the widget's behaviour is only as good as
/// the question it asks.
void main() {
  group('the predicate', () {
    test('a SigV4 presigned URL authenticates itself', () {
      expect(
        urlAuthenticatesItself(
          'https://bucket.s3.test/avatars/contacts/c1/abc'
          '?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=deadbeef&X-Amz-Expires=300',
        ),
        isTrue,
      );
    });

    test("the local reference storage's own signature is NOT SigV4", () {
      // The reference storage signs with an unrelated `expires`/`sig` pair. A looser test
      // would read those as SigV4 and strip a header that URL may still need.
      expect(
        urlAuthenticatesItself(
          'http://192.0.2.10:3277/api/v1/storage/avatars%2Fcontacts%2Fc1%2Fabc'
          '?expires=1791470109&sig=0123456789abcdef',
        ),
        isFalse,
      );
    });

    test('an algorithm without a signature is not enough', () {
      expect(
        urlAuthenticatesItself('https://s3.test/x?X-Amz-Algorithm=AWS4-HMAC-SHA256'),
        isFalse,
      );
    });

    test('a URL with no query at all authenticates nothing', () {
      expect(urlAuthenticatesItself('https://api.test/api/v1/me/avatar/image'), isFalse);
    });
  });

  group('the widget', () {
    Widget host(Widget child) => MaterialApp(
          theme: JawwidTheme.light(isArabic: false),
          home: Scaffold(body: child),
        );

    /// The avatar decodes at display size, so the provider it builds is a [ResizeImage]
    /// wrapping the network one. Unwrap rather than assert on the wrapper, which would
    /// make this test fail the day someone changes the cache sizing.
    NetworkImage networkImageIn(WidgetTester tester) {
      final provider = tester.widget<Image>(find.byType(Image)).image;
      return (provider is ResizeImage ? provider.imageProvider : provider) as NetworkImage;
    }

    testWidgets('withholds the header from a self-authenticating URL', (tester) async {
      await tester.pumpWidget(host(const JawwidAvatar(
        displayName: 'Huda Qasim',
        imageUrl: 'https://bucket.s3.test/a?X-Amz-Algorithm=AWS4-HMAC-SHA256'
            '&X-Amz-Signature=deadbeef',
        imageHeaders: {'Authorization': 'Bearer token-value'},
      )));

      expect(
        networkImageIn(tester).headers,
        isNull,
        reason: 'S3 rejects a presigned request that also carries Authorization',
      );
    });

    testWidgets('sends the header to a URL that does not authenticate itself',
        (tester) async {
      await tester.pumpWidget(host(const JawwidAvatar(
        displayName: 'Huda Qasim',
        imageUrl: 'https://api.test/api/v1/me/avatar/image',
        imageHeaders: {'Authorization': 'Bearer token-value'},
      )));

      expect(
        networkImageIn(tester).headers,
        containsPair('Authorization', 'Bearer token-value'),
      );
    });

    testWidgets('a call site that passes no headers still renders', (tester) async {
      // Every call site in the app today is this one. The parameter is optional precisely
      // so adding it broke none of them.
      await tester.pumpWidget(host(const JawwidAvatar(
        displayName: 'Huda Qasim',
        imageUrl: 'https://api.test/photo.jpg',
      )));

      expect(networkImageIn(tester).headers, isNull);
      expect(tester.takeException(), isNull);
    });

    testWidgets('no URL means initials, and no image request at all', (tester) async {
      await tester.pumpWidget(host(const JawwidAvatar(displayName: 'Huda Qasim')));

      expect(find.byType(Image), findsNothing);
      expect(find.text('HQ'), findsOneWidget);
    });
  });
}
