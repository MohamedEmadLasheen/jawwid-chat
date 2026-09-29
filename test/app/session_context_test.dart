import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/bootstrap.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

/// The principal, as the transport layer sees it.
///
/// This existed before authentication did, and nothing ever called [SessionContext.adopt]:
/// `actorId()` returned the empty string and `role()` silently fell back to parent. The
/// consequences were quiet and wrong — message ownership is decided by actor id, and
/// approval policy by role, so a signed-in teacher saw their own messages as somebody
/// else's. These tests pin both halves of the lifecycle.
void main() {
  test('before a session, the actor id is empty rather than invented', () {
    final session = SessionContext();

    expect(session.actorId(), isEmpty);
    // Parent is the stricter approval policy of the two, so the fallback cannot
    // under-restrict anything in the window before a session exists.
    expect(session.role(), UserRole.parent);
  });

  test('adopting a principal makes both available to the transport', () {
    final session = SessionContext()
      ..adopt(role: UserRole.teacher, actorId: 'teacher-7');

    expect(session.role(), UserRole.teacher);
    expect(session.actorId(), 'teacher-7');
  });

  test('clearing forgets the principal, so none outlives its session', () async {
    final session = SessionContext()
      ..adopt(role: UserRole.teacher, actorId: 'teacher-7');

    await session.clear();

    expect(session.actorId(), isEmpty);
    expect(session.role(), UserRole.parent);
  });

  test('a session the backend ends clears it just as completely', () async {
    final session = SessionContext()
      ..adopt(role: UserRole.teacher, actorId: 'teacher-7');

    await session.end(const AppError(AppErrorKind.sessionRevoked));

    expect(session.actorId(), isEmpty);
    expect(session.role(), UserRole.parent);
  });
}
