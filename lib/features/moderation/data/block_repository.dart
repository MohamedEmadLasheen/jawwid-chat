/// PD-57 (WP-2B): blocking a person, the blocker's own list, and unblocking.
///
/// Contract of record: `docs/release/pd57-closure-plan-2026-11-06.md` §5 (it wins over the
/// roadmap's §6.2). NO AUTHORIZATION LIVES HERE: whether a person may be blocked (staff
/// callers, protected targets, yourself, no shared conversation) is the server's answer, and
/// its `COMM.*` code reaches the caller intact.
abstract interface class BlockRepository {
  /// False in a build with no block server: no Block entry, placeholder action or Settings
  /// row is offered.
  bool get isAvailable;

  /// `POST /me/blocks`. `201` is a new block; `200` is the block that already existed. Both
  /// answer the same shape, so both return the block.
  Future<PersonBlock> block(BlockSubject subject);

  /// `GET /me/blocks` -- the signed-in user's own blocks, newest first.
  Future<List<PersonBlock>> mine();

  /// `DELETE /me/blocks/:id`.
  Future<void> unblock(String blockId);
}

/// A person as the server names actors: `{kind, id}` with kind `contact`, `teacher` or
/// `staff`.
class BlockSubject {
  const BlockSubject({required this.kind, required this.id});

  final String kind;
  final String id;

  Map<String, Object?> toJson() => {'kind': kind, 'id': id};

  @override
  bool operator ==(Object other) => other is BlockSubject && other.kind == kind && other.id == id;

  @override
  int get hashCode => Object.hash(kind, id);
}

/// One row of `GET /me/blocks` (or the answer to `POST /me/blocks`).
class PersonBlock {
  const PersonBlock({required this.id, required this.subject, this.createdAt, this.name = '', this.avatarUrl});

  final String id;
  final BlockSubject subject;

  /// May be empty: the UI then says "this person", never an id.
  final String name;
  final String? avatarUrl;

  /// Null when the server sent no usable time; the row is still shown, so it can be undone.
  final DateTime? createdAt;
}

/// The refusals of §5 that the block flows answer in their own words.
abstract final class BlockErrors {
  /// 403: a staff caller, a protected target (the official account, a manager, the Super
  /// Admin), or yourself.
  static const notAllowed = 'COMM.BLOCK_NOT_ALLOWED';

  /// 404: the blocker shares no conversation with the person.
  static const noSharedConversation = 'COMM.BLOCK_NO_SHARED_CONVERSATION';

  /// 429, past `block.limit.per_blocker_day`.
  static const rateLimited = 'COMMON.RATE_LIMITED';

  /// 403, after WP-3.
  static const termsNotAccepted = 'COMM.TERMS_NOT_ACCEPTED';
}

/// The build with no block server: nothing is offered and nothing is sent.
class NoBlockRepository implements BlockRepository {
  const NoBlockRepository();

  @override
  bool get isAvailable => false;

  @override
  Future<PersonBlock> block(BlockSubject subject) => throw UnsupportedError('no block server in this build');

  @override
  Future<List<PersonBlock>> mine() async => const [];

  @override
  Future<void> unblock(String blockId) => throw UnsupportedError('no block server in this build');
}
