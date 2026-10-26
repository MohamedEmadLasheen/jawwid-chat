import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../data/profile_photo_repository.dart';

/// The signed-in person's photos (`GET /me/photo`), scoped to the session: a
/// different account reads its own, never the previous one's.
///
/// THE place the app reads "my own photo" from (the Settings row, the account
/// header): the session's user carries none. Its writers -- the teacher's and the
/// parent's profile screens -- invalidate it after every change.
///
/// (The "Profile photo / Children's photos" section that used to live here is gone:
/// each person now has ONE photo control, on their one profile screen.)
final myPhotosProvider = FutureProvider.autoDispose<MyPhotos>((ref) async {
  ref.watch(principalIdProvider);
  return ref.watch(profilePhotoRepositoryProvider).mine();
});
