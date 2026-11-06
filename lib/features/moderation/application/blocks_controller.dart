import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/errors/app_error.dart';
import '../../../shared/models/user_role.dart';
import '../../profile/domain/profile_view.dart';
import '../data/block_repository.dart';
import '../presentation/report_sheet.dart' show reportActorKind;

/// Whether Block may be OFFERED for [person] to the viewer (PD-57 §6.1, the closure plan §5).
///
/// Advisory only: the server decides, and refuses a protected target with
/// `COMM.BLOCK_NOT_ALLOWED`. The client hides what it can tell:
/// - a staff viewer (Sales, the Super Admin) never blocks anyone (A-2);
/// - nobody blocks themselves;
/// - a person without a server `actorKind` of `contact`, `teacher` or `staff` (a `system`
///   actor such as the official account, or one the server did not describe).
///
/// A department manager or the Super Admin arrives as plain `staff`; the client cannot tell
/// them from a supervisor, so Block is shown and the server's 403 is answered calmly.
bool mayBlockPerson({required ProfilePerson person, required String? viewerId, required UserRole? viewerRole}) {
  if (viewerRole == null || viewerRole == UserRole.sales) return false;
  if (person.id.isEmpty || viewerId == null || person.id == viewerId) return false;
  return blockSubjectKind(person) != null;
}

/// The `{kind}` of a block subject: the server's `actorKind`, exactly as for a report, never
/// the displayed role (which comes from `memberRole`). Null: nothing is offered.
String? blockSubjectKind(ProfilePerson person) => reportActorKind(person);

/// The signed-in user's own blocks (`GET /me/blocks`), and the one place a block or an
/// unblock is made, so every surface (profile, member row, placeholder, composer, Settings)
/// agrees the moment one of them changes it.
class BlocksController extends AsyncNotifier<List<PersonBlock>> with SessionScoped<List<PersonBlock>> {
  @override
  List<PersonBlock> get sessionEmptyValue => const [];

  @override
  Future<List<PersonBlock>> build() async {
    bindToSession();
    final repo = ref.watch(blockRepositoryProvider);
    if (!repo.isAvailable) return const [];
    return repo.mine();
  }

  List<PersonBlock> get _current => state.value ?? const [];

  /// Lets a first load finish before a change, so its answer cannot overwrite the change.
  Future<void> _settled() async {
    try {
      await future;
    } catch (_) {
      // A failed list is still changed by a block or an unblock; the change is kept.
    }
  }

  /// The block on [personId], when the viewer blocked them.
  PersonBlock? blockFor(String? personId) {
    if (personId == null || personId.isEmpty) return null;
    for (final b in _current) {
      if (b.subject.id == personId) return b;
    }
    return null;
  }

  /// `POST /me/blocks`. [name] fills in a name the server did not send. Throws the
  /// server's refusal unchanged.
  Future<PersonBlock> block(BlockSubject subject, {String name = ''}) async {
    await _settled();
    final made = await ref.read(blockRepositoryProvider).block(subject);
    final block = made.name.isNotEmpty || name.isEmpty
        ? made
        : PersonBlock(
            id: made.id,
            subject: made.subject,
            name: name,
            avatarUrl: made.avatarUrl,
            createdAt: made.createdAt,
          );
    if (!ref.mounted) return block;
    state = AsyncData([block, ..._current.where((b) => b.subject != subject && b.id != block.id)]);
    return block;
  }

  /// `DELETE /me/blocks/:id`. A 404 means the block is already gone (unblocked on another
  /// device), which is what the user asked for, so it counts as done.
  Future<void> unblock(String blockId) async {
    await _settled();
    try {
      await ref.read(blockRepositoryProvider).unblock(blockId);
    } on AppError catch (error) {
      if (error.kind != AppErrorKind.notFound) rethrow;
    }
    if (!ref.mounted) return;
    state = AsyncData(_current.where((b) => b.id != blockId).toList());
  }
}

final blocksProvider = AsyncNotifierProvider<BlocksController, List<PersonBlock>>(BlocksController.new);
