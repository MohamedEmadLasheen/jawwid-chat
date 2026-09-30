import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';

import '../../../app/providers.dart';
import '../../../core/data/repositories.dart';

/// May this conversation be called, right now, according to the server?
///
/// ADVISORY, NEVER A GRANT. `GET /conversations/:id/call-capability` answers what
/// the policy says at this instant, and the instant passes: a teacher–parent
/// relationship can be revoked between this answer and the `POST /calls` that
/// follows it. `CallService.start` decides again from scratch and remains the
/// only thing that authorizes a call. The interface uses this for ONE purpose —
/// whether to draw the affordance — and for nothing else.
///
/// NOT CACHED, AND THAT IS THE POINT. `autoDispose` is load-bearing: since PD-6
/// the set of authorized pairs is DATA, so a remembered `true` is a remembered
/// permission. When the conversation screen goes away the answer goes with it,
/// and reopening asks again. A conversation existing is not evidence either — it
/// proves the relationship held when the conversation was CREATED, not that it
/// holds now, and revocation leaves the conversation and denies the call.
///
/// FAIL CLOSED. Anything other than an explicit `canCall: true` means no
/// affordance: a refusal, a network error, a malformed answer, or a build with no
/// call repository registered at all. `screens/call.md` §4 requires the control
/// to be ABSENT rather than disabled where the backend does not authorize the
/// pairing, so there is no state in which this renders a call button the server
/// would refuse.
final callCapabilityProvider =
    FutureProvider.autoDispose.family<CallCapability, String>((ref, conversationId) async {
  final CallRepository calls;
  try {
    calls = ref.watch(callRepositoryProvider);
  } catch (error) {
    // A container with no repository registered is not an error to shout about —
    // `CallsController` makes the same distinction. There is simply no call
    // capability in such a build.
    final cause = error is ProviderException ? error.exception : error;
    if (cause is UnimplementedError) {
      return const CallCapability(canCall: false);
    }
    rethrow;
  }

  return calls.capability(conversationId: conversationId);
});

/// Whether to draw the call affordance. The one question the interface asks.
///
/// Collapses loading, error and refusal into the same answer — `false` — because
/// the affordance has exactly two renderings and "absent" is the safe one.
/// Loading is deliberately not a spinner in the header: a button that appears a
/// moment later is honest, whereas a placeholder implies a call is available
/// before the server has said so.
final canCallProvider = Provider.autoDispose.family<bool, String>((ref, conversationId) {
  return ref.watch(callCapabilityProvider(conversationId)).maybeWhen(
        data: (capability) => capability.canCall,
        orElse: () => false,
      );
});
