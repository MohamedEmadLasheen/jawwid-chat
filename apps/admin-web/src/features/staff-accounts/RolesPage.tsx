import { useCallback, useId, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useSession } from '@/core/auth/SessionProvider'
import { holdsAny } from '@/core/permissions/capabilities'
import { Avatar } from '@/shared/components/Avatar'
import { Badge } from '@/shared/components/Badge'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import { Icon } from '@/shared/components/Icon'
import { PageHeader } from '@/shared/components/PageHeader'
import { RowActions } from '@/shared/components/RowActions'
import { EmptyState, LoadingState, QueryBoundary } from '@/shared/components/States'
import { ReasonDialog } from '@/shared/components/ReasonDialog'
import { Field } from '@/shared/components/Field'
import { PLURAL, usePlural } from '@/features/admin/copy'
import { A } from '@/features/accounts/copy'
import { Fact } from '@/features/profiles/RecordParts'
import type { AccessRole, PermissionEntry, RoleMaxTier, StaffAccount } from './api'
import { SA, TIER, blockingGrants, describeError, localized, pageLabel, useCopy } from './copy'
import { useAccessRoles, useArchiveRole, useDefineRole, usePermissionCatalogue, useStaffAccounts, useUpdateRole } from './hooks'
import { STAFF_ACCOUNT_KEYS, useAccountsTabs } from './AccountsTabs'
import { ListDetail, Part, rowOpens, useOpenItem, useShown } from './ListDetail'
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
 * A list and the open role's sheet on one screen: the roles as compact rows
 * (name, key, what kind it is, how many hold it), and beside them the open
 * role -- what it is, the highest tier that may hold it, what it opens page by
 * page, and who holds it. The open role is kept in the URL (`?role=`). The
 * editor and the archive reason stay dialogs, opened from the sheet.
 *
 * Not here, and why: a role's department (the API defines org-wide roles
 * only), and per-tier disabling in the checklist (the catalogue does not say
 * which tier may hold a key; the server refuses it on save).
 */
export function RolesPage() {
  const tx = useCopy()
  const { locale, number } = useI18n()
  const plural = usePlural()
  const { staff } = useSession()
  const tabs = useAccountsTabs()
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
  const [openId, open] = useOpenItem('role')
  const shown = useShown(list, (r) => r.id, openId)
  const roleName = (r: AccessRole) => (locale === 'ar' ? r.nameAr : r.nameEn)

  return (
    <div className="page dir sa-page">
      <div className="page__inner">
        <PageHeader
          title={tx(SA.rolesTitle)}
          tabs={tabs ?? undefined}
          actions={
            canDefine && (
              <button type="button" className="btn btn--primary" onClick={() => setPending({ act: 'new' })}>
                <Icon name="plus" size={16} />
                {tx(SA.newRole)}
              </button>
            )
          }
        />
        <QueryBoundary isLoading={roles.isLoading} error={roles.error} onRetry={() => void roles.refetch()}>
          <ListDetail
            openId={openId}
            backLabel={tx(SA.backToRoles)}
            onBack={() => open(null)}
            missing={tx(SA.roleNotInList)}
            list={
              <section className="sheet dir-sheet md-sheet" aria-label={tx(SA.rolesTitle)}>
                {list.length === 0 ? (
                  <EmptyState title={tx(SA.noRolesYet)} compact />
                ) : (
                  <table className="dir-table md-table">
                    <thead>
                      <tr>
                        <th scope="col">{tx(SA.role)}</th>
                        {members && <th scope="col">{tx(SA.members)}</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((r) => {
                        const current = shown?.id === r.id
                        const n = members?.get(r.id) ?? 0
                        return (
                          <tr
                            key={r.id}
                            className={['dir-row', 'md-row', current ? 'md-row--current' : '', r.archived ? 'md-row--past' : ''].filter(Boolean).join(' ')}
                            onClick={rowOpens(() => open(r.id))}
                          >
                            <td className="dir-cell-who">
                              <span className="dir-who__text">
                                <span className="sa-role">
                                  <button type="button" className="sa-name md__open" aria-current={current ? 'true' : undefined} onClick={() => open(r.id)}>
                                    <strong>{roleName(r)}</strong>
                                  </button>
                                  {r.template && <Badge tone="info">{tx(SA.template)}</Badge>}
                                  {r.archived && <Badge tone="neutral">{tx(SA.archived)}</Badge>}
                                  {!canDefine && r.grantable && <Badge tone="ok" dot>{tx(SA.youCanGrant)}</Badge>}
                                </span>
                                <span className="sa-role__key">
                                  {/* The role's key, as the server names it: a small code tag for whoever administers roles. */}
                                  <code className="sa-key" dir="ltr">
                                    {r.key}
                                  </code>
                                </span>
                              </span>
                            </td>
                            {members && (
                              <td className="dir-cell-state">
                                <span className={n > 0 ? 'sa-members' : 'sa-members sa-members--none'}>
                                  <Icon name="teams" size={15} />
                                  <span>{number(n)}</span>
                                  <span className="sr-only">{tx(SA.members)}</span>
                                </span>
                              </td>
                            )}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </section>
            }
            detail={
              shown && (
                <RolePane
                  key={shown.id}
                  role={shown}
                  name={roleName(shown)}
                  catalogue={catalogue.data?.permissions ?? []}
                  holders={members ? (staffList.data?.accounts ?? []).filter((a) => a.roles.some((r) => r.id === shown.id)) : null}
                  holdersLabel={members ? plural(PLURAL.members, members.get(shown.id) ?? 0) : null}
                  canDefine={canDefine}
                  onEdit={() => setPending({ act: 'edit', role: shown })}
                  onArchive={() => setPending({ act: 'archive', role: shown })}
                />
              )
            }
          />
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

/**
 * One role, beside the list: what it is, the highest tier that may hold it,
 * what it opens (the catalogue's labels, page by page, a risk tagged), and
 * who holds it where the viewer sees the staff list. Editing is the stated
 * action; archiving waits behind "more".
 */
function RolePane({
  role: r,
  name,
  catalogue,
  holders,
  holdersLabel,
  canDefine,
  onEdit,
  onArchive,
}: {
  role: AccessRole
  name: string
  catalogue: readonly PermissionEntry[]
  /** Who holds the role; null when this viewer does not see the whole staff list. */
  holders: StaffAccount[] | null
  holdersLabel: string | null
  canDefine: boolean
  onEdit: () => void
  onArchive: () => void
}) {
  const tx = useCopy()
  const { locale, number } = useI18n()
  const id = useId()
  const pages = groupByPage(r.permissions, catalogue)
  return (
    <section className="sheet md-pane" aria-labelledby={`${id}-name`}>
      <header className="md-pane__head">
        <div className="md-pane__who">
          <h2 id={`${id}-name`} className="md-pane__title">
            {name}
          </h2>
          <span className="acct-state">
            <code className="sa-key" dir="ltr">
              {r.key}
            </code>
            {r.template && <Badge tone="info">{tx(SA.template)}</Badge>}
            {r.archived && <Badge tone="neutral">{tx(SA.archived)}</Badge>}
            {!canDefine && r.grantable && <Badge tone="ok" dot>{tx(SA.youCanGrant)}</Badge>}
          </span>
        </div>
        {canDefine && !r.archived && (
          <div className="md-pane__actions">
            <RowActions
              label={tx(A.more, { name })}
              primary={
                <button type="button" className="btn btn--sm" onClick={onEdit}>
                  <Icon name="pencil" size={15} />
                  {tx(SA.edit)}
                </button>
              }
              // Archiving is housekeeping, not a problem: a plain line in the menu, not a red one.
              more={[{ key: 'archive', label: tx(SA.archive), icon: 'archive', onSelect: onArchive }]}
            />
          </div>
        )}
      </header>
      {(r.description || r.template) && (
        <div className="md-pane__note">
          {r.description && (
            <p>
              <bdi>{r.description}</bdi>
            </p>
          )}
          {r.template && <p>{tx(SA.templateHint)}</p>}
        </div>
      )}

      <dl className="rec-facts md-pane__facts">
        <Fact icon="staff" label={tx(SA.maxTier)}>
          {tx(TIER[r.maxTier] ?? { ar: r.maxTier, en: r.maxTier })}
        </Fact>
        {holdersLabel && (
          <Fact icon="teams" label={tx(SA.members)}>
            {holdersLabel}
          </Fact>
        )}
      </dl>

      <Part id={`${id}-perms`} title={tx(SA.checklist)} count={number(r.permissions.length)}>
        <ul className="md-groups">
          {pages.map(({ page, entries }) => (
            <li key={page} className="md-group">
              <span className="md-group__title">{tx(pageLabel(page))}</span>
              <ul className="md-checks">
                {entries.map((p) => (
                  <li key={p.key} className="md-check">
                    <Icon name="check" size={16} />
                    <span className="md-check__text">
                      <span className="md-check__label">
                        <span>{locale === 'ar' ? p.label.ar : p.label.en}</span>
                        <RiskBadge risk={p.risk} />
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </Part>

      {holders && holders.length > 0 && (
        <Part id={`${id}-holders`} title={tx(SA.members)} count={number(holders.length)}>
          <ul className="md-checks md-people">
            {holders.map((a) => (
              <li key={a.staffId} className="md-check">
                <Avatar name={a.name} seed={a.staffId} size="sm" />
                <span className="md-check__text">
                  <Link to={`/accounts/staff?account=${encodeURIComponent(a.staffId)}`} className="md-person">
                    <bdi>{a.name}</bdi>
                  </Link>
                  <span className="md-check__src">{tx(TIER[a.tier] ?? { ar: a.tier, en: a.tier })}</span>
                </span>
              </li>
            ))}
          </ul>
        </Part>
      )}
    </section>
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
