import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/errors/app_error.dart';
import '../../../core/media/media_picker.dart';
import '../../../design/tokens.dart';
import '../../../design/widgets/jawwid_avatar.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/utils/text_direction.dart';
import '../data/profile_photo_repository.dart';
import 'profile_sections.dart';

/// The signed-in person's photos, scoped to the session: a different account
/// reads its own, never the previous one's.
final myPhotosProvider = FutureProvider.autoDispose<MyPhotos>((ref) async {
  ref.watch(principalIdProvider);
  return ref.watch(profilePhotoRepositoryProvider).mine();
});

/// "Profile photo" on My account -- and, for a parent, their children's.
///
/// WhatsApp-style (owner decision 2026-10-19): everyone in a chat sees the
/// photo. Offered only when this build has a photo server.
class ProfilePhotosSection extends ConsumerStatefulWidget {
  const ProfilePhotosSection({super.key, required this.displayName});

  /// The viewer's own name, for the initials shown until there is a photo.
  final String displayName;

  @override
  ConsumerState<ProfilePhotosSection> createState() => _ProfilePhotosSectionState();
}

class _ProfilePhotosSectionState extends ConsumerState<ProfilePhotosSection> {
  /// Whose photo is being saved: '' for the viewer, a child's id otherwise.
  String? _busy;
  String? _error;

  Future<void> _run(String who, Future<void> Function() action) async {
    setState(() {
      _busy = who;
      _error = null;
    });
    final l10n = L10n.of(context);
    try {
      await action();
      ref.invalidate(myPhotosProvider);
    } on MediaPickException {
      // The picker said why; nothing was sent.
    } on AppError catch (e) {
      if (mounted) {
        setState(() => _error = e.code == 'COMM.PROFILE_PHOTO_INVALID' ? l10n.profilePhotoInvalid : l10n.profilePhotoFailed);
      }
    } catch (_) {
      if (mounted) setState(() => _error = l10n.profilePhotoFailed);
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  Future<void> _change({String? childId}) => _run(childId ?? '', () async {
        final picked = await ref.read(mediaPickerProvider).pickImage();
        if (picked == null) return;
        await ref.read(profilePhotoRepositoryProvider).set(picked, childId: childId);
      });

  Future<void> _remove({String? childId}) =>
      _run(childId ?? '', () => ref.read(profilePhotoRepositoryProvider).remove(childId: childId));

  @override
  Widget build(BuildContext context) {
    final repository = ref.watch(profilePhotoRepositoryProvider);
    if (!repository.isAvailable) return const SizedBox.shrink();

    final l10n = L10n.of(context);
    final photos = ref.watch(myPhotosProvider).asData?.value ?? const MyPhotos();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        ProfileSectionHeading(text: l10n.profilePhotoTitle),
        _PhotoRow(
          name: widget.displayName,
          url: photos.avatarUrl,
          hint: l10n.profilePhotoHint,
          busy: _busy == '',
          onChange: _busy == null ? () => _change() : null,
          onRemove: _busy == null && photos.avatarUrl != null ? () => _remove() : null,
        ),
        if (photos.hasChildren) ...[
          const ProfileDivider(),
          ProfileSectionHeading(text: l10n.childrenPhotosTitle),
          ProfileNote(text: l10n.childrenPhotosHint),
          for (final child in photos.children)
            _PhotoRow(
              name: child.name,
              url: child.avatarUrl,
              busy: _busy == child.id,
              onChange: _busy == null ? () => _change(childId: child.id) : null,
              onRemove: _busy == null && child.avatarUrl != null ? () => _remove(childId: child.id) : null,
            ),
        ],
        if (_error != null)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: Spacing.spacing5, vertical: Spacing.spacing2),
            child: Text(
              _error!,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          ),
      ],
    );
  }
}

class _PhotoRow extends StatelessWidget {
  const _PhotoRow({
    required this.name,
    required this.url,
    required this.busy,
    this.hint,
    this.onChange,
    this.onRemove,
  });

  final String name;
  final String? url;
  final String? hint;
  final bool busy;
  final VoidCallback? onChange;
  final VoidCallback? onRemove;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final tokens = JawwidTokens.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: Spacing.spacing5, vertical: Spacing.spacing3),
      child: Row(
        children: [
          JawwidAvatar(displayName: name, imageUrl: url, size: Sizes.avatarLg),
          const SizedBox(width: Spacing.spacing4),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                ContentText(name, style: Theme.of(context).textTheme.titleSmall),
                if (hint != null)
                  Text(hint!, style: Theme.of(context).textTheme.bodySmall?.copyWith(color: tokens.colorTextSecondary)),
                const SizedBox(height: Spacing.spacing2),
                Wrap(
                  spacing: Spacing.spacing2,
                  children: [
                    if (busy)
                      Text(l10n.profilePhotoSaving)
                    else ...[
                      OutlinedButton(
                        onPressed: onChange,
                        child: Text(url == null ? l10n.profilePhotoAdd : l10n.profilePhotoChange),
                      ),
                      if (url != null)
                        TextButton(onPressed: onRemove, child: Text(l10n.profilePhotoRemove)),
                    ],
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
