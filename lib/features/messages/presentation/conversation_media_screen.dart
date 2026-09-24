import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../design/tokens.dart';
import '../../../design/widgets/state_views.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/message.dart';
import '../../../shared/utils/byte_size_format.dart';
import '../../../shared/utils/relative_time.dart';
import '../../../shared/utils/text_direction.dart';
import '../application/messages_controller.dart';
import 'media_viewer.dart';

/// Everything shared in one conversation, in three tabs.
///
/// ## Why it is built from the message log
///
/// There is no media endpoint. Rather than invent one — or, worse, show a
/// plausible-looking grid assembled from nothing — this reads the conversation
/// the client has actually loaded and offers **Load older** to page further
/// back through the same authorized history the chat screen uses. So what is
/// listed here is real, is scoped by the same permissions, and is honest about
/// being partial: the button says there may be more, and pressing it fetches it.
///
/// §29 — secondary navigation, reached from Conversation Info, never a section
/// of the app.
class ConversationMediaScreen extends ConsumerWidget {
  const ConversationMediaScreen({super.key, required this.conversationId});

  final String conversationId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final state = ref.watch(messagesControllerProvider(conversationId));
    final controller =
        ref.read(messagesControllerProvider(conversationId).notifier);

    final shared = _SharedItems.from(state.log.messages);

    return DefaultTabController(
      length: 3,
      child: Scaffold(
        appBar: AppBar(
          title: Text(l10n.mediaAndFilesTitle),
          bottom: TabBar(
            tabs: [
              Tab(text: l10n.mediaPhotosTab),
              Tab(text: l10n.mediaFilesTab),
              Tab(text: l10n.mediaVoiceTab),
            ],
          ),
        ),
        body: state.isLoadingInitial
            ? JawwidLoadingView(label: l10n.mediaAndFilesTitle)
            : TabBarView(
                children: [
                  _PhotoGrid(
                    items: shared.photos,
                    hasMoreOlder: state.log.hasMoreOlder,
                    isLoadingOlder: state.isLoadingOlder,
                    onLoadOlder: controller.loadOlder,
                  ),
                  _ItemList(
                    items: shared.files,
                    hasMoreOlder: state.log.hasMoreOlder,
                    isLoadingOlder: state.isLoadingOlder,
                    onLoadOlder: controller.loadOlder,
                  ),
                  _ItemList(
                    items: shared.voice,
                    hasMoreOlder: state.log.hasMoreOlder,
                    isLoadingOlder: state.isLoadingOlder,
                    onLoadOlder: controller.loadOlder,
                  ),
                ],
              ),
      ),
    );
  }
}

/// One shared attachment, with the message that carried it.
class _SharedItem {
  const _SharedItem({required this.message, required this.attachment});

  final Message message;
  final Attachment attachment;
}

/// The conversation's attachments, split by kind, newest first.
class _SharedItems {
  const _SharedItems({
    required this.photos,
    required this.files,
    required this.voice,
  });

  factory _SharedItems.from(List<Message> messages) {
    final photos = <_SharedItem>[];
    final files = <_SharedItem>[];
    final voice = <_SharedItem>[];

    // Newest first: the thing someone is looking for is usually the thing that
    // just arrived.
    for (final message in messages.reversed) {
      // A retracted message's attachments are gone server-side; a message still
      // in the outbox has not been shared with anyone yet.
      if (message.isDeleted || message.deliveryState.isLocal) continue;

      for (final attachment in message.attachments) {
        final item = _SharedItem(message: message, attachment: attachment);
        switch (attachment.kind) {
          case MessageKind.image:
            photos.add(item);
          case MessageKind.voice:
            voice.add(item);
          case MessageKind.file || MessageKind.video:
            files.add(item);
          case MessageKind.text || MessageKind.system:
            break;
        }
      }
    }

    return _SharedItems(photos: photos, files: files, voice: voice);
  }

  final List<_SharedItem> photos;
  final List<_SharedItem> files;
  final List<_SharedItem> voice;
}

class _PhotoGrid extends StatelessWidget {
  const _PhotoGrid({
    required this.items,
    required this.hasMoreOlder,
    required this.isLoadingOlder,
    required this.onLoadOlder,
  });

  final List<_SharedItem> items;
  final bool hasMoreOlder;
  final bool isLoadingOlder;
  final Future<void> Function() onLoadOlder;

  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) {
      return _Empty(
        hasMoreOlder: hasMoreOlder,
        isLoadingOlder: isLoadingOlder,
        onLoadOlder: onLoadOlder,
      );
    }

    final photos = items.map((i) => i.attachment).toList(growable: false);

    return CustomScrollView(
      slivers: [
        SliverPadding(
          padding: const EdgeInsets.all(Spacing.spacing2),
          sliver: SliverGrid.builder(
            gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
              maxCrossAxisExtent: 140,
              mainAxisSpacing: Spacing.spacing2,
              crossAxisSpacing: Spacing.spacing2,
            ),
            itemCount: items.length,
            itemBuilder: (context, index) {
              final item = items[index];
              return InkWell(
                onTap: () => showMediaViewer(
                  context,
                  photos: photos,
                  initialIndex: index,
                  takenAt: item.message.createdAt,
                ),
                child: ClipRRect(
                  borderRadius: Radii.card,
                  child: _Thumbnail(attachment: item.attachment),
                ),
              );
            },
          ),
        ),
        SliverToBoxAdapter(
          child: _LoadOlder(
            hasMoreOlder: hasMoreOlder,
            isLoadingOlder: isLoadingOlder,
            onLoadOlder: onLoadOlder,
          ),
        ),
      ],
    );
  }
}

class _Thumbnail extends StatelessWidget {
  const _Thumbnail({required this.attachment});

  final Attachment attachment;

  @override
  Widget build(BuildContext context) {
    final tokens = JawwidTokens.of(context);
    // The backend mints a thumbnail alongside the full image; falling back to
    // the full one keeps the grid working where it has not.
    final url = attachment.thumbnailUrl ?? attachment.url;

    if (url == null || url.isEmpty) {
      return ColoredBox(color: tokens.colorSurfaceMuted);
    }

    if (attachment.isLocal) {
      return Image.file(File(url), fit: BoxFit.cover);
    }

    return Image.network(
      url,
      fit: BoxFit.cover,
      errorBuilder: (_, _, _) => ColoredBox(color: tokens.colorSurfaceMuted),
    );
  }
}

class _ItemList extends ConsumerWidget {
  const _ItemList({
    required this.items,
    required this.hasMoreOlder,
    required this.isLoadingOlder,
    required this.onLoadOlder,
  });

  final List<_SharedItem> items;
  final bool hasMoreOlder;
  final bool isLoadingOlder;
  final Future<void> Function() onLoadOlder;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (items.isEmpty) {
      return _Empty(
        hasMoreOlder: hasMoreOlder,
        isLoadingOlder: isLoadingOlder,
        onLoadOlder: onLoadOlder,
      );
    }

    final l10n = L10n.of(context);
    final locale = Localizations.localeOf(context).toLanguageTag();

    return ListView.separated(
      itemCount: items.length + 1,
      separatorBuilder: (context, index) => const Divider(height: 1),
      itemBuilder: (context, index) {
        if (index == items.length) {
          return _LoadOlder(
            hasMoreOlder: hasMoreOlder,
            isLoadingOlder: isLoadingOlder,
            onLoadOlder: onLoadOlder,
          );
        }

        final item = items[index];
        final byteSize = item.attachment.byteSize;
        final isVoice = item.attachment.kind == MessageKind.voice;

        final url = item.attachment.url;

        return ListTile(
          leading: Icon(
            isVoice ? Icons.mic_none_outlined : Icons.insert_drive_file_outlined,
          ),
          // Voice notes are played in the conversation, where the player and
          // its position live; a document is handed to the phone. So only one
          // of the two is tappable here, and the other is a record of what was
          // shared rather than a second place to play it.
          onTap: isVoice || url == null
              ? null
              : () => ref.read(attachmentOpenerProvider).open(url),
          title: ContentText(
            item.attachment.fileName?.trim().isNotEmpty == true
                ? item.attachment.fileName!
                : (isVoice ? l10n.attachmentVoiceLabel : l10n.attachmentFileLabel),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
          subtitle: Text(
            [
              RelativeTime.forBubble(item.message.createdAt, locale: locale),
              if (byteSize != null)
                ByteSizeFormat.format(byteSize, l10n, locale: locale),
            ].join(' · '),
          ),
        );
      },
    );
  }
}

/// The "there may be older ones" affordance.
///
/// Shown only when the log says there is more to fetch, so a fully-paged
/// conversation does not end with a button that does nothing.
class _LoadOlder extends StatelessWidget {
  const _LoadOlder({
    required this.hasMoreOlder,
    required this.isLoadingOlder,
    required this.onLoadOlder,
  });

  final bool hasMoreOlder;
  final bool isLoadingOlder;
  final Future<void> Function() onLoadOlder;

  @override
  Widget build(BuildContext context) {
    if (!hasMoreOlder) return const SizedBox(height: Spacing.spacing7);

    return Padding(
      padding: const EdgeInsets.all(Spacing.spacing5),
      child: Center(
        child: isLoadingOlder
            ? const SizedBox.square(
                dimension: 20,
                child: CircularProgressIndicator(strokeWidth: 2),
              )
            : TextButton(
                onPressed: onLoadOlder,
                child: Text(L10n.of(context).mediaLoadOlder),
              ),
      ),
    );
  }
}

class _Empty extends StatelessWidget {
  const _Empty({
    required this.hasMoreOlder,
    required this.isLoadingOlder,
    required this.onLoadOlder,
  });

  final bool hasMoreOlder;
  final bool isLoadingOlder;
  final Future<void> Function() onLoadOlder;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);

    return ListView(
      children: [
        const SizedBox(height: Spacing.spacing9),
        JawwidEmptyView(
          icon: Icons.photo_library_outlined,
          title: l10n.mediaEmpty,
          body: l10n.mediaEmptyBody,
        ),
        _LoadOlder(
          hasMoreOlder: hasMoreOlder,
          isLoadingOlder: isLoadingOlder,
          onLoadOlder: onLoadOlder,
        ),
      ],
    );
  }
}
