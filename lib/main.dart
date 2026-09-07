import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app/app.dart';
import 'app/bootstrap.dart';
import 'app/providers.dart';
import 'app/retry_policy.dart';

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

  // Restore anything queued by a previous run and start draining. Not awaited
  // either: a queued message sending is not something the first frame waits on,
  // and a slow disk must not delay the app appearing.
  unawaited(startOutbox(container));

  // Notifications: register this device, and route a tap to the conversation it
  // names. Not awaited -- a cold-start destination is held by the navigator
  // until authentication resolves, so nothing here gates the first frame.
  unawaited(startNotifications(container));

  runApp(
    UncontrolledProviderScope(
      container: container,
      child: const JawwidApp(),
    ),
  );
}
