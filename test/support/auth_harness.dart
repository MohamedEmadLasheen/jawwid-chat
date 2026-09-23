import 'package:jawwid_chat/core/data/fake_backend.dart';
import 'package:jawwid_chat/core/data/fake_repositories.dart';
import 'package:jawwid_chat/core/storage/secure_token_store.dart';
import 'package:jawwid_chat/features/auth/application/auth_controller.dart';
import 'package:jawwid_chat/features/auth/domain/auth_state.dart';
import 'package:jawwid_chat/shared/models/auth.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

/// A hand-driven [AuthController], for tests that need to move a session
/// through sign-in and sign-out without the real one's storage and network.
///
/// Built on the repository's own fakes rather than new stubs: the thing under
/// test in these suites is what the notification layer does when the session
/// changes, and inventing a second set of auth doubles would be a second thing
/// to keep true.
class TestAuthController extends AuthController {
  TestAuthController({this.initial = const AuthSignedOut()})
      : super(
          repository: FakeAuthRepository(
            backend: FakeBackend(role: UserRole.parent),
            tokens: InMemoryTokenStore(),
          ),
          tokens: InMemoryTokenStore(),
          clearLocalData: _noop,
        );

  static Future<void> _noop() async {}

  final AuthState initial;

  @override
  AuthState build() => initial;

  void set(AuthState next) => state = next;
}

/// A signed-in parent.
const signedInParent = AuthAuthenticated(
  AuthUser(id: 'u_parent', displayName: 'Umm Ahmed', role: UserRole.parent),
);
