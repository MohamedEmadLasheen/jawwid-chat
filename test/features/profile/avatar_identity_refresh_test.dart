import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/data/fake_backend.dart';
import 'package:jawwid_chat/core/data/fake_repositories.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/storage/secure_token_store.dart';
import 'package:jawwid_chat/features/auth/application/auth_controller.dart';
import 'package:jawwid_chat/features/auth/domain/auth_state.dart';
import 'package:jawwid_chat/features/profile/application/parent_profile_controller.dart';
import 'package:jawwid_chat/shared/models/auth.dart';
import 'package:jawwid_chat/shared/models/message.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

/// Changing your own photo refreshes the signed-in identity EXACTLY ONCE (M4).
///
/// The identity is what Settings, the chat list, message authors and every participant
/// list render. A photo that changed without it would appear on My Account and nowhere
/// else — which is the shape of the original complaint, "the avatar never changes".
///
/// The counting matters in both directions. Too few refreshes and the new photo stays
/// invisible elsewhere; more than one is a second identical round trip on a mobile
/// connection, and a child's photo refreshing the signed-in identity would be a request
/// that cannot change anything, because a child is not the signed-in actor.
void main() {
  late int refreshes;

  setUp(() => refreshes = 0);

  const image = PendingAttachment(
    filePath: '/tmp/face.jpg',
    kind: MessageKind.image,
    mimeType: 'image/jpeg',
    byteSize: 1024,
  );

  ProviderContainer containerWith(FakeProfileRepository repository) {
    final container = ProviderContainer(
      overrides: [
        profileRepositoryProvider.overrideWithValue(repository),
        authControllerProvider.overrideWith(() => _CountingAuth(() => refreshes++)),
      ],
    );
    addTearDown(container.dispose);
    return container;
  }

  group('the caller edits their OWN photo', () {
    test('setAvatar refreshes the identity exactly once, after success', () async {
      final container = containerWith(FakeProfileRepository());
      final controller = container.read(parentProfileProvider.notifier);
      await container.read(parentProfileProvider.future);

      expect(refreshes, 0, reason: 'a plain read must not refresh identity');

      final failure = await controller.setAvatar(image);

      expect(failure, isNull);
      expect(refreshes, 1);
    });

    test('removeAvatar refreshes the identity exactly once, after success', () async {
      final container = containerWith(FakeProfileRepository());
      final controller = container.read(parentProfileProvider.notifier);
      await container.read(parentProfileProvider.future);

      final failure = await controller.removeAvatar();

      expect(failure, isNull);
      expect(refreshes, 1);
    });

    test('two mutations refresh twice -- once each, never batched or doubled', () async {
      final container = containerWith(FakeProfileRepository());
      final controller = container.read(parentProfileProvider.notifier);
      await container.read(parentProfileProvider.future);

      await controller.setAvatar(image);
      await controller.removeAvatar();

      expect(refreshes, 2);
    });

    test('the local state is updated as well as the identity', () async {
      final container = containerWith(FakeProfileRepository());
      final controller = container.read(parentProfileProvider.notifier);
      await container.read(parentProfileProvider.future);

      await controller.setAvatar(image);

      expect(container.read(parentProfileProvider).value?.avatarUrl, isNotNull);
      expect(refreshes, 1);
    });
  });

  group("a CHILD's photo is not the signed-in identity", () {
    test('setChildAvatar refreshes the signed-in identity zero times', () async {
      final container = containerWith(FakeProfileRepository());
      final controller = container.read(parentProfileProvider.notifier);
      await container.read(parentProfileProvider.future);

      final failure = await controller.setChildAvatar('learner-1', image);

      expect(failure, isNull, reason: 'the child mutation still has to succeed');
      expect(refreshes, 0);
    });

    test('removeChildAvatar refreshes the signed-in identity zero times', () async {
      final container = containerWith(FakeProfileRepository());
      final controller = container.read(parentProfileProvider.notifier);
      await container.read(parentProfileProvider.future);

      await controller.setChildAvatar('learner-1', image);
      await controller.removeChildAvatar('learner-1');

      expect(refreshes, 0);
    });
  });

  group('a failure never takes the success path', () {
    test('a failed setAvatar does not refresh the identity', () async {
      final container = containerWith(
        FakeProfileRepository(mutationError: const AppError(AppErrorKind.network)),
      );
      final controller = container.read(parentProfileProvider.notifier);
      await container.read(parentProfileProvider.future);

      final failure = await controller.setAvatar(image);

      expect(failure, isNotNull, reason: 'the caller is told, not left guessing');
      expect(refreshes, 0);
    });

    test('a failed removeAvatar does not refresh the identity', () async {
      final container = containerWith(
        FakeProfileRepository(mutationError: const AppError(AppErrorKind.server)),
      );
      final controller = container.read(parentProfileProvider.notifier);
      await container.read(parentProfileProvider.future);

      expect(await controller.removeAvatar(), isNotNull);
      expect(refreshes, 0);
    });

    test('a failed mutation leaves the profile on screen, not an error page', () async {
      final container = containerWith(
        FakeProfileRepository(mutationError: const AppError(AppErrorKind.network)),
      );
      final controller = container.read(parentProfileProvider.notifier);
      final before = await container.read(parentProfileProvider.future);

      await controller.setAvatar(image);

      expect(container.read(parentProfileProvider).value?.displayName,
          before.displayName);
      expect(container.read(parentProfileProvider).hasError, isFalse);
    });
  });

  group('a non-parent account shares the same discipline', () {
    test('OwnAvatarController also refreshes exactly once', () async {
      final container = containerWith(FakeProfileRepository());
      final controller = container.read(ownAvatarProvider.notifier);
      await container.read(ownAvatarProvider.future);

      await controller.setAvatar(image);

      expect(refreshes, 1);
    });
  });
}

/// An authenticated session that counts identity refreshes instead of performing them.
///
/// Counting rather than spying on a repository: the contract is about how many times the
/// controller asks the AUTH layer to re-read identity, which is the thing every other
/// screen listens to.
class _CountingAuth extends AuthController {
  _CountingAuth(this._onRefresh)
      : super(
          repository: FakeAuthRepository(
            backend: FakeBackend(role: UserRole.parent),
            tokens: InMemoryTokenStore(),
          ),
          tokens: InMemoryTokenStore(),
          clearLocalData: _noop,
        );

  final void Function() _onRefresh;

  static Future<void> _noop() async {}

  @override
  AuthState build() => const AuthAuthenticated(
        AuthUser(id: 'u_parent', displayName: 'ولي أمر', role: UserRole.parent),
      );

  @override
  Future<void> refreshIdentity() async => _onRefresh();
}
