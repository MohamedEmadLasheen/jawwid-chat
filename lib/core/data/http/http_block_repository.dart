import '../../../features/moderation/data/block_repository.dart';
import '../../errors/app_error.dart';
import '../../network/api_client.dart';
import '../wire/wire_mappers.dart';

/// `BlockRepository` over `POST /me/blocks`, `GET /me/blocks` and `DELETE /me/blocks/:id`
/// (PD-57, closure plan §5).
///
/// Parsed by hand, reading only what the blocker's screens show. A row without an id or a
/// subject `{kind, id}` is dropped rather than shown with an invented value; a missing name
/// stays empty (the UI says "this person", never an id). A refusal reaches the caller with
/// its code intact (via [ApiClient]).
class HttpBlockRepository implements BlockRepository {
  HttpBlockRepository({required ApiClient client}) : _client = client;

  final ApiClient _client;

  @override
  bool get isAvailable => true;

  @override
  Future<PersonBlock> block(BlockSubject subject) async {
    final response = await _client.post<Map<String, Object?>>('/me/blocks', data: {'subject': subject.toJson()});
    // 201 is a new block, 200 the existing one: the same shape, the same answer here.
    final block = _parse(response.data);
    if (block == null) {
      throw const AppError(AppErrorKind.unknown, debugDetail: 'blocks: malformed response');
    }
    return block;
  }

  @override
  Future<List<PersonBlock>> mine() async {
    final data = (await _client.get<List<Object?>>('/me/blocks')).data ?? const [];
    final blocks = [
      for (final row in data)
        ?_parse(row),
    ];
    // Newest first; a row without a time sorts last.
    blocks.sort((a, b) {
      final at = a.createdAt, bt = b.createdAt;
      if (at == null || bt == null) return at == null ? (bt == null ? 0 : 1) : -1;
      return bt.compareTo(at);
    });
    return blocks;
  }

  @override
  Future<void> unblock(String blockId) async {
    await _client.delete<Object?>('/me/blocks/${Uri.encodeComponent(blockId)}');
  }

  static PersonBlock? _parse(Object? row) {
    if (row is! Map) return null;
    final id = row['id'];
    final subject = row['subject'];
    if (id is! String || id.isEmpty || subject is! Map) return null;
    final kind = subject['kind'];
    final subjectId = subject['id'];
    if (kind is! String || subjectId is! String || subjectId.isEmpty) return null;
    final name = subject['name'];
    final avatar = subject['avatar'];
    return PersonBlock(
      id: id,
      subject: BlockSubject(kind: kind, id: subjectId),
      name: name is String ? name.trim() : '',
      avatarUrl: avatar is String && avatar.isNotEmpty ? avatar : null,
      createdAt: WireMappers.parseTime(row['createdAt']),
    );
  }
}
