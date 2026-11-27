import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Avatar } from '@/shared/components/Avatar'
import { Badge, type Tone } from '@/shared/components/Badge'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import { FilterChips } from '@/shared/components/FilterChips'
import { ReasonDialog } from '@/shared/components/ReasonDialog'
import { RowActions } from '@/shared/components/RowActions'
import { SearchableSelect } from '@/shared/components/SearchableSelect'
import { countWords } from '@/features/instalments/copy'
import { Sheet } from '@/features/profiles/RecordParts'
import { accountKeys, type AccountSummary } from './api'
import { A, useCopy } from './copy'
import { ACTIVE_COUNT, F, describeAccessError } from './familyAccessCopy'
import { GRANT_HOURS, familyAccessApi, familyAccessKeys, type FamilyAccessGrant, type FamilyAccessStatus } from './familyAccessApi'

/** A live grant is where things stand (a teal tag); one that is over is a quiet word. */
const STATUS_TONE: Record<FamilyAccessStatus, Tone> = { active: 'info', ended: 'neutral', revoked: 'outline' }

export function useFamilyAccess() {
  return useQuery({ queryKey: familyAccessKeys.list(), queryFn: () => familyAccessApi.list() })
}

/** A grant changes which parent accounts this caller (or the grantee) may administer. */
function useInvalidatingAccess<V, R>(fn: (v: V) => Promise<R>) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSettled: async () => {
      await client.invalidateQueries({ queryKey: familyAccessKeys.all })
      await client.invalidateQueries({ queryKey: accountKeys.all })
    },
  })
}

/**
 * ADMIN-002: the Operations Manager or the super admin opens ONE family's
 * parent accounts to one Operations staff member -- for a purpose, for a
 * window of at most 7 days. Nobody is notified; everything is recorded.
 */
export function GrantFamilyAccessDialog({
  account,
  grantees,
  onClose,
}: {
  account: AccountSummary
  grantees: Array<{ id: string; name: string }>
  onClose: () => void
}) {
  const tx = useCopy()
  const { t, locale } = useI18n()
  const [granteeId, setGranteeId] = useState('')
  const [hours, setHours] = useState<string>('24')
  const [purpose, setPurpose] = useState('')
  const grant = useInvalidatingAccess(familyAccessApi.grant)
  const trimmed = purpose.trim()
  const ready = account.familyId != null && granteeId !== '' && trimmed !== ''

  return (
    <Dialog
      title={tx(F.grantTitle, { name: account.familyName ?? account.name })}
      onClose={onClose}
      footer={
        <>
          <DialogCancelButton onClick={onClose} />
          <button
            type="button"
            className="btn btn--primary"
            disabled={!ready || grant.isPending}
            onClick={() =>
              grant.mutate(
                { familyId: account.familyId!, granteeId, purpose: trimmed, hours: Number(hours) },
                { onSuccess: onClose },
              )
            }
          >
            {grant.isPending ? t('common.loading') : tx(F.grant)}
          </button>
        </>
      }
    >
      <p>{tx(F.grantExplain)}</p>
      <label className="field">
        <span className="field__label">{tx(F.grantee)}</span>
        <SearchableSelect
          value={granteeId}
          onValueChange={setGranteeId}
          options={grantees.map((g) => ({ value: g.id, label: g.name }))}
          placeholder={tx(F.granteePlaceholder)}
          data-testid="family-access-grantee"
        />
      </label>
      <FilterChips
        label={tx(F.duration)}
        value={hours}
        onChange={setHours}
        options={GRANT_HOURS.map((h) => ({ value: String(h), label: tx(F.hours[h]) }))}
      />
      <label className="field">
        <span className="field__label">{tx(F.purpose)}</span>
        <textarea className="textarea" rows={3} maxLength={500} value={purpose} onChange={(e) => setPurpose(e.target.value)} />
        <span className="field__hint">{tx(F.purposeHint)}</span>
      </label>
      {grant.error != null && (
        <div className="field__error" role="alert">
          {describeAccessError(grant.error).localized(locale)}
        </div>
      )}
    </Dialog>
  )
}

/**
 * The record of exceptional access, on a sheet of its own. A grantor sees the
 * organization's grants (live, and ended in the last 30 days) and may revoke a
 * live one; a grantee sees "Your temporary access" -- what is open to them,
 * and until when. A row is the family and what the access is for, who holds
 * it and who gave it, the day it ends, and where it stands.
 */
export function FamilyAccessRecord() {
  const tx = useCopy()
  const { dateTime, locale } = useI18n()
  const list = useFamilyAccess()
  const [revoking, setRevoking] = useState<FamilyAccessGrant | null>(null)
  const grants = list.data?.grants ?? []
  const canGrant = list.data?.canGrant === true
  // A grantee with nothing open sees nothing: the section is the exception, not a feature to advertise.
  if (!list.data || (!canGrant && grants.length === 0)) return null
  const live = grants.filter((g) => g.status === 'active').length

  return (
    <Sheet
      id="acct-access-title"
      title={tx(canGrant ? F.recordTitle : F.mineTitle)}
      count={live > 0 ? countWords(live, ACTIVE_COUNT, locale) : undefined}
      rule={canGrant ? tx(F.recordHint) : undefined}
    >
      {grants.length === 0 ? (
        <p className="rec-empty">{tx(F.noRecord)}</p>
      ) : (
        <table className="dir-table acct-table acct-grants">
          <thead>
            <tr>
              <th scope="col">{tx(F.family)}</th>
              {canGrant && <th scope="col">{tx(F.grantee)}</th>}
              <th scope="col">{tx(F.grantedBy)}</th>
              <th scope="col">{tx(F.until)}</th>
              <th scope="col">{tx(A.status)}</th>
              {canGrant && (
                <th scope="col" className="cell-actions">
                  <span className="sr-only">{tx(A.actions)}</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {grants.map((g) => (
              <tr key={g.id} className={g.status === 'active' ? 'dir-row' : 'dir-row acct-grant--over'}>
                <td className="dir-cell-who">
                  <span className="dir-who">
                    <Avatar name={g.family.name} seed={g.family.id} />
                    <span className="dir-who__text">
                      <strong className="dir-name">
                        <bdi>{g.family.name}</bdi>
                      </strong>
                      <span className="acct-sub">
                        <bdi>{g.purpose}</bdi>
                      </span>
                    </span>
                  </span>
                </td>
                {canGrant && (
                  <td className="dir-cell-quiet acct-cell-person" data-label={tx(F.grantee)}>
                    <bdi>{g.grantee.name}</bdi>
                  </td>
                )}
                <td className="dir-cell-quiet" data-label={tx(F.grantedBy)}>
                  <bdi>{g.grantedBy.name}</bdi>
                </td>
                <td className="dir-cell-quiet" data-label={tx(F.until)}>
                  <time dateTime={g.revokedAt ?? g.endsAt}>{dateTime(g.revokedAt ?? g.endsAt)}</time>
                </td>
                <td className="dir-cell-state">
                  <Badge tone={STATUS_TONE[g.status]}>{tx(F.status[g.status])}</Badge>
                </td>
                {canGrant && (
                  <td className="cell-actions">
                    {g.status === 'active' && (
                      <RowActions
                        label={tx(A.more, { name: g.family.name })}
                        primary={
                          <button type="button" className="btn btn--sm acct-revoke" onClick={() => setRevoking(g)}>
                            {tx(F.revoke)}
                          </button>
                        }
                      />
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {revoking && <RevokeDialog grant={revoking} onClose={() => setRevoking(null)} />}
    </Sheet>
  )
}

function RevokeDialog({ grant, onClose }: { grant: FamilyAccessGrant; onClose: () => void }) {
  const tx = useCopy()
  const revoke = useInvalidatingAccess((reason: string) => familyAccessApi.revoke(grant.id, reason))
  return (
    <ReasonDialog
      title={tx(F.revokeTitle, { name: grant.grantee.name, family: grant.family.name })}
      label={tx(A.reason)}
      confirmLabel={tx(F.revoke)}
      isPending={revoke.isPending}
      error={revoke.error == null ? undefined : describeAccessError(revoke.error)}
      extra={<p>{tx(F.revokeExplain)}</p>}
      onConfirm={(reason) => revoke.mutate(reason, { onSuccess: onClose })}
      onClose={onClose}
    />
  )
}
