import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/router.dart';
import '../../../l10n/app_localizations.dart';
import '../data/materials_repository.dart';

/// PD-29: the way into one child's Materials -- from the child's group profile and
/// the parent's own profile (the Library tab), and from a teacher's Student Profile
/// (the Progress map). Who may open it is the server's answer; a build with no
/// materials server offers nothing.
class ChildMaterialsEntry extends ConsumerWidget {
  const ChildMaterialsEntry({super.key, required this.learnerId, this.childName, this.progress = false});

  final String learnerId;
  final String? childName;
  final bool progress;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (ref.watch(materialsRepositoryProvider) is NoMaterialsRepository) return const SizedBox.shrink();
    final l10n = L10n.of(context);
    return ListTile(
      key: ValueKey('materials-entry-$learnerId'),
      leading: Icon(progress ? Icons.auto_stories_outlined : Icons.menu_book_outlined),
      title: Text(progress ? l10n.materialsTabProgress : l10n.materialsTitle),
      subtitle: progress ? null : Text(l10n.materialsEntrySubtitle),
      trailing: const Icon(Icons.chevron_right),
      onTap: () => context.push(Routes.childMaterials(learnerId, progress: progress), extra: childName),
    );
  }
}
