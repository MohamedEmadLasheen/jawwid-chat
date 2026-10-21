import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../shared/models/student_profile.dart';

/// PD-17: one child's Student Profile, from `GET /learners/:id/profile`.
///
/// The server is the only judge of who may read it -- the child's own teacher -- and
/// answers anyone else with a 404, which reaches the screen intact. Bound to the
/// principal so a profile fetched for one account is never served to the next.
final studentProfileProvider = FutureProvider.autoDispose.family<StudentProfile, String>((ref, learnerId) {
  ref.watch(principalIdProvider);
  return ref.watch(lessonRepositoryProvider).studentProfile(learnerId);
});
