import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app/app.dart';
import 'app/bootstrap.dart';
import 'app/providers.dart';
import 'app/retry_policy.dart';
import 'core/push/push_registrar.dart';
import 'core/realtime/realtime_connection.dart';

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

  // The realtime transport follows the session from here: it connects when one
  // exists, disconnects when it ends, and refetches the notification list and
  // unread count whenever a connection is re-established, because anything that
  // happened while the socket was down was never delivered to this device.
  // Started before runApp so no session change is missed between the two.
  container.read(realtimeConnectionProvider).start();

  // Push follows the session too: it registers this device's token on sign-in,
  // follows every rotation, unregisters on sign-out, and -- the case the whole
  // feature is judged on -- reads the notification that STARTED this process
  // when the app was launched by a tap on a closed app. Not awaited: a slow
  // permission prompt or an unreachable FCM must not hold the first frame.
  unawaited(container.read(pushRegistrarProvider).start());

  runApp(
    UncontrolledProviderScope(
      container: container,
      child: const JawwidApp(),
    ),
  );
}
