import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app/app.dart';
import 'app/bootstrap.dart';
import 'app/retry_policy.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  final overrides = await bootstrap();

  runApp(
    ProviderScope(
      overrides: overrides,
      // Retry transient failures only; a policy refusal is never re-attempted (§3).
      retry: JawwidRetryPolicy.policy,
      child: const JawwidApp(),
    ),
  );
}
