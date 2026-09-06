import '../../../shared/models/auth.dart';
import '../../errors/app_error.dart';
import '../repositories.dart';

/// There is no authentication contract to implement.
///
/// This class exists so that the gap is **loud and specific** rather than papered over. It is
/// not a stub to be filled in later with guesses: inventing `/auth/login` would create a
/// second, fictional source of truth for the single most security-sensitive flow in the
/// product.
///
/// ## What the backend actually has today
///
/// `apps/api/src/communication/api/actor.decorator.ts` reads a plaintext `x-actor-id`
/// request header, and documents itself as a placeholder:
///
/// > *"AI #1 SEAM: the authenticated actor id. Today it is read from a header so the engine
/// > is runnable and testable before auth lands."*
///
/// There is no login route, no token issuance, no refresh, no `/me`, no guard, and no device
/// or session registry anywhere in `apps/api/src`.
///
/// ## What AI #1 must publish before this class can be replaced
///
/// Mobile needs five things, and will conform to whatever shapes AI #1 chooses:
///
/// 1. **Login** — username + password in, access token + refresh token + expiries out, with
///    *distinguishable* failures for bad credentials, disabled account, and locked account.
///    The app reacts differently to each (§7); one generic 401 collapses that.
/// 2. **Refresh** — exchange a refresh token for a new access token.
/// 3. **Current principal** (`/me`) — stable actor id, display name, avatar, and
///    **server-asserted role** (`parent` | `teacher`). The app must never infer a role.
/// 4. **Logout** — invalidate the session server-side.
/// 5. **Device/session registry** — register a device and its push token, list a user's
///    sessions, revoke one, and make revocation observable to the client.
///
/// Until then every method here throws a terminal [AppError], so the UI shows a safe message
/// and the retry policy does not loop on it.
class UnavailableAuthRepository implements AuthRepository {
  const UnavailableAuthRepository();

  static const _code = 'auth_contract_not_published';

  static const AppError _failure = AppError(
    AppErrorKind.server,
    code: _code,
    debugDetail:
        'No authentication endpoints exist in apps/api. See '
        'docs/mobile/http-integration.md for the five routes AI #1 must publish.',
  );

  @override
  Future<AuthSession> signIn({
    required String username,
    required String password,
  }) async =>
      throw _failure;

  @override
  Future<AuthUser> currentUser() async => throw _failure;

  @override
  Future<AuthSession> refresh(String refreshToken) async => throw _failure;

  @override
  Future<void> signOut() async {
    // Sign-out is the one operation that must not fail: there is no server session to end,
    // and the local session is cleared by AuthController regardless. Throwing here would
    // strand a user signed in on their own device.
  }

  @override
  Future<List<DeviceSession>> devices() async => throw _failure;

  @override
  Future<void> revokeDevice(String deviceId) async => throw _failure;

  /// No server-push channel exists for revocation yet, so this never emits. It is an empty
  /// stream rather than an error because the absence of a revocation signal is not itself a
  /// failure — it simply means revocation cannot be detected until the contract lands.
  @override
  Stream<void> get sessionRevoked => const Stream<void>.empty();
}
