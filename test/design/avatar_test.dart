import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/design/widgets/jawwid_avatar.dart';
import 'package:jawwid_chat/shared/utils/signed_url.dart';

void main() {
  group('avatar initials', () {
    test('takes the first letter of the first two words', () {
      expect(avatarInitialsOf('Ahmed Hassan'), 'AH');
    });

    test('works for Arabic names', () {
      expect(avatarInitialsOf('أحمد حسن'), 'أح');
    });

    test('handles a single-word name', () {
      expect(avatarInitialsOf('جوّد'), isNotEmpty);
    });

    test('collapses extra whitespace', () {
      expect(avatarInitialsOf('  Ahmed   Hassan  '), 'AH');
    });

    test('falls back for an empty name rather than throwing', () {
      expect(avatarInitialsOf('   '), '؟');
    });

    test('ignores words beyond the first two', () {
      expect(avatarInitialsOf('عبد الرحمن بن عبد العزيز'), 'عا');
    });
  });

  /// Which credential an avatar sends, and why it depends on the URL.
  ///
  /// An S3 presigned URL carries SigV4 in its query string and S3 -- MinIO
  /// included -- rejects a request that ALSO carries an `Authorization` header
  /// ("request has multiple authentication types"). `Image.network` then calls
  /// its `errorBuilder` and the initials appear, which on screen is
  /// indistinguishable from "the photo never changed". The reference storage is
  /// the opposite: it signs the object but not the caller, and 401s without the
  /// session header. Both directions are asserted, because a fix for one alone
  /// is a regression for the other.
  group('avatar image authentication', () {
    const headers = {'Authorization': 'Bearer test-token'};

    /// The provider `Image.network` actually built. Reading it is the existing
    /// seam the story-viewer tests use; no mocking framework is involved, and
    /// the image never has to load for the headers to be inspectable.
    Future<NetworkImage> pumpAvatar(WidgetTester tester, String url) async {
      await tester.pumpWidget(
        MaterialApp(
          theme: JawwidTheme.light(isArabic: false),
          home: Scaffold(
            body: JawwidAvatar(
              displayName: 'Ahmed Hassan',
              imageUrl: url,
              imageHeaders: headers,
              size: 48,
            ),
          ),
        ),
      );
      // `cacheWidth`/`cacheHeight` make `Image.network` wrap the provider in a
      // `ResizeImage`, so unwrap one layer before reading the headers.
      final provider = tester.widget<Image>(find.byType(Image)).image;
      return (provider is ResizeImage ? provider.imageProvider : provider)
          as NetworkImage;
    }

    testWidgets('a PRESIGNED url is fetched with NO Authorization header',
        (tester) async {
      final image = await pumpAvatar(
        tester,
        'https://example.test/photo.jpg'
            '?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=test-signature',
      );

      expect(image.headers?.containsKey('Authorization') ?? false, isFalse,
          reason: 'SigV4 in the query string IS the authentication');
    });

    testWidgets('a LOCAL reference url keeps the Authorization header',
        (tester) async {
      final image = await pumpAvatar(
        tester,
        'https://storage.example/api/v1/storage/photo.jpg?expires=123&sig=abc',
      );

      expect(image.headers?['Authorization'], 'Bearer test-token');
    });

    testWidgets('a lookalike sig/expires url is NOT treated as presigned',
        (tester) async {
      // The reference storage's own shape. Mistaking it for SigV4 would strip
      // the header it depends on and 401 every image.
      final image = await pumpAvatar(tester, 'https://e.test/p.jpg?sig=abc&expires=123');

      expect(image.headers?['Authorization'], 'Bearer test-token');
    });

    testWidgets('a malformed url keeps the header rather than guessing',
        (tester) async {
      final image = await pumpAvatar(tester, ':://not a url?X-Amz-Signature=x');

      expect(image.headers?['Authorization'], 'Bearer test-token');
    });

    testWidgets('everything else about the image is unchanged', (tester) async {
      // The fix must not touch fit, the decode hints, or the initials fallback.
      await tester.pumpWidget(
        MaterialApp(
          theme: JawwidTheme.light(isArabic: false),
          home: const Scaffold(
            body: JawwidAvatar(
              displayName: 'Ahmed Hassan',
              imageUrl: 'https://e.test/p.jpg'
                  '?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=s',
              imageHeaders: headers,
              size: 48,
            ),
          ),
        ),
      );

      final image = tester.widget<Image>(find.byType(Image));
      expect(image.fit, BoxFit.cover);
      expect(image.errorBuilder, isNotNull);
      expect(image.loadingBuilder, isNotNull);

      // Image.network cannot load in a widget test, so the errorBuilder runs --
      // which is exactly the initials fallback the design calls for.
      await tester.pump();
      expect(find.text('AH'), findsOneWidget);
    });

    testWidgets('a null/empty url renders initials and builds no image',
        (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          theme: JawwidTheme.light(isArabic: false),
          home: const Scaffold(
            body: JawwidAvatar(displayName: 'Ahmed Hassan', size: 48),
          ),
        ),
      );

      expect(find.byType(Image), findsNothing);
      expect(find.text('AH'), findsOneWidget);
    });
  });

  /// The shared predicate itself, so the rule is pinned independently of any
  /// widget. One source of truth: the upload PUT reads the same function.
  group('urlAuthenticatesItself', () {
    test('requires BOTH the signature and the algorithm', () {
      expect(
        urlAuthenticatesItself(
            'https://e.test/o?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=s'),
        isTrue,
      );
      expect(urlAuthenticatesItself('https://e.test/o?X-Amz-Signature=s'), isFalse);
      expect(
        urlAuthenticatesItself('https://e.test/o?X-Amz-Algorithm=AWS4-HMAC-SHA256'),
        isFalse,
      );
    });

    test('is case-insensitive about the parameter names', () {
      expect(
        urlAuthenticatesItself('https://e.test/o?x-amz-algorithm=A&x-amz-signature=s'),
        isTrue,
      );
      expect(
        urlAuthenticatesItself('https://e.test/o?X-AMZ-ALGORITHM=A&X-AMZ-SIGNATURE=s'),
        isTrue,
      );
    });

    test('ignores the reference storage shape', () {
      expect(urlAuthenticatesItself('https://e.test/o?expires=1&sig=abc'), isFalse);
    });

    test('a url with no query at all is not presigned', () {
      expect(urlAuthenticatesItself('https://e.test/o'), isFalse);
    });

    test('a malformed url is not presigned, and does not throw', () {
      expect(urlAuthenticatesItself(':://not a url?X-Amz-Signature=x'), isFalse);
      expect(urlAuthenticatesItself(''), isFalse);
    });

    test('a malformed VALUE cannot throw, because values are never decoded', () {
      // A bad percent-escape would make `queryParameters` throw; only names are
      // read, and they are read raw.
      expect(
        urlAuthenticatesItself(
            'https://e.test/o?X-Amz-Algorithm=A&X-Amz-Signature=%zz'),
        isTrue,
      );
    });
  });
}
