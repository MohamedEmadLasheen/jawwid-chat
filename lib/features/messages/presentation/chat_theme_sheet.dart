import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/data/repositories.dart';
import '../../../core/errors/app_error.dart';
import '../../../core/errors/error_presenter.dart';
import '../../../core/media/media_picker.dart';
import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';

/// The viewer's look for one chat, as the chat screen paints it.
typedef ChatAppearance = ({String? themeKey, String? wallpaperUrl});

/// The viewer's latest choices this session, by conversation id. The route's
/// conversation is cached for the session, so without this a chat reopened
/// after a change would paint its old look. Emptied when the signed-in person
/// changes: one account's choices never show in another's.
final chatAppearanceProvider = NotifierProvider<ChatAppearanceStore, Map<String, ChatAppearance>>(ChatAppearanceStore.new);

class ChatAppearanceStore extends Notifier<Map<String, ChatAppearance>> {
  @override
  Map<String, ChatAppearance> build() {
    ref.watch(principalIdProvider);
    return const {};
  }

  void set(String conversationId, ChatAppearance appearance) => state = {...state, conversationId: appearance};
}

/// The background behind a chat's messages: the viewer's preset and/or photo.
/// Only the background changes; bubbles keep their own, contrast-checked
/// colours, and a photo is dimmed so messages stay easy to read.
class ChatBackground extends StatelessWidget {
  const ChatBackground({super.key, required this.appearance, required this.child, this.onPhotoFailed});

  final ChatAppearance appearance;
  final Widget child;

  /// The photo did not load. Its link is signed and expires (1-2 hours), and a
  /// chat's data can be older than that, so the screen fetches a fresh link.
  final void Function(String failedUrl)? onPhotoFailed;

  @override
  Widget build(BuildContext context) {
    final brightness = Theme.of(context).brightness;
    final stops = ChatThemePalette.stops(appearance.themeKey, brightness);
    final photo = appearance.wallpaperUrl;
    if (stops == null && photo == null) return child;
    return DecoratedBox(
      key: const ValueKey('chat-background'),
      decoration: BoxDecoration(
        gradient: stops == null
            ? null
            : LinearGradient(begin: AlignmentDirectional.topStart, end: AlignmentDirectional.bottomEnd, colors: stops),
        image: photo == null
            ? null
            : DecorationImage(
                image: NetworkImage(photo),
                fit: BoxFit.cover,
                colorFilter: ColorFilter.mode(
                  brightness == Brightness.dark ? ChatThemePalette.photoScrimDark : ChatThemePalette.photoScrimLight,
                  BlendMode.srcOver,
                ),
                // A link that failed (expired, offline) leaves the preset showing,
                // and asks for a fresh one.
                onError: (_, _) => onPhotoFailed?.call(photo),
              ),
      ),
      child: child,
    );
  }
}

String chatThemeName(L10n l10n, String? key) => switch (key) {
      'lagoon' => l10n.chatThemeLagoon,
      'sand' => l10n.chatThemeSand,
      'rose' => l10n.chatThemeRose,
      'sky' => l10n.chatThemeSky,
      'lilac' => l10n.chatThemeLilac,
      'olive' => l10n.chatThemeOlive,
      'slate' => l10n.chatThemeSlate,
      'dusk' => l10n.chatThemeDusk,
      _ => l10n.chatThemeDefault,
    };

Future<void> showChatThemeSheet(
  BuildContext context, {
  required String conversationId,
  required ChatAppearance current,
  required ValueChanged<ChatAppearance> onChanged,
}) {
  return showModalBottomSheet<void>(
    context: context,
    useRootNavigator: true,
    isScrollControlled: true,
    showDragHandle: true,
    useSafeArea: true,
    builder: (_) => ChatThemeSheet(conversationId: conversationId, initial: current, onChanged: onChanged),
  );
}

/// Choose this chat's look (owner decisions 2026-10-20): private to the viewer,
/// presets plus their own photo, saved on the server. Each choice applies at
/// once -- the chat behind the sheet changes with it.
class ChatThemeSheet extends ConsumerStatefulWidget {
  const ChatThemeSheet({super.key, required this.conversationId, required this.initial, required this.onChanged});

  final String conversationId;
  final ChatAppearance initial;
  final ValueChanged<ChatAppearance> onChanged;

  @override
  ConsumerState<ChatThemeSheet> createState() => _ChatThemeSheetState();
}

class _ChatThemeSheetState extends ConsumerState<ChatThemeSheet> {
  late ChatAppearance _now = widget.initial;
  bool _busy = false;
  String? _error;

  void _apply(ChatAppearance next) {
    setState(() => _now = next);
    widget.onChanged(next);
  }

  Future<void> _run(Future<void> Function() action) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await action();
    } on AppError catch (error) {
      if (mounted) {
        final l10n = L10n.of(context);
        // The server's wallpaper refusals, worded for the viewer (review fix, PR #72).
        final specific = switch (error.code) {
          'COMM.CHAT_WALLPAPER_TYPE' => l10n.chatWallpaperBadType,
          'COMM.CHAT_WALLPAPER_TOO_LARGE' => l10n.chatWallpaperTooLarge,
          'COMM.CHAT_WALLPAPER_DIMENSIONS' => l10n.chatWallpaperBadSize,
          'COMM.CHAT_WALLPAPER_ANIMATED' => l10n.chatWallpaperAnimated,
          _ => null,
        };
        final message = ErrorPresenter.present(error, l10n);
        setState(() => _error = specific ?? message.body ?? message.title);
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _pick(String? key) async {
    final before = _now;
    _apply((themeKey: key, wallpaperUrl: _now.wallpaperUrl)); // optimistic
    await _run(() async {
      try {
        await ref.read(chatThemeRepositoryProvider).setTheme(widget.conversationId, key);
      } catch (_) {
        _apply(before);
        rethrow;
      }
    });
  }

  Future<void> _choosePhoto() async {
    final PendingAttachment? photo;
    try {
      photo = await ref.read(mediaPickerProvider).pickImage();
    } on MediaPickException {
      return;
    }
    if (photo == null || !mounted) return;
    await _run(() async {
      final url = await ref.read(chatThemeRepositoryProvider).setWallpaper(widget.conversationId, photo!);
      _apply((themeKey: _now.themeKey, wallpaperUrl: url));
    });
  }

  Future<void> _removePhoto() => _run(() async {
        await ref.read(chatThemeRepositoryProvider).removeWallpaper(widget.conversationId);
        _apply((themeKey: _now.themeKey, wallpaperUrl: null));
      });

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final tokens = JawwidTokens.of(context);
    final brightness = theme.brightness;

    Widget swatch(String? key) {
      final stops = ChatThemePalette.stops(key, brightness);
      final selected = _now.themeKey == key;
      return Semantics(
        selected: selected,
        button: true,
        label: chatThemeName(l10n, key),
        excludeSemantics: true,
        child: InkWell(
          key: ValueKey('theme-${key ?? 'default'}'),
          borderRadius: const BorderRadius.all(Radii.radiusMd),
          onTap: _busy ? null : () => _pick(key),
          child: SizedBox(
            width: 76,
            child: Column(
              children: [
                Container(
                  height: 48,
                  decoration: BoxDecoration(
                    color: stops == null ? tokens.colorBackgroundPage : null,
                    gradient: stops == null ? null : LinearGradient(colors: stops),
                    borderRadius: const BorderRadius.all(Radii.radiusMd),
                    border: Border.all(
                      color: selected ? tokens.colorBrandPrimary : tokens.colorBorderDefault,
                      width: selected ? 2 : 1,
                    ),
                  ),
                  child: selected ? Icon(Icons.check, color: tokens.colorBrandPrimary) : null,
                ),
                const SizedBox(height: Spacing.spacing1),
                Text(chatThemeName(l10n, key), style: theme.textTheme.labelSmall, maxLines: 1, overflow: TextOverflow.ellipsis),
              ],
            ),
          ),
        ),
      );
    }

    return SingleChildScrollView(
      padding: const EdgeInsetsDirectional.fromSTEB(Spacing.spacing5, 0, Spacing.spacing5, Spacing.spacing6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(l10n.chatThemeAction, style: theme.textTheme.titleMedium),
          const SizedBox(height: Spacing.spacing1),
          Text(l10n.chatThemeHint, style: theme.textTheme.bodySmall?.copyWith(color: tokens.colorTextSecondary)),
          const SizedBox(height: Spacing.spacing4),
          Wrap(
            spacing: Spacing.spacing3,
            runSpacing: Spacing.spacing3,
            children: [swatch(null), for (final key in ChatThemePalette.keys) swatch(key)],
          ),
          const SizedBox(height: Spacing.spacing5),
          Text(l10n.chatWallpaperTitle, style: theme.textTheme.titleSmall),
          const SizedBox(height: Spacing.spacing2),
          Wrap(
            spacing: Spacing.spacing2,
            runSpacing: Spacing.spacing2,
            children: [
              OutlinedButton.icon(
                onPressed: _busy ? null : _choosePhoto,
                icon: const Icon(Icons.photo_outlined),
                label: Text(_now.wallpaperUrl == null ? l10n.chatWallpaperChoose : l10n.chatWallpaperReplace),
                style: OutlinedButton.styleFrom(minimumSize: const Size(0, 40)),
              ),
              if (_now.wallpaperUrl != null)
                TextButton.icon(
                  onPressed: _busy ? null : _removePhoto,
                  icon: const Icon(Icons.delete_outline),
                  label: Text(l10n.chatWallpaperRemove),
                  style: TextButton.styleFrom(minimumSize: const Size(0, 40)),
                ),
            ],
          ),
          if (_busy) const Padding(padding: EdgeInsets.only(top: Spacing.spacing3), child: LinearProgressIndicator(minHeight: 2)),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(top: Spacing.spacing3),
              child: Text(_error!, style: theme.textTheme.bodySmall?.copyWith(color: tokens.colorStatusDangerFg)),
            ),
        ],
      ),
    );
  }
}
