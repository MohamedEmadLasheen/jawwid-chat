import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { staffApi } from '@/core/api/endpoints'
import { qk } from '@/core/api/queryKeys'
import { useI18n } from '@/core/i18n/I18nProvider'
import { WorkloadBadge } from '@/shared/components/Badge'
import { ReasonDialog } from './ReasonDialog'
import { useTransferImpact, useTransferOwnership } from './hooks'

/**
 * Ownership transfer is the highest-impact action in the product and the only
 * path that may change `family.owner_id` (brief §3 invariant).
 *
 * The flow is deliberately slow: pick the new owner, see the impact on them,
 * write a reason, confirm. The impact preview matters because a manager
 * rebalancing load should not discover afterwards that she moved a family onto
 * an already-HIGH admin.
 */
export function TransferOwnershipDialog({
  familyId,
  currentOwnerId,
  onClose,
}: {
  familyId: string
  currentOwnerId: string
  onClose: () => void
}) {
  const { t, number } = useI18n()
  const [toStaffId, setToStaffId] = useState<string | null>(null)

  const staffQuery = useQuery({ queryKey: qk.staff, queryFn: () => staffApi.list() })
  const impact = useTransferImpact(familyId, toStaffId)
  const transfer = useTransferOwnership(familyId)

  // Only permanent owners can receive ownership; coverage is a duty, not a home.
  const candidates = (staffQuery.data ?? []).filter(
    (member) => member.is_active && member.id !== currentOwnerId && member.role === 'admin',
  )

  return (
    <ReasonDialog
      title={t('ownership.transferTitle')}
      label={t('ownership.reason')}
      confirmLabel={t('ownership.confirm')}
      isPending={transfer.isPending}
      error={transfer.error}
      onClose={onClose}
      onConfirm={(reason) => {
        if (!toStaffId) return
        transfer.mutate({ toStaffId, reason }, { onSuccess: onClose })
      }}
      extra={
        <>
          <label className="field">
            <span className="field__label">{t('ownership.newOwner')}</span>
            <select
              className="select"
              value={toStaffId ?? ''}
              onChange={(event) => setToStaffId(event.target.value || null)}
            >
              <option value="">—</option>
              {candidates.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          </label>

          {impact.data && toStaffId && (
            <div className="card" style={{ padding: 'var(--space-3)' }}>
              <div className="kv">
                <span className="kv__k">families</span>
                <span className="kv__v">{number(impact.data.families_affected)}</span>
              </div>
              <div className="kv">
                <span className="kv__k">open cases</span>
                <span className="kv__v">{number(impact.data.open_cases)}</span>
              </div>
              <div className="kv">
                <span className="kv__k">open tasks</span>
                <span className="kv__v">{number(impact.data.open_tasks)}</span>
              </div>
              <div className="kv">
                <span className="kv__k">{t('dashboard.workload')}</span>
                <span className="kv__v">
                  <WorkloadBadge
                    level={impact.data.target_workload_level}
                    score={impact.data.target_workload_score}
                  />
                </span>
              </div>
            </div>
          )}
        </>
      }
    />
  )
}
