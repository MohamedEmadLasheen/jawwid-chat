import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app/app.dart';
import 'app/bootstrap.dart';
import 'app/providers.dart';
import 'app/retry_policy.dart';
import 'core/push/push_registration.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  final overrides = await bootstrap();

  // Own the container so the stored session can be read before the first frame's
  // navigation decision. Without this the app stays in AuthUnknown forever and the router
  // holds it on the splash screen: `restore()` existed but nothing ever called it.
  final container = ProviderContainer(
    overrides: overrides,
    // Retry transient failures only; a policy refusal is never re-attempted (§3).
    retry: JawwidRetryPolicy.policy,
  );

  // Not awaited: the router renders the splash while this resolves, which is the state it
  // was designed for.
  unawaited(container.read(authControllerProvider.notifier).restore());

  // W8-W1. Push registration follows the signed-in account for as long as the app runs:
  // a session that arrives registers this device's tokens, one that ends retires them.
  // Started HERE rather than from a widget because push must not depend on which screen
  // happens to be mounted -- and because `app.dart` and `router.dart` belong to a closed
  // workstream. It must be listened, not read: see `startPushRegistration`.
  startPushRegistration(container);

  runApp(
    UncontrolledProviderScope(
      container: container,
      child: const JawwidApp(),
    ),
  );
}
