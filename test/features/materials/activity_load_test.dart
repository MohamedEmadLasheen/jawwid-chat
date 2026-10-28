import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/features/materials/presentation/activity_load_error.dart';
import 'package:jawwid_chat/features/materials/presentation/activity_load_failure.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:webview_flutter/webview_flutter.dart';

/// Systest 2026-10-28: an activity whose page failed (TLS, the network, a 404)
/// showed a blank white page -- no message, no way to try again.
void main() {
  const page = 'https://api.example.test/api/v1/materials/play/m-1/tok-secret/index.html?sig=abc';

  group('which failures are the page\'s, and what may be logged', () {
    test('a failed page load (simulated WebResourceError) is a failure, logged by kind, code and host only', () {
      const error = WebResourceError(
        errorCode: -1200,
        description: 'An SSL error has occurred for $page',
        errorType: WebResourceErrorType.failedSslHandshake,
        isForMainFrame: true,
        url: page,
      );
      final f = pageLoadFailure(error, pageUrl: page)!;
      expect(f.kind, 'failedSslHandshake');
      expect(f.logData, {'kind': 'failedSslHandshake', 'code': -1200, 'host': 'api.example.test'});
      // No path, no query, no token, no description quoting the URL.
      expect(f.logData.toString(), isNot(contains('tok-secret')));
      expect(f.logData.toString(), isNot(contains('sig=')));
      expect(f.logData.toString(), isNot(contains('SSL error')));
    });

    test('a platform that does not say which frame counts as the page; a sub-resource never does', () {
      expect(pageLoadFailure(const WebResourceError(errorCode: -2, description: 'x', errorType: WebResourceErrorType.hostLookup), pageUrl: page)?.host,
          'api.example.test');
      expect(
          pageLoadFailure(const WebResourceError(errorCode: -2, description: 'x', isForMainFrame: false, url: 'https://cdn.example.test/a.png'), pageUrl: page),
          isNull);
    });

    test('an HTTP error on the page (404) is a failure; one on another resource, or a 2xx, is not', () {
      HttpResponseError http(String url, int status) =>
          HttpResponseError(request: WebResourceRequest(uri: Uri.parse(url)), response: WebResourceResponse(uri: Uri.parse(url), statusCode: status));
      expect(pageHttpFailure(http(page, 404), pageUrl: page)!.logData, {'kind': 'http', 'code': 404, 'host': 'api.example.test'});
      expect(pageHttpFailure(http('https://api.example.test/api/v1/materials/play/m-1/tok-secret/logo.png', 404), pageUrl: page), isNull);
      expect(pageHttpFailure(http(page, 200), pageUrl: page), isNull);
      expect(pageHttpFailure(const HttpResponseError(), pageUrl: page), isNull);
    });
  });

  group('the error state', () {
    Widget app(Widget child, {Locale locale = const Locale('en')}) => MaterialApp(
          locale: locale,
          supportedLocales: JawwidApp.supportedLocales,
          localizationsDelegates: const [L10n.delegate, GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate, GlobalCupertinoLocalizations.delegate],
          home: Scaffold(body: child),
        );

    testWidgets('says the lesson could not load, and Try again reloads it', (tester) async {
      var retried = 0;
      await tester.pumpWidget(app(ActivityLoadError(onRetry: () => retried++)));
      expect(find.text("This lesson couldn't load."), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('activity-retry')));
      expect(retried, 1);
    });

    testWidgets('in Arabic too', (tester) async {
      await tester.pumpWidget(app(ActivityLoadError(onRetry: () {}), locale: const Locale('ar')));
      expect(find.text('تعذّر تحميل هذا الدرس.'), findsOneWidget);
    });
  });
}
