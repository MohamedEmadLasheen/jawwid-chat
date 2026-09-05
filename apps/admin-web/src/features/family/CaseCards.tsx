import { useI18n } from '@/core/i18n/I18nProvider'
import { Badge } from '@/shared/components/Badge'
import type { Case, FamilyCapabilities } from '@/shared/types/domain'

/**
 * Open cases sit above the thread; clicking one filters the thread to it.
 *
 * `owner_locked` is surfaced explicitly. Brief §5: coverage may act on the
 * transactional part of an urgent owner-locked case but may never close it, so
 * the close control is disabled with the reason shown rather than hidden.
 */
export function CaseCards({
  cases,
  activeCaseId,
  capabilities,
  onSelect,
  onResolve,
}: {
  cases: Case[]
  activeCaseId: string | null
  capabilities: FamilyCapabilities
  onSelect: (caseId: string | null) => void
  onResolve: (caseId: string) => void
}) {
  const { t, date } = useI18n()
  const open = cases.filter((item) => item.status !== 'closed' && item.status !== 'resolved')

  if (open.length === 0) return null

  return (
    <div className="panel" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {open.map((item) => {
        const isActive = item.id === activeCaseId
        const blockedByLock = item.owner_locked && !capabilities.can_close_owner_locked

        return (
          <div
            key={item.id}
            className="card"
            style={{
              margin: 0,
              padding: 'var(--space-3)',
              borderColor: isActive ? 'var(--accent)' : undefined,
              minInlineSize: 200,
            }}
          >
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              style={{ padding: 0 }}
              onClick={() => onSelect(isActive ? null : item.id)}
              aria-pressed={isActive}
            >
              <strong>{item.type}</strong>
            </button>

            <div className="row__meta">
              <Badge>{t(`case.status.${item.status}` as const)}</Badge>
              {item.is_blocking && <Badge tone="danger">{t('case.blocking')}</Badge>}
              {item.severity === 'high' && <Badge tone="danger">{item.severity}</Badge>}
              {item.escalation_level > 0 && <Badge tone="danger">escalated</Badge>}
            </div>

            {item.due_at && <div className="row__reason">{t('task.due', { date: date(item.due_at) })}</div>}

            {blockedByLock ? (
              <div className="field__hint">{t('case.ownerLocked')}</div>
            ) : (
              <button
                type="button"
                className="btn btn--sm"
                style={{ marginBlockStart: 8 }}
                onClick={() => onResolve(item.id)}
              >
                {t('case.status.resolved')}
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
