import 'dart:async';
import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:sentry_flutter/sentry_flutter.dart';

/// PD-56 (store compliance, S-07): crash reporting with Sentry.
///
/// Off unless BOTH hold: a release build, and a DSN compiled in with
/// `--dart-define=SENTRY_DSN=...` (`SENTRY_ENVIRONMENT` names the environment,
/// `production` by default). A debug or profile build, or a build with no DSN, starts the
/// app exactly as before and sends nothing.
///
/// No personal data leaves the phone:
///   * the person is the SHA-256 of their actor id, nothing else ([actorHash]);
///   * e-mail addresses, phone numbers and quoted text (where a message, a name or a typed
///     value would appear) are replaced in every message and exception ([scrubText]);
///   * the request, `extra`, the device's name and every breadcrumb but navigation go
///     ([scrubEvent], [keepNavigationOnly]);
///   * no screenshot, no view hierarchy, no tracing, no user-interaction or native
///     breadcrumbs, and `sendDefaultPii` stays off.
const _dsn = String.fromEnvironment('SENTRY_DSN');
const _environment = String.fromEnvironment('SENTRY_ENVIRONMENT', defaultValue: 'production');

/// Whether this build reports crashes at all.
bool get crashReportingEnabled => kReleaseMode && _dsn.trim().isNotEmpty;

/// Runs the app, inside Sentry when [crashReportingEnabled].
Future<void> runWithCrashReporting(FutureOr<void> Function() appRunner) async {
  if (!crashReportingEnabled) {
    await appRunner();
    return;
  }
  await SentryFlutter.init(
    (options) {
      options
        ..dsn = _dsn.trim()
        ..environment = _environment
        ..sendDefaultPii = false
        ..attachScreenshot = false
        ..attachViewHierarchy = false
        ..tracesSampleRate = null
        ..enableAutoPerformanceTracing = false
        ..enableUserInteractionBreadcrumbs = false
        ..enableAutoNativeBreadcrumbs = false
        ..maxBreadcrumbs = 30
        ..beforeBreadcrumb = keepNavigationOnly
        ..beforeSend = (event, hint) => scrubEvent(event);
    },
    appRunner: appRunner,
  );
}

/// The navigation breadcrumbs, when crash reporting is on; nothing otherwise.
List<NavigatorObserver> crashReportingObservers() =>
    crashReportingEnabled ? [SentryNavigatorObserver(enableAutoTransactions: false)] : const [];

/// The person a report is about: a hash of the actor id, or nobody when signed out.
void setCrashReportingActor(String? actorId) {
  if (!crashReportingEnabled) return;
  final done = Sentry.configureScope((scope) async {
    await scope.setUser(actorId == null ? null : SentryUser(id: actorHash(actorId)));
  });
  if (done is Future<void>) unawaited(done);
}

/// The SHA-256 of an actor id: lets one person's crashes be grouped, never names them.
String actorHash(String actorId) => sha256.convert(utf8.encode('jawwid-actor:$actorId')).toString();

final _email = RegExp(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}');
final _phone = RegExp(r'\+?\d[\d\s().-]{6,}\d');
// Straight quotes, and the curly and Arabic pairs, which open and close differently.
final _quoted = RegExp('"[^"\\n]{2,}?"|\'[^\'\\n]{2,}?\'|“[^”\\n]{2,}?”|«[^»\\n]{2,}?»');

/// E-mails, phone numbers and quoted text replaced.
String scrubText(String text) => text
    .replaceAll(_email, '[email]')
    .replaceAll(_phone, '[phone]')
    .replaceAllMapped(_quoted, (m) => '${m[0]![0]}[text]${m[0]![m[0]!.length - 1]}');

/// Only navigation breadcrumbs, with only where from and where to.
Breadcrumb? keepNavigationOnly(Breadcrumb? crumb, Hint hint) {
  if (crumb == null || crumb.category != 'navigation') return null;
  final data = crumb.data;
  crumb.data = data == null
      ? null
      : {
          for (final key in const ['from', 'to', 'state'])
            if (data[key] is String) key: scrubText(data[key] as String),
        };
  final message = crumb.message;
  if (message != null) crumb.message = scrubText(message);
  return crumb;
}

/// What a report keeps: the stack, the scrubbed messages, the hashed person, navigation.
SentryEvent scrubEvent(SentryEvent event) {
  final userId = event.user?.id;
  event.user = userId == null ? null : SentryUser(id: userId);
  event.request = null;
  // Deprecated, but the SDK and plugins may still fill it: it never leaves the phone.
  // ignore: deprecated_member_use
  event.extra = null;
  event.contexts.device?.name = null;
  final message = event.message;
  if (message != null) {
    message
      ..formatted = scrubText(message.formatted)
      ..template = message.template == null ? null : scrubText(message.template!)
      ..params = null;
  }
  for (final exception in event.exceptions ?? const <SentryException>[]) {
    final value = exception.value;
    if (value != null) exception.value = scrubText(value);
  }
  event.breadcrumbs = event.breadcrumbs?.map((c) => keepNavigationOnly(c, Hint())).whereType<Breadcrumb>().toList();
  return event;
}
