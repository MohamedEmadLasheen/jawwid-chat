import { useCallback, useId, useMemo, useState } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useSession } from '@/core/auth/SessionProvider'
import { holdsAny } from '@/core/permissions/capabilities'
import { Badge } from '@/shared/components/Badge'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import { PageHeader } from '@/shared/components/PageHeader'
import { LoadingState, QueryBoundary } from '@/shared/components/States'
import { ReasonDialog } from '@/shared/components/ReasonDialog'
import { Field } from '@/shared/components/Field'
import type { AccessRole, PermissionEntry, RoleMaxTier, StaffAccount } from './api'
import { SA, TIER, blockingGrants, describeError, localized, pageLabel, useCopy } from './copy'
import { useAccessRoles, useArchiveRole, useDefineRole, usePermissionCatalogue, useStaffAccounts, useUpdateRole } from './hooks'
import { AccountsTabs, STAFF_ACCOUNT_KEYS } from './AccountsTabs'
import { RiskBadge, groupByPage } from './NewStaffAccountDialog'
import { SearchableSelect } from '@/shared/components/SearchableSelect'
import '@/features/accounts/accounts.css'
import './staff-accounts.css'

const MAX_TIERS: RoleMaxTier[] = ['specialist', 'supervisor', 'manager']

type Pending = { act: 'new' } | { act: 'edit'; role: AccessRole } | { act: 'archive'; role: AccessRole }

/**
 * PD-40 PR-5 (plan §8): access roles, a tab of the Accounts page. Anyone
 * holding `staff_accounts.view` reads them (a manager sees which they may
 * grant); only `access_roles.manage` -- the super admin (H7, S4) -- defines,
 * edits and archives them. "Template" is the server's flag, shown only while
 * it says so.
 *
 * Not here, and why: a role's department (the API defines org-wide roles
 * only), and per-tier disabling in the checklist (the catalogue does not say
 * which tier may hold a key; the server refuses it on save).
 */
export function RolesPage() {
  const tx = useCopy()
  const { locale } = useI18n()
  const { staff } = useSession()
  const roles = useAccessRoles()
  const catalogue = usePermissionCatalogue()
  const canDefine = holdsAny(staff, ['access_roles.manage'])
  // Members are counted from the staff list, which is whole only for the super admin.
  const staffList = useStaffAccounts(canDefine && holdsAny(staff, STAFF_ACCOUNT_KEYS))
  const [pending, setPending] = useState<Pending | null>(null)
  // Stable: the Dialog re-focuses whenever onClose changes.
  const closeAll = useCallback(() => setPending(null), [])
  const list = roles.data?.roles ?? []
  const members = useMemo(() => countMembers(staffList.data?.accounts), [staffList.data])
  const label = useMemo(() => new Map((catalogue.data?.permissions ?? []).map((p) => [p.key, p.label])), [catalogue.data])

  return (
    <div className="page">
      <div className="page__inner">
        <AccountsTabs />
        <PageHeader
          title={tx(SA.rolesTitle)}
          subtitle={tx(SA.rolesSubtitle)}
          actions={
            canDefine && (
              <button type="button" className="btn btn--primary" onClick={() => setPending({ act: 'new' })}>
                {tx(SA.newRole)}
              </button>
            )
          }
        />
        <QueryBoundary
          isLoading={roles.isLoading}
          error={roles.error}
          isEmpty={list.length === 0}
          emptyTitle={tx(SA.noRolesYet)}
          onRetry={() => void roles.refetch()}
        >
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{tx(SA.role)}</th>
                  <th scope="col">{tx(SA.maxTier)}</th>
                  <th scope="col">{tx(SA.permissions)}</th>
                  {members && <th scope="col">{tx(SA.members)}</th>}
                  {canDefine && <th scope="col">{tx(SA.actions)}</th>}
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <div dir="auto">
                        <strong>{locale === 'ar' ? r.nameAr : r.nameEn}</strong>{' '}
                        {r.template && <Badge tone="info">{tx(SA.template)}</Badge>}{' '}
                        {r.archived && <Badge tone="neutral">{tx(SA.archived)}</Badge>}{' '}
                        {!canDefine && r.grantable && <Badge tone="ok">{tx(SA.youCanGrant)}</Badge>}
                      </div>
                      <div className="field__hint" dir="ltr">
                        {r.key}
                      </div>
                      {r.template && <div className="field__hint">{tx(SA.templateHint)}</div>}
                      {r.description && (
                        <div className="field__hint" dir="auto">
                          {r.description}
                        </div>
                      )}
                    </td>
                    <td>{tx(TIER[r.maxTier] ?? { ar: r.maxTier, en: r.maxTier })}</td>
                    <td>
                      <span className="sa-chips">
                        {r.permissions.map((k) => {
                          const l = label.get(k)
                          return (
                            <Badge key={k} tone="outline">
                              {l ? (locale === 'ar' ? l.ar : l.en) : k}
                            </Badge>
                          )
                        })}
                      </span>
                    </td>
                    {members && <td>{members.get(r.id) ?? 0}</td>}
                    {canDefine && (
                      <td>
                        {!r.archived && (
                          <div className="acct-actions">
                            <button type="button" className="btn btn--sm" onClick={() => setPending({ act: 'edit', role: r })}>
                              {tx(SA.edit)}
                            </button>
                            <button type="button" className="btn btn--sm btn--danger" onClick={() => setPending({ act: 'archive', role: r })}>
                              {tx(SA.archive)}
                            </button>
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </QueryBoundary>
      </div>

      {(pending?.act === 'new' || pending?.act === 'edit') && (
        <RoleEditorDialog
          role={pending.act === 'edit' ? pending.role : null}
          staff={staffList.data?.accounts ?? []}
          onClose={closeAll}
        />
      )}
      {pending?.act === 'archive' && <ArchiveRoleDialog role={pending.role} onClose={() => setPending(null)} />}
    </div>
  )
}

function countMembers(accounts: StaffAccount[] | undefined): Map<string, number> | null {
  if (!accounts) return null
  const out = new Map<string, number>()
  for (const a of accounts) for (const r of a.roles) out.set(r.id, (out.get(r.id) ?? 0) + 1)
  return out
}

/**
 * Define (one step: plan §13 S4) or edit a role. The checklist is the
 * catalogue grouped by page, without the keys that never go in a role
 * (`inRoles: false`); risky keys carry a red badge, and a key only the super
 * admin may grant says so. A refused edit that would hand managers' grantees
 * more than those managers may grant names the grants that block it.
 */
function RoleEditorDialog({ role, staff, onClose }: { role: AccessRole | null; staff: StaffAccount[]; onClose: () => void }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const catalogue = usePermissionCatalogue()
  const define = useDefineRole()
  const update = useUpdateRole()
  const mutation = role ? update : define
  const tierId = useId()
  const reasonId = useId()
  const [form, setForm] = useState({
    key: '',
    nameAr: role?.nameAr ?? '',
    nameEn: role?.nameEn ?? '',
    description: role?.description ?? '',
  })
  const [maxTier, setMaxTier] = useState<RoleMaxTier>('specialist')
  const [keys, setKeys] = useState<Set<string>>(() => new Set(role?.permissions ?? []))
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }))
  const missing = (v: string) => (touched && !v.trim() ? tx(SA.required) : null)
  // Stable across keystrokes: the Dialog re-focuses whenever onClose changes.
  const { isPending } = mutation
  const close = useCallback(() => {
    if (!isPending) onClose()
  }, [isPending, onClose])

  const offered = (catalogue.data?.permissions ?? []).filter((p) => p.inRoles)
  const pages = groupByPage(
    offered.map((p) => p.key),
    offered,
  )
  // A key the role holds that the checklist does not offer (retired, or barred
  // from roles) is shown checked and locked, and sent back unchanged: the
  // server validates it (review of #239). Nothing is dropped silently.
  const offeredKeys = new Set(offered.map((p) => p.key))
  const locked = catalogue.data ? (role?.permissions ?? []).filter((k) => !offeredKeys.has(k)) : []
  const chosen = [...new Set([...[...keys].filter((k) => offeredKeys.has(k)), ...locked])].sort()

  const toggle = (key: string, on: boolean) =>
    setKeys((prev) => {
      const next = new Set(prev)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })

  const submit = () => {
    setTouched(true)
    if ((!role && !form.key.trim()) || !form.nameAr.trim() || !form.nameEn.trim() || chosen.length === 0 || !reason.trim()) return
    const description = form.description.trim()
    const common = {
      nameEn: form.nameEn.trim(),
      nameAr: form.nameAr.trim(),
      ...(description ? { description } : {}),
      permissions: chosen,
      reason: reason.trim(),
    }
    if (role) update.mutate({ roleId: role.id, body: common }, { onSuccess: onClose })
    else define.mutate({ key: form.key.trim(), maxTier, ...common }, { onSuccess: onClose })
  }

  return (
    <Dialog
      title={role ? tx(SA.editTitle, { role: locale === 'ar' ? role.nameAr : role.nameEn }) : tx(SA.newRole)}
      onClose={close}
      variant="sheet"
      footer={
        <>
          <DialogCancelButton onClick={close} disabled={mutation.isPending} />
          <button type="button" className="btn btn--primary" disabled={mutation.isPending} onClick={submit}>
            {mutation.isPending ? tx(SA.saving) : tx(SA.save)}
          </button>
        </>
      }
    >
      {!role && (
        <>
          <Field label={tx(SA.roleKey)} value={form.key} onChange={set('key')} error={missing(form.key)} />
          <p className="field__hint">{tx(SA.roleKeyHint)}</p>
        </>
      )}
      <Field label={tx(SA.nameAr)} value={form.nameAr} onChange={set('nameAr')} error={missing(form.nameAr)} />
      <Field label={tx(SA.nameEn)} value={form.nameEn} onChange={set('nameEn')} error={missing(form.nameEn)} />
      <Field label={tx(SA.descriptionOptional)} value={form.description} onChange={set('description')} />
      {!role && (
        <div className="field">
          <label className="field__label" htmlFor={tierId}>
            {tx(SA.maxTier)}
          </label>
          <SearchableSelect id={tierId} className="input" value={maxTier} onValueChange={(v) => setMaxTier(v as RoleMaxTier)}>
            {MAX_TIERS.map((t) => (
              <option key={t} value={t}>
                {tx(TIER[t]!)}
              </option>
            ))}
          </SearchableSelect>
        </div>
      )}

      <h3 className="sa-section__title">{tx(SA.checklist)}</h3>
      <p className="field__hint">{tx(SA.checklistHint)}</p>
      {catalogue.isLoading ? (
        <LoadingState compact />
      ) : (
        <div className="sa-checklist">
          {pages.map(({ page, entries }) => (
            <fieldset key={page}>
              <legend>{tx(pageLabel(page))}</legend>
              {entries.map((p) => (
                <ChecklistItem key={p.key} entry={p} checked={keys.has(p.key)} onChange={(on) => toggle(p.key, on)} />
              ))}
            </fieldset>
          ))}
          {locked.length > 0 && (
            <fieldset>
              <legend>{tx(SA.notInChecklist)}</legend>
              <p className="field__hint">{tx(SA.notInChecklistHint)}</p>
              {locked.map((k) => (
                <label key={k}>
                  <input type="checkbox" checked disabled readOnly />
                  <span dir="ltr">{k}</span>
                </label>
              ))}
            </fieldset>
          )}
        </div>
      )}
      {touched && chosen.length === 0 && <p className="field__error">{tx(SA.atLeastOne)}</p>}

      <div className="field">
        <label className="field__label" htmlFor={reasonId}>
          {tx(SA.reason)}
        </label>
        <textarea id={reasonId} className="textarea" rows={2} dir="auto" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        {missing(reason) && <span className="field__error">{missing(reason)}</span>}
      </div>
      <RoleRefusal error={mutation.error} staff={staff} />
    </Dialog>
  )
}

function ChecklistItem({ entry, checked, onChange }: { entry: PermissionEntry; checked: boolean; onChange: (on: boolean) => void }) {
  const tx = useCopy()
  const { locale } = useI18n()
  return (
    <label>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{locale === 'ar' ? entry.label.ar : entry.label.en}</span>
      <RiskBadge risk={entry.risk} />
      {!entry.delegable && <Badge tone="outline">{tx(SA.superAdminGrants)}</Badge>}
    </label>
  )
}

/** ACCESS_ROLE_CONFLICT as names (from the staff list) where the caller sees them; any other refusal in plain words. */
function RoleRefusal({ error, staff }: { error: unknown; staff: StaffAccount[] }) {
  const tx = useCopy()
  const { locale } = useI18n()
  if (error == null) return null
  const grants = blockingGrants(error)
  if (!grants) {
    return (
      <div className="banner banner--danger" role="alert">
        {describeError(error, locale)}
      </div>
    )
  }
  const name = new Map(staff.map((s) => [s.staffId, s.name]))
  return (
    <div className="banner banner--danger" role="alert">
      <p>{tx(SA.conflictLead)}</p>
      <ul>
        {grants.map((g) => (
          <li key={`${g.staffId}:${g.grantedBy}`} dir="auto">
            {tx(SA.grantedBy, { name: name.get(g.staffId) ?? g.staffId, by: name.get(g.grantedBy) ?? g.grantedBy })}
          </li>
        ))}
      </ul>
    </div>
  )
}

function ArchiveRoleDialog({ role, onClose }: { role: AccessRole; onClose: () => void }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const archive = useArchiveRole()
  return (
    <ReasonDialog
      title={tx(SA.archiveTitle, { role: locale === 'ar' ? role.nameAr : role.nameEn })}
      label={tx(SA.reason)}
      confirmLabel={tx(SA.archive)}
      isPending={archive.isPending}
      error={localized(archive.error)}
      extra={<p>{tx(SA.archiveExplain)}</p>}
      onConfirm={(reason) => archive.mutate({ roleId: role.id, reason }, { onSuccess: onClose })}
      onClose={onClose}
    />
  )
}
