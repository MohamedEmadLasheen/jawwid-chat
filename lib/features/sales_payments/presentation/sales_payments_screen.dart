import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/router.dart';
import '../../../core/errors/app_error.dart';
import '../../../core/errors/error_presenter.dart';
import '../../../design/tokens.dart';
import '../../../design/widgets/jawwid_avatar.dart';
import '../../../design/widgets/state_views.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/utils/text_direction.dart';
import '../application/sales_payments_providers.dart';
import '../domain/sales_billing.dart';

/// PD-20: Sales' Payments tab -- find a family by a parent's (or the family's) name.
///
/// Each result is a name, the family and how many children it has; nothing else about a
/// parent is held. Tapping one opens that family's instalments.
class SalesPaymentsScreen extends ConsumerStatefulWidget {
  const SalesPaymentsScreen({super.key});

  /// How long typing must pause before the search is sent.
  static const debounce = Duration(milliseconds: 350);

  @override
  ConsumerState<SalesPaymentsScreen> createState() => _SalesPaymentsScreenState();
}

class _SalesPaymentsScreenState extends ConsumerState<SalesPaymentsScreen> {
  final _controller = TextEditingController();
  Timer? _debounce;

  /// The query actually sent; '' lists the first page.
  String _query = '';

  @override
  void dispose() {
    _debounce?.cancel();
    _controller.dispose();
    super.dispose();
  }

  void _onChanged(String value) {
    _debounce?.cancel();
    _debounce = Timer(SalesPaymentsScreen.debounce, () {
      if (!mounted) return;
      final next = value.trim();
      if (next != _query) setState(() => _query = next);
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final state = ref.watch(parentSearchProvider(_query));

    return Scaffold(
      appBar: AppBar(title: Text(l10n.tabPayments)),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: Spacing.spacing4, vertical: Spacing.spacing2),
            child: TextField(
              key: const ValueKey('sales-payments-search'),
              controller: _controller,
              onChanged: _onChanged,
              textInputAction: TextInputAction.search,
              decoration: InputDecoration(
                prefixIcon: const Icon(Icons.search),
                hintText: l10n.salesSearchHint,
                border: const OutlineInputBorder(),
                isDense: true,
              ),
            ),
          ),
          Expanded(
            child: state.when(
              skipLoadingOnRefresh: true,
              loading: () => const JawwidLoadingView(),
              error: (error, _) => _SearchError(error: error, onRetry: () => ref.invalidate(parentSearchProvider(_query))),
              data: (result) => _Results(result: result, onRefresh: () => ref.refresh(parentSearchProvider(_query).future)),
            ),
          ),
        ],
      ),
    );
  }
}

class _Results extends StatelessWidget {
  const _Results({required this.result, required this.onRefresh});

  final ParentSearchResult result;
  final Future<Object?> Function() onRefresh;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final tokens = JawwidTokens.of(context);

    if (result.items.isEmpty) {
      return JawwidEmptyView(icon: Icons.person_search_outlined, title: l10n.salesSearchEmpty);
    }

    return RefreshIndicator(
      onRefresh: () => onRefresh().then((_) {}, onError: (_) {}),
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
          for (final hit in result.items)
            ListTile(
              key: ValueKey('sales-parent-${hit.id}'),
              leading: JawwidAvatar(displayName: hit.name, imageUrl: hit.avatarUrl),
              title: ContentText(hit.name, maxLines: 1, overflow: TextOverflow.ellipsis),
              subtitle: ContentText(
                '${hit.familyName} · ${l10n.salesChildrenCount(hit.childrenCount)}',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: theme.textTheme.bodySmall?.copyWith(color: tokens.colorTextSecondary),
              ),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => context.push(Routes.salesFamilyBilling(hit.familyId), extra: hit.familyName),
            ),
          if (result.truncated)
            Padding(
              padding: const EdgeInsets.all(Spacing.spacing5),
              child: Text(
                l10n.salesSearchTruncated,
                textAlign: TextAlign.center,
                style: theme.textTheme.bodySmall?.copyWith(color: tokens.colorTextSecondary),
              ),
            ),
        ],
      ),
    );
  }
}

class _SearchError extends StatelessWidget {
  const _SearchError({required this.error, required this.onRetry});

  final Object error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final appError = asAppErrorOf(error);
    if (appError.kind == AppErrorKind.forbidden) {
      return JawwidEmptyView(icon: Icons.lock_outline, title: l10n.salesPaymentsDenied);
    }
    final message = ErrorPresenter.present(appError, l10n);
    return JawwidErrorView(
      title: message.title,
      body: message.body,
      retryLabel: message.canRetry ? l10n.retryAction : null,
      onRetry: message.canRetry ? onRetry : null,
    );
  }
}
