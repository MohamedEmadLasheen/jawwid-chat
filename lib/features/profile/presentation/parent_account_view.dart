import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../design/tokens.dart';
import '../../../design/widgets/jawwid_avatar.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/parent_profile.dart';
import '../../../shared/utils/text_direction.dart';
import '../application/parent_profile_controller.dart';
import 'profile_sections.dart';

/// Photo management for a parent's own account.
///
/// These are two small widgets, not a screen. They slot into the EXISTING account screen
/// (`ProfileBody.header` and `ChildTile.action`), because the children section there —
/// with its group, teacher, level, subscription and schedule behind progressive
/// disclosure — is existing functionality that a photo feature has no business replacing.
///
/// ## Why the photo is the only editable thing
///
/// A parent does not own their name, their family, or anything about their child's
/// enrolment; the academy does. The one thing genuinely theirs is a picture.
///
/// ## Why there is no phone or email here
///
/// There is none to show. `chat.contact` has no such column and the client models none,
/// which is what makes "a teacher cannot read a parent's phone number" a property of the
/// system rather than a rule. The SIGN-IN identity is shown instead — read-only, with a
/// line saying the academy manages it.
/// The large avatar, the name, and the one action a parent actually has.
class EditableProfilePhoto extends ConsumerStatefulWidget {
  const EditableProfilePhoto({super.key}) : _ownAvatarOnly = false;

  /// The same control for an account that is NOT a parent.
  ///
  /// A teacher and an admin own a photo but have no family, so their name and picture come
  /// from `GET /me/avatar` instead of the parent profile route. Everything else -- the
  /// badge, the sheet, the failure handling -- is identical, because changing your own
  /// photo is the same act whoever you are.
  const EditableProfilePhoto.own({super.key}) : _ownAvatarOnly = true;

  /// Which read backs this control. Not a style switch: the two routes answer different
  /// questions and only one of them works for a given account kind.
  final bool _ownAvatarOnly;

  @override
  ConsumerState<EditableProfilePhoto> createState() => _EditablePhotoState();
}

class _EditablePhotoState extends ConsumerState<EditableProfilePhoto> {
  bool _busy = false;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final tokens = JawwidTokens.of(context);

    // Until the profile arrives there is nothing to edit; the surrounding screen is
    // already showing the account, so this stays out of the way rather than flashing a
    // second spinner into the middle of it.
    final profile = switch (ref.watch(_source)) {
      AsyncData(:final value) => value,
      _ => null,
    };
    if (profile == null) return const SizedBox.shrink();

    return Padding(
      // Directional, not physical: `fromLTRB` would mirror wrongly under RTL, which the
      // directionality guard rightly refuses.
      padding: const EdgeInsetsDirectional.fromSTEB(
        Spacing.spacing5,
        Spacing.spacing7,
        Spacing.spacing5,
        Spacing.spacing6,
      ),
      child: Column(
        children: [
          // The avatar IS the control. A separate button underneath made the photo look
          // like decoration next to an unrelated action; a badge on the circle is the
          // affordance people already reach for, and it keeps the eye in one place.
          Semantics(
            button: true,
            label: l10n.profilePhotoEditLabel,
            child: ExcludeSemantics(
              // The badge sits OUTSIDE the circular Material on purpose: that Material
              // clips to a circle, so a badge drawn inside it would be cut off at the
              // corner where it belongs. The avatar is the tap target; the badge only
              // says so.
              child: Stack(
                alignment: AlignmentDirectional.bottomEnd,
                children: [
                  Material(
                    color: Colors.transparent,
                    shape: const CircleBorder(),
                    clipBehavior: Clip.antiAlias,
                    child: InkWell(
                      onTap: _busy ? null : _openSheet,
                      customBorder: const CircleBorder(),
                      child: Stack(
                        children: [
                          // A hairline ring lifts the avatar off the page in both themes
                          // without inventing a shadow the design system does not use.
                          DecoratedBox(
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              border: Border.all(color: tokens.colorBorderSubtle),
                            ),
                            child: JawwidAvatar(
                              displayName: profile.displayName,
                              imageUrl: profile.avatarUrl,
                              size: Sizes.avatarXl,
                            ),
                          ),
                          if (_busy)
                            Positioned.fill(
                              child: DecoratedBox(
                                decoration: BoxDecoration(
                                  shape: BoxShape.circle,
                                  color: tokens.colorSurfaceInverse
                                      .withValues(alpha: 0.45),
                                ),
                                child: const Center(
                                  child: SizedBox(
                                    width: 24,
                                    height: 24,
                                    child: CircularProgressIndicator(strokeWidth: 2),
                                  ),
                                ),
                              ),
                            ),
                        ],
                      ),
                    ),
                  ),
                  if (!_busy) const IgnorePointer(child: _CameraBadge()),
                ],
              ),
            ),
          ),

          const SizedBox(height: Spacing.spacing4),
          ContentText(
            profile.displayName,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            textAlign: TextAlign.center,
            style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700),
          ),

          // The academy's word for this person, when it has one. One quiet line under
          // the name does more for "this is my account" than another control would.
          if (profile.relationship != null) ...[
            const SizedBox(height: Spacing.spacing1),
            ContentText(
              profile.relationship!,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center,
              style: theme.textTheme.bodySmall
                  ?.copyWith(color: tokens.colorTextSecondary),
            ),
          ],

          const SizedBox(height: Spacing.spacing2),
          // Secondary to the avatar now, and still the whole action for anyone who does
          // not read a badge as a button.
          TextButton(
            onPressed: _busy ? null : _openSheet,
            child: Text(
              _busy
                  ? l10n.profilePhotoUploading
                  : (profile.hasPhoto ? l10n.profilePhotoChange : l10n.profilePhotoAdd),
            ),
          ),

          if (profile.signInIdentity != null) ...[
            const SizedBox(height: Spacing.spacing2),
            _InfoRow(
              label: l10n.profileSignInIdentity,
              value: profile.signInIdentity!,
              copyable: true,
            ),
            ProfileNote(text: l10n.profileSignInIdentityNote),
          ],
        ],
      ),
    );
  }

  /// The provider this control reads and mutates. One or the other, never both.
  AsyncNotifierProvider<AvatarNotifier, ParentProfile> get _source =>
      widget._ownAvatarOnly ? ownAvatarProvider : parentProfileProvider;

  bool get _hasPhoto => switch (ref.read(_source)) {
        AsyncData(:final value) => value.hasPhoto,
        _ => false,
      };

  Future<void> _openSheet() async {
    final l10n = L10n.of(context);
    final choice = await showModalBottomSheet<_PhotoAction>(
      context: context,
      builder: (context) => _PhotoSheet(
        title: l10n.profilePhotoTitle,
        canRemove: _hasPhoto,
      ),
    );
    if (choice == null || !mounted) return;

    await _run(
      choice == _PhotoAction.remove
          ? (notifier) => notifier.removeAvatar()
          : (notifier) async {
              final image = await ref.read(mediaPickerProvider).pickImage();
              // Cancelling the picker is not a failure and must say nothing.
              if (image == null) return null;
              return notifier.setAvatar(image);
            },
      failureMessage: choice == _PhotoAction.remove
          ? l10n.profilePhotoRemoveFailed
          : l10n.profilePhotoFailed,
    );
  }

  Future<void> _run(
    Future<Object?> Function(AvatarNotifier notifier) action, {
    required String failureMessage,
  }) async {
    setState(() => _busy = true);
    try {
      final failure = await action(ref.read(_source.notifier));
      if (!mounted || failure == null) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(failureMessage)),
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }
}

/// A child's photo on their own row, and the control that changes it.
///
/// The avatar and the action are one thing, exactly as in the header: tapping the picture
/// is how a photo gets changed, which puts the control where the content is instead of
/// floating an unrelated icon at the far edge of the row. Returning it to the row's
/// LEADING slot also gives the tile its expand chevron back.
///
/// Behaviour is unchanged — the same controller calls, the same sheet, the same flows.
class ChildPhotoAvatar extends ConsumerStatefulWidget {
  const ChildPhotoAvatar({super.key, required this.learnerId, required this.displayName});

  final String learnerId;

  /// From the row that already knows it, so the fallback initials are right even before
  /// the profile endpoint has described this child.
  final String displayName;

  @override
  ConsumerState<ChildPhotoAvatar> createState() => _ChildPhotoAvatarState();
}

class _ChildPhotoAvatarState extends ConsumerState<ChildPhotoAvatar> {
  bool _busy = false;

  ChildProfile? _childOf(AsyncValue<ParentProfile> state) => switch (state) {
        AsyncData(:final value) =>
          value.children.where((c) => c.id == widget.learnerId).firstOrNull,
        _ => null,
      };

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final tokens = JawwidTokens.of(context);
    final child = _childOf(ref.watch(parentProfileProvider));

    final avatar = DecoratedBox(
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        border: Border.all(color: tokens.colorBorderSubtle),
      ),
      child: JawwidAvatar(
        displayName: widget.displayName,
        imageUrl: child?.avatarUrl,
        size: Sizes.avatarLg,
      ),
    );

    // A child the profile endpoint has not described gets the avatar WITHOUT the control:
    // offering a button that could only fail is worse than offering none.
    if (child == null) return avatar;

    return Semantics(
      button: true,
      label: l10n.profileChildPhotoEditLabel(widget.displayName),
      child: ExcludeSemantics(
        // Same arrangement as the header: the circular Material would clip a badge drawn
        // inside it, so the badge rides on top and the avatar takes the tap.
        child: Stack(
          alignment: AlignmentDirectional.bottomEnd,
          children: [
            Material(
              color: Colors.transparent,
              shape: const CircleBorder(),
              clipBehavior: Clip.antiAlias,
              child: InkWell(
                onTap: _busy ? null : _openSheet,
                customBorder: const CircleBorder(),
                child: Stack(
                  children: [
                    avatar,
                    if (_busy)
                      Positioned.fill(
                        child: DecoratedBox(
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            color:
                                tokens.colorSurfaceInverse.withValues(alpha: 0.45),
                          ),
                          child: const Center(
                            child: SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            ),
            if (!_busy) const IgnorePointer(child: _CameraBadge(diameter: 20)),
          ],
        ),
      ),
    );
  }

  Future<void> _openSheet() async {
    final l10n = L10n.of(context);
    final child = _childOf(ref.read(parentProfileProvider));
    if (child == null) return;

    final choice = await showModalBottomSheet<_PhotoAction>(
      context: context,
      builder: (context) => _PhotoSheet(
        title: l10n.profileChildPhotoTitle(child.displayName),
        canRemove: child.hasPhoto,
      ),
    );
    if (choice == null || !mounted) return;

    setState(() => _busy = true);
    try {
      final notifier = ref.read(parentProfileProvider.notifier);
      Object? failure;
      if (choice == _PhotoAction.remove) {
        failure = await notifier.removeChildAvatar(widget.learnerId);
      } else {
        final image = await ref.read(mediaPickerProvider).pickImage();
        // Backing out of the picker is not a failure and must say nothing.
        if (image == null) return;
        failure = await notifier.setChildAvatar(widget.learnerId, image);
      }
      if (!mounted || failure == null) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            choice == _PhotoAction.remove
                ? l10n.profilePhotoRemoveFailed
                : l10n.profilePhotoFailed,
          ),
        ),
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }
}

/// The small camera disc that marks an avatar as changeable.
///
/// Drawn from tokens so it reads correctly on both canvases: brand fill, on-brand glyph,
/// and a ring in the page colour so the disc stays legible where it overlaps the photo.
class _CameraBadge extends StatelessWidget {
  const _CameraBadge({this.diameter = 30});

  final double diameter;

  @override
  Widget build(BuildContext context) {
    final tokens = JawwidTokens.of(context);

    return Container(
      width: diameter,
      height: diameter,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: tokens.colorBrandPrimary,
        border: Border.all(color: tokens.colorBackgroundPage, width: 2),
      ),
      child: Icon(
        Icons.photo_camera_rounded,
        size: diameter * 0.52,
        color: tokens.colorBrandOnPrimary,
      ),
    );
  }
}

enum _PhotoAction { choose, remove }

/// Choose or remove. Deliberately two options and no more: there is nothing else a photo
/// can do, and a sheet of disabled possibilities is noise.
class _PhotoSheet extends StatelessWidget {
  const _PhotoSheet({required this.title, required this.canRemove});

  final String title;
  final bool canRemove;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final tokens = JawwidTokens.of(context);

    return SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Padding(
            padding: const EdgeInsets.all(Spacing.spacing5),
            child: ContentText(
              title,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.titleMedium,
            ),
          ),
          ListTile(
            leading: const Icon(Icons.photo_library_outlined),
            title: Text(canRemove ? l10n.profilePhotoChange : l10n.profilePhotoAdd),
            onTap: () => Navigator.of(context).pop(_PhotoAction.choose),
          ),
          if (canRemove)
            ListTile(
              leading: Icon(Icons.delete_outline, color: tokens.colorStatusDangerFg),
              title: Text(
                l10n.profilePhotoRemove,
                style: TextStyle(color: tokens.colorStatusDangerFg),
              ),
              onTap: () => Navigator.of(context).pop(_PhotoAction.remove),
            ),
          const SizedBox(height: Spacing.spacing4),
        ],
      ),
    );
  }
}

/// A label and a value, where the value may be long and may be Latin inside an RTL screen.
class _InfoRow extends StatelessWidget {
  const _InfoRow({required this.label, required this.value, this.copyable = false});

  final String label;
  final String value;
  final bool copyable;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final tokens = JawwidTokens.of(context);

    return ListTile(
      contentPadding: const EdgeInsetsDirectional.symmetric(
        horizontal: Spacing.spacing5,
        vertical: Spacing.spacing1,
      ),
      title: Text(
        label,
        style: Theme.of(context)
            .textTheme
            .labelMedium
            ?.copyWith(color: tokens.colorTextSecondary),
      ),
      // ContentText sets its own direction from the content, so a Latin sign-in inside an
      // Arabic screen reads left-to-right without the screen changing direction.
      subtitle: ContentText(
        value,
        maxLines: 2,
        overflow: TextOverflow.ellipsis,
        style: Theme.of(context).textTheme.bodyLarge,
      ),
      trailing: !copyable
          ? null
          : IconButton(
              icon: const Icon(Icons.copy_outlined),
              onPressed: () async {
                await Clipboard.setData(ClipboardData(text: value));
                if (!context.mounted) return;
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(content: Text(l10n.profileCopied)),
                );
              },
            ),
    );
  }
}
