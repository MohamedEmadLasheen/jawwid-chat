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

  // W8-W1. Reading it is what starts it: the registrar watches the signed-in
  // account and registers this device's push tokens for as long as that session
  // lasts, retiring them when it ends. A Riverpod provider is not built until
  // something reads it, and nothing else in the app has a reason to.
  //
  // It is read HERE rather than from a widget because push must not depend on
  // which screen happens to be mounted -- and because `app.dart` and
  // `router.dart` belong to a closed workstream. Signed out it yields null and
  // does nothing.
  container.read(pushRegistrarProvider);

  runApp(
    UncontrolledProviderScope(
      container: container,
      child: const JawwidApp(),
    ),
  );
}
