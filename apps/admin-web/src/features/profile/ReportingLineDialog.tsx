import { useId, useState } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import { LoadingState } from '@/shared/components/States'
import type { StaffProfile } from './api'
import { ROLE_LABEL, T, useCopy } from './copy'
import { describeError } from './errors'
import { useOrganization, useSetReportingLine } from './hooks'

/**
 * Super admin only (the button exists only when `canManageReportingLine`, and
 * the server refuses everyone else). Offers only lawful managers -- active
 * managers and the super admin for staff, the super admin alone for a manager
 * -- and the server re-checks the hierarchy whatever is sent.
 */
export function ReportingLineDialog({ profile, refKey, onClose }: { profile: StaffProfile; refKey: string; onClose: () => void }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const ids = { mgr: useId(), reason: useId() }
  const org = useOrganization(true)
  const save = useSetReportingLine(refKey)
  const [manager, setManager] = useState(profile.reportingManager?.staffId ?? '')
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)

  const candidates = (org.data?.directory ?? []).filter(
    (s) =>
      s.isActive &&
      s.staffId !== profile.staffId &&
      (profile.role === 'manager' ? s.role === 'super_admin' : s.role === 'manager' || s.role === 'super_admin'),
  )
  const reasonError = reason.trim() ? null : tx(T.required)

  return (
    <Dialog
      title={tx(T.changeManager)}
      onClose={onClose}
      footer={
        <>
          <DialogCancelButton onClick={onClose} />
          <button
            type="button"
            className="btn btn--primary"
            disabled={save.isPending || org.isLoading}
            onClick={() => {
              setTouched(true)
              if (reasonError) return
              save.mutate({ managerStaffId: manager || null, reason }, { onSuccess: onClose })
            }}
          >
            {save.isPending ? tx(T.saving) : tx(T.save)}
          </button>
        </>
      }
    >
      {org.isLoading ? (
        <LoadingState />
      ) : (
        <>
          <div className="field">
            <label className="field__label" htmlFor={ids.mgr}>{tx(T.manager)}</label>
            <select id={ids.mgr} className="select" value={manager} onChange={(e) => setManager(e.target.value)}>
              <option value="">{tx(T.noneOption)}</option>
              {candidates.map((c) => (
                <option key={c.staffId} value={c.staffId}>
                  {c.displayName} — {tx(ROLE_LABEL[c.role] ?? { en: c.role, ar: c.role })}
                </option>
              ))}
            </select>
            <span className="field__hint">{tx(T.managerHint)}</span>
          </div>
          <div className="field">
            <label className="field__label" htmlFor={ids.reason}>{tx(T.reasonRequired)}</label>
            <input
              id={ids.reason}
              className="input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              aria-invalid={touched && Boolean(reasonError)}
              aria-describedby={`${ids.reason}-err`}
              dir="auto"
            />
            {touched && reasonError && <span id={`${ids.reason}-err`} className="field__error">{reasonError}</span>}
          </div>
        </>
      )}
      {(save.error || org.error) && (
        <div className="banner banner--danger" role="alert">
          {describeError(save.error ?? org.error, locale)}
        </div>
      )}
    </Dialog>
  )
}
