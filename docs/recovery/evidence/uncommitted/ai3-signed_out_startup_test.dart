import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/bootstrap.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/features/auth/domain/auth_state.dart';
import 'package:jawwid_chat/features/auth/presentation/sign_in_screen.dart';

/// The startup state machine, end to end.
///
/// Regression for the pair of defects that stranded the app on its loading spinner:
/// nothing invoked restore(), so the state never left AuthUnknown; and the redirect treated
/// the splash as an acceptable resting place for a signed-out user, so even once the state
/// resolved the router stayed put.
void main() {
  testWidgets('a signed-out cold start ends on sign-in, never on the splash',
      (tester) async {
    final container = ProviderContainer(overrides: await bootstrap());
    addTearDown(container.dispose);

    await tester.pumpWidget(
      UncontrolledProviderScope(container: container, child: const JawwidApp()),
    );

    // Before the restore resolves, the state is undecided and the splash is correct:
    // showing the sign-in screen here would flash it on every launch.
    expect(container.read(authControllerProvider), isA<AuthUnknown>());
    expect(find.byType(SignInScreen), findsNothing);

    await container.read(authControllerProvider.notifier).restore();
    await tester.pumpAndSettle();

    expect(container.read(authControllerProvider), isA<AuthSignedOut>());
    expect(
      find.byType(SignInScreen),
      findsOneWidget,
      reason: 'a resolved signed-out state must leave the splash for sign-in',
    );
  });
}
