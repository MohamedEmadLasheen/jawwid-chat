import { useCallback, useId, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useSession } from '@/core/auth/SessionProvider'
import { holdsAny, isSuperAdmin } from '@/core/permissions/capabilities'
import { Avatar } from '@/shared/components/Avatar'
import { Badge, type Tone } from '@/shared/components/Badge'
import { Dialog } from '@/shared/components/Dialog'
import { FilterChips } from '@/shared/components/FilterChips'
import { PageHeader } from '@/shared/components/PageHeader'
import { QueryBoundary } from '@/shared/components/States'
import { ReasonDialog } from '@/shared/components/ReasonDialog'
import { useStructure } from '@/features/organization/hooks'
import { accountKeys, accountsApi } from '@/features/accounts/api'
import { AccountActionButtons, AccountActionDialogs, type AccountPending } from '@/features/accounts/AccountsPage'
import { roleFitsTier, staffAccountKeys, type AccessRole, type StaffAccount, type StaffAccountRole, type StaffFirstLogin } from './api'
import { SA, STATUS, TIER, localized, useCopy } from './copy'
import type { Deny, HeldKey } from './api'
import { useAccessPreview, useAccessRoles, useAccessView, useDeny, useDenies, useGrantRole, useLiftDeny, useRevokeRole, useSetupCode, useStaffAccount, useStaffAccounts } from './hooks'
import { AccountsTabs } from './AccountsTabs'
import { NewStaffAccountDialog } from './NewStaffAccountDialog'
import { StaffCodeSheet } from './StaffCodeSheet'
import { SearchableSelect } from '@/shared/components/SearchableSelect'
import '@/features/accounts/accounts.css'
import './staff-accounts.css'

type StatusFilter = 'all' | 'active' | 'provisioned' | 'suspended'

type Pending =
  | { act: 'new' }
  | { act: 'detail'; account: StaffAccount }
  | { act: 'grant'; account: StaffAccount; role: AccessRole }
  | { act: 'revoke'; account: StaffAccount; role: StaffAccountRole }
  | { act: 'setup'; account: StaffAccount }
  | { act: 'code'; firstLogin: StaffFirstLogin }
  | { act: 'status'; account: StaffAccount; inner: AccountPending }

const STATUS_TONE: Record<string, Tone> = {
  provisioned: 'outline',
  active: 'ok',
  suspended: 'danger',
  deactivated: 'neutral',
}

/**
 * PD-40 PR-5 (plan §8): staff accounts, a tab of the Accounts page, for
 * whoever holds `staff_accounts.view` -- the super admin (every staff account
 * but their own) and a department manager (the specialists of the department
 * they run). The list, every action and every role offered are the server's
 * answers; this page only lays them out.
 *
 * Not here, and why: an account's history (no endpoint reads the staff audit
 * trail yet) and its e-mail (the list does not return it).
 */
export function StaffAccountsPage() {
  const tx = useCopy()
  const { locale, dateTime } = useI18n()
  const { staff } = useSession()
  const client = useQueryClient()
  const list = useStaffAccounts()
  const structure = useStructure()
  const roles = useAccessRoles()
  const [pending, setPending] = useState<Pending | null>(null)
  // Stable: the Dialog re-focuses whenever onClose changes.
  const closeAll = useCallback(() => setPending(null), [])
  const [status, setStatus] = useState<StatusFilter>('all')
  const [roleFilter, setRoleFilter] = useState('')
  const [departmentFilter, setDepartmentFilter] = useState('')
  const roleFilterId = useId()
  const departmentFilterId = useId()

  const canCreate = holdsAny(staff, ['staff_accounts.create'])
  const accounts = list.data?.accounts ?? []
  const departments = structure.data?.departments ?? []
  const departmentName = new Map(departments.map((d) => [d.id, d.displayName]))
  const shown = accounts.filter(
    (a) =>
      (status === 'all' || a.status === status) &&
      (!roleFilter || a.roles.some((r) => r.id === roleFilter)) &&
      (!departmentFilter || a.departmentId === departmentFilter),
  )
  const roleName = (r: { nameEn: string; nameAr: string }) => (locale === 'ar' ? r.nameAr : r.nameEn)
  const back = (account: StaffAccount) => setPending({ act: 'detail', account })

  return (
    <div className="page pp pp-list sa-page">
      <div className="page__inner">
        <AccountsTabs />
        <PageHeader
          title={tx(SA.title)}
          subtitle={tx(SA.subtitle)}
          actions={
            canCreate && (
              <button type="button" className="btn btn--primary" onClick={() => setPending({ act: 'new' })}>
                {tx(SA.newAccount)}
              </button>
            )
          }
        />
        <div className="pp-tools sa-filters">
          <FilterChips
            label={tx(SA.show)}
            value={status}
            onChange={setStatus}
            options={(['all', 'active', 'provisioned', 'suspended'] as const).map((s) => ({
              value: s,
              label: s === 'all' ? tx(SA.all) : tx(STATUS[s]!),
            }))}
          />
          {(roles.data?.roles.length ?? 0) > 0 && (
            <div className="field">
              <label className="field__label" htmlFor={roleFilterId}>
                {tx(SA.filterRole)}
              </label>
              <SearchableSelect id={roleFilterId} className="input" value={roleFilter} onValueChange={(v) => setRoleFilter(v)}>
                <option value="">{tx(SA.anyRole)}</option>
                {roles.data!.roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {roleName(r)}
                  </option>
                ))}
              </SearchableSelect>
            </div>
          )}
          {staff && isSuperAdmin(staff.role) && departments.length > 1 && (
            <div className="field">
              <label className="field__label" htmlFor={departmentFilterId}>
                {tx(SA.filterDepartment)}
              </label>
              <SearchableSelect id={departmentFilterId} className="input" value={departmentFilter} onValueChange={(v) => setDepartmentFilter(v)}>
                <option value="">{tx(SA.anyDepartment)}</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.displayName}
                  </option>
                ))}
              </SearchableSelect>
            </div>
          )}
        </div>
        <QueryBoundary
          isLoading={list.isLoading}
          error={list.error}
          isEmpty={shown.length === 0}
          emptyTitle={tx(SA.empty)}
          onRetry={() => void list.refetch()}
        >
          <div className="table-wrap">
            <table className="table pp-stack">
              <thead>
                <tr>
                  <th scope="col">{tx(SA.name)}</th>
                  <th scope="col">{tx(SA.department)}</th>
                  <th scope="col">{tx(SA.tier)}</th>
                  <th scope="col">{tx(SA.roles)}</th>
                  <th scope="col">{tx(SA.status)}</th>
                  <th scope="col">{tx(SA.lastLogin)}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((a) => (
                  <tr key={a.staffId}>
                    <td>
                      <span className="pp-cell-two">
                        <Avatar name={a.name} seed={a.staffId} size="sm" />
                        <button type="button" className="sa-name" onClick={() => setPending({ act: 'detail', account: a })}>
                          <bdi>{a.name}</bdi>
                        </button>
                      </span>
                    </td>
                    <td data-label={tx(SA.department)}>{a.departmentId ? <bdi>{departmentName.get(a.departmentId) ?? '…'}</bdi> : '—'}</td>
                    <td data-label={tx(SA.tier)}>{tx(TIER[a.tier] ?? { ar: a.tier, en: a.tier })}</td>
                    <td data-label={tx(SA.roles)} data-wide="">
                      {a.roles.length === 0 ? (
                        <span className="field__hint">{tx(SA.noRoles)}</span>
                      ) : (
                        <span className="sa-chips">
                          {a.roles.map((r) => (
                            <Badge key={r.id} tone="outline">
                              {roleName(r)}
                            </Badge>
                          ))}
                        </span>
                      )}
                    </td>
                    <td data-at="end">
                      <Badge tone={STATUS_TONE[a.status] ?? 'neutral'} dot>
                        {tx(STATUS[a.status] ?? { ar: a.status, en: a.status })}
                      </Badge>{' '}
                      {a.setupPending && <Badge tone="warn">{tx(SA.setupPending)}</Badge>}
                    </td>
                    <td data-label={tx(SA.lastLogin)}>{a.lastLoginAt ? dateTime(a.lastLoginAt) : tx(SA.never)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </QueryBoundary>
      </div>

      {pending?.act === 'new' && <NewStaffAccountDialog onClose={closeAll} />}
      {pending?.act === 'detail' && (
        <StaffAccountSheet
          account={pending.account}
          departmentName={pending.account.departmentId ? departmentName.get(pending.account.departmentId) : undefined}
          onGrant={(account, role) => setPending({ act: 'grant', account, role })}
          onRevoke={(account, role) => setPending({ act: 'revoke', account, role })}
          onSetupCode={(account) => setPending({ act: 'setup', account })}
          onStatus={(account, inner) => setPending({ act: 'status', account, inner })}
          onClose={closeAll}
        />
      )}
      {(pending?.act === 'grant' || pending?.act === 'revoke') && (
        <RoleChangeDialog
          act={pending.act}
          account={pending.account}
          role={pending.role}
          onDone={() => back(pending.account)}
        />
      )}
      {pending?.act === 'setup' && (
        <SetupCodeDialog
          account={pending.account}
          onIssued={(firstLogin) => setPending({ act: 'code', firstLogin })}
          onClose={() => back(pending.account)}
        />
      )}
      {pending?.act === 'code' && <StaffCodeSheet signIn={null} firstLogin={pending.firstLogin} onClose={closeAll} />}
      {pending?.act === 'status' && (
        <AccountActionDialogs
          pending={pending.inner}
          onChange={(inner) => {
            if (inner) {
              setPending({ act: 'status', account: pending.account, inner })
              return
            }
            // A status action may have changed the account: read it again.
            void client.invalidateQueries({ queryKey: staffAccountKeys.all })
            back(pending.account)
          }}
        />
      )}
    </div>
  )
}

/**
 * One staff account: its roles (granted and removed under H3-H8, the server
 * deciding each), a new first sign-in code while it has not signed in, and the
 * PD-21 status actions the server allows on its sign-in (`allowed`).
 */
function StaffAccountSheet({
  account: initial,
  departmentName,
  onGrant,
  onRevoke,
  onSetupCode,
  onStatus,
  onClose,
}: {
  account: StaffAccount
  departmentName: string | undefined
  onGrant: (account: StaffAccount, role: AccessRole) => void
  onRevoke: (account: StaffAccount, role: StaffAccountRole) => void
  onSetupCode: (account: StaffAccount) => void
  onStatus: (account: StaffAccount, inner: AccountPending) => void
  onClose: () => void
}) {
  const tx = useCopy()
  const { locale, dateTime } = useI18n()
  const { staff } = useSession()
  const pickerId = useId()
  const [choice, setChoice] = useState('')
  const one = useStaffAccount(initial.staffId)
  const account = one.data ?? initial
  const roles = useAccessRoles()
  const signIn = useQuery({
    queryKey: accountKeys.one(account.accountId),
    queryFn: () => accountsApi.get(account.accountId),
    enabled: account.accountId !== '',
  })
  const canManage = holdsAny(staff, ['staff_accounts.manage'])
  const held = new Set(account.roles.map((r) => r.id))
  const offered = (roles.data?.roles ?? []).filter((r) => r.grantable && !r.archived && !held.has(r.id) && roleFitsTier(r.maxTier, account.tier))
  const chosen = offered.find((r) => r.id === choice) ?? null
  const roleName = (r: { nameEn: string; nameAr: string }) => (locale === 'ar' ? r.nameAr : r.nameEn)

  return (
    <Dialog title={account.name} onClose={onClose} variant="sheet">
      <dl className="sa-fixed">
        <dt>{tx(SA.tier)}</dt>
        <dd>{tx(TIER[account.tier] ?? { ar: account.tier, en: account.tier })}</dd>
        <dt>{tx(SA.department)}</dt>
        <dd dir="auto">{account.departmentId ? (departmentName ?? '…') : '—'}</dd>
        <dt>{tx(SA.status)}</dt>
        <dd>
          {tx(STATUS[account.status] ?? { ar: account.status, en: account.status })}
          {account.setupPending && (
            <>
              {' '}
              <Badge tone="warn">{tx(SA.setupPending)}</Badge>
            </>
          )}
        </dd>
        <dt>{tx(SA.lastLogin)}</dt>
        <dd>{account.lastLoginAt ? dateTime(account.lastLoginAt) : tx(SA.never)}</dd>
      </dl>

      <section className="sa-section" aria-labelledby={`${pickerId}-roles`}>
        <h3 id={`${pickerId}-roles`} className="sa-section__title">
          {tx(SA.detailRoles)}
        </h3>
        {account.roles.length === 0 ? (
          <p className="field__hint">{tx(SA.noRoles)}</p>
        ) : (
          <ul className="sa-held">
            {account.roles.map((r) => (
              <li key={r.id}>
                <span dir="auto">{roleName(r)}</span>
                {canManage && (
                  <button
                    type="button"
                    className="btn btn--sm"
                    aria-label={tx(SA.removeRole, { role: roleName(r) })}
                    onClick={() => onRevoke(account, r)}
                  >
                    {tx(SA.remove)}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {canManage &&
          (offered.length === 0 ? (
            roles.data && <p className="field__hint">{tx(SA.noGrantableRoles)}</p>
          ) : (
            <div className="sa-grant">
              <div className="field">
                <label className="field__label" htmlFor={pickerId}>
                  {tx(SA.addRole)}
                </label>
                <SearchableSelect id={pickerId} className="input" value={choice} onValueChange={(v) => setChoice(v)}>
                  <option value="">{tx(SA.chooseRole)}</option>
                  {offered.map((r) => (
                    <option key={r.id} value={r.id}>
                      {roleName(r)}
                    </option>
                  ))}
                </SearchableSelect>
              </div>
              <button type="button" className="btn" disabled={!chosen} onClick={() => chosen && onGrant(account, chosen)}>
                {tx(SA.grant)}
              </button>
            </div>
          ))}
      </section>

      <AccessPanel staffId={account.staffId} accountName={account.name} previewRoleId={chosen?.id ?? null} canManage={canManage} />

      <section className="sa-section" aria-labelledby={`${pickerId}-account`}>
        <h3 id={`${pickerId}-account`} className="sa-section__title">
          {tx(SA.detailActions)}
        </h3>
        {account.accountId === '' ? (
          <p className="field__hint">{tx(SA.noSignIn)}</p>
        ) : (
          <>
            {canManage && account.status === 'provisioned' && (
              <p>
                <button type="button" className="btn btn--sm" onClick={() => onSetupCode(account)}>
                  {tx(SA.sendNewCode)}
                </button>
              </p>
            )}
            {signIn.data && <AccountActionButtons account={signIn.data} onAct={(inner) => onStatus(account, inner)} />}
          </>
        )}
      </section>
    </Dialog>
  )
}

function RoleChangeDialog({
  act,
  account,
  role,
  onDone,
}: {
  act: 'grant' | 'revoke'
  account: StaffAccount
  role: { id: string; nameEn: string; nameAr: string }
  onDone: () => void
}) {
  const tx = useCopy()
  const { locale } = useI18n()
  const grant = useGrantRole()
  const revoke = useRevokeRole()
  const mutation = act === 'grant' ? grant : revoke
  const name = locale === 'ar' ? role.nameAr : role.nameEn
  return (
    <ReasonDialog
      title={tx(act === 'grant' ? SA.grantTitle : SA.revokeTitle, { role: name, name: account.name })}
      label={tx(SA.reason)}
      confirmLabel={tx(act === 'grant' ? SA.grant : SA.remove)}
      isPending={mutation.isPending}
      error={localized(mutation.error)}
      extra={<p>{tx(act === 'grant' ? SA.grantExplain : SA.revokeExplain, { name: account.name })}</p>}
      onConfirm={(reason) => mutation.mutate({ staffId: account.staffId, roleId: role.id, reason }, { onSuccess: onDone })}
      onClose={onDone}
    />
  )
}

function SetupCodeDialog({
  account,
  onIssued,
  onClose,
}: {
  account: StaffAccount
  onIssued: (firstLogin: StaffFirstLogin) => void
  onClose: () => void
}) {
  const tx = useCopy()
  const issue = useSetupCode()
  return (
    <ReasonDialog
      title={tx(SA.setupTitle, { name: account.name })}
      label={tx(SA.reason)}
      confirmLabel={tx(SA.sendCode)}
      isPending={issue.isPending}
      error={localized(issue.error)}
      extra={<p>{tx(SA.setupExplain)}</p>}
      onConfirm={(reason) => issue.mutate({ staffId: account.staffId, reason }, { onSuccess: (r) => onIssued(r.firstLogin) })}
      onClose={onClose}
    />
  )
}


/**
 * Access management M1: the effective access of one account, read-only: each page, the actions held in it (the module's
 * own permission keys, labelled from the catalogue) and where each one came from. When an administrator picks a role to
 * grant, what it would add is shown before they confirm. The server decides every grant again.
 */
function AccessPanel({ staffId, accountName, previewRoleId, canManage }: { staffId: string; accountName: string; previewRoleId: string | null; canManage: boolean }) {
  const tx = useCopy()
  const { locale, date } = useI18n()
  const id = useId()
  const view = useAccessView(staffId)
  const preview = useAccessPreview(staffId, previewRoleId)
  const denies = useDenies(staffId)
  const { staff } = useSession()
  // Restrictions are offered only where the database enforces them (production: not yet), so a restriction is never recorded and then ignored.
  const enforced = denies.data?.enforced === true
  const [restricting, setRestricting] = useState<HeldKey | null>(null)
  const [lifting, setLifting] = useState<Deny | null>(null)
  const label = (l: { en: string; ar: string }) => (locale === 'ar' ? l.ar : l.en)
  const sourceText = (s: import('./api').KeySource): string => {
    if (s.type === 'super_admin') return tx(SA.srcSuperAdmin)
    if (s.type === 'tier_default') return tx(SA.srcTierDefault)
    const role = locale === 'ar' ? s.nameAr ?? s.roleKey ?? '' : s.nameEn ?? s.roleKey ?? ''
    const base = tx(SA.srcRole, { role })
    return s.grantedBy && s.grantedAt ? `${base} · ${tx(SA.srcGranted, { by: s.grantedBy.name ?? '—', at: date(s.grantedAt) })}` : base
  }
  return (
    <section className="sa-section" aria-labelledby={`${id}-access`}>
      <h3 id={`${id}-access`} className="sa-section__title">
        {tx(SA.accessTitle)}
      </h3>
      <p className="field__hint">{tx(SA.accessHint)}</p>
      {previewRoleId && preview.data && (
        <div className="banner banner--info" role="status">
          <strong>{tx(SA.grantPreviewTitle)}</strong>{' '}
          {preview.data.gained.length === 0
            ? tx(SA.grantPreviewNothing)
            : [
                tx(SA.previewGain, { items: preview.data.gained.join(', ') }),
                preview.data.pagesGained.length ? tx(SA.previewPages, { items: preview.data.pagesGained.join(', ') }) : '',
              ]
                .filter(Boolean)
                .join(' · ')}
        </div>
      )}
      {view.isLoading ? null : view.error || !view.data ? null : view.data.pages.length === 0 ? (
        <p className="field__hint">{tx(SA.accessNone)}</p>
      ) : (
        <ul className="sa-held" aria-label={tx(SA.accessTitle)}>
          {view.data.pages.map((p) => (
            <li key={p.page}>
              <strong dir="ltr">{p.page}</strong>
              <ul>
                {p.keys.map((k) => (
                  <li key={k.key}>
                    <span dir="auto" style={k.denied ? { textDecoration: 'line-through' } : undefined}>{label(k.label)}</span> <code dir="ltr">{k.key}</code>
                    {k.denied && (
                      <>
                        {' '}
                        <Badge tone="warn">{tx(SA.restricted)}</Badge>
                      </>
                    )}
                    <span className="field__hint"> — {k.sources.map(sourceText).join(' · ')}</span>
                    {enforced && canManage && k.deniable && !k.denied && (
                      <>
                        {' '}
                        <button type="button" className="btn btn--sm" aria-label={tx(SA.restrictTitle, { key: k.key, name: accountName })} onClick={() => setRestricting(k)}>
                          {tx(SA.restrict)}
                        </button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      {enforced && denies.data && (
        <>
          <h4 className="sa-section__title">{tx(SA.restrictionsTitle)}</h4>
          {denies.data.denies.length === 0 ? (
            <p className="field__hint">{tx(SA.restrictionsNone)}</p>
          ) : (
            <ul className="sa-held" aria-label={tx(SA.restrictionsTitle)}>
              {denies.data.denies.map((d) => (
                <li key={d.id}>
                  <code dir="ltr">{d.permissionKey}</code>{' '}
                  <Badge tone={d.active ? 'warn' : 'neutral'}>{tx(d.liftedBy ? SA.restrictionLifted : d.active ? SA.restrictionActive : SA.restrictionExpired)}</Badge>
                  <span className="field__hint">
                    {' '}
                    — {d.reason} · {tx(SA.restrictionBy, { by: d.by.name ?? '—' })} ·{' '}
                    {d.permanent ? tx(SA.restrictionPermanentText, { date: date(d.reviewBy ?? d.createdAt) }) : tx(SA.restrictionUntilText, { date: date(d.expiresAt ?? d.createdAt) })}
                  </span>
                  {canManage && d.active && (
                    <>
                      {' '}
                      <button type="button" className="btn btn--sm" aria-label={tx(SA.liftTitle, { key: d.permissionKey })} onClick={() => setLifting(d)}>
                        {tx(SA.lift)}
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {restricting && <RestrictDialog staffId={staffId} accountName={accountName} held={restricting} superAdmin={!!staff && isSuperAdmin(staff.role)} onClose={() => setRestricting(null)} />}
      {lifting && <LiftDialog staffId={staffId} deny={lifting} onClose={() => setLifting(null)} />}
    </section>
  )
}

/** Restrict one permission: a reason, and when it ends (a super admin may instead make it permanent, with a review date). The server decides who may. */
function RestrictDialog({ staffId, accountName, held, superAdmin, onClose }: { staffId: string; accountName: string; held: HeldKey; superAdmin: boolean; onClose: () => void }) {
  const tx = useCopy()
  const mutation = useDeny()
  const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)
  const [until, setUntil] = useState(inDays(14))
  const [permanent, setPermanent] = useState(false)
  const [review, setReview] = useState(inDays(90))
  const dayEnd = (d: string) => new Date(`${d}T23:59:59`).toISOString()
  return (
    <ReasonDialog
      title={tx(SA.restrictTitle, { key: held.key, name: accountName })}
      label={tx(SA.reason)}
      confirmLabel={tx(SA.restrict)}
      isPending={mutation.isPending}
      error={localized(mutation.error)}
      extra={
        <>
          <p>{tx(SA.restrictExplain)}</p>
          {!permanent && (
            <label className="field">
              <span className="field__label">{tx(SA.restrictUntil)}</span>
              <input className="input" type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
            </label>
          )}
          {superAdmin && (
            <label className="field">
              <input type="checkbox" checked={permanent} onChange={(e) => setPermanent(e.target.checked)} /> {tx(SA.restrictPermanent)}
            </label>
          )}
          {permanent && (
            <label className="field">
              <span className="field__label">{tx(SA.restrictReview)}</span>
              <input className="input" type="date" value={review} onChange={(e) => setReview(e.target.value)} />
            </label>
          )}
        </>
      }
      onConfirm={(reason) =>
        mutation.mutate(
          { staffId, body: { permissionKey: held.key, reason, ...(permanent ? { permanent: true, reviewBy: dayEnd(review) } : { expiresAt: dayEnd(until) }) } },
          { onSuccess: onClose },
        )
      }
      onClose={onClose}
    />
  )
}

function LiftDialog({ staffId, deny, onClose }: { staffId: string; deny: Deny; onClose: () => void }) {
  const tx = useCopy()
  const mutation = useLiftDeny()
  return (
    <ReasonDialog
      title={tx(SA.liftTitle, { key: deny.permissionKey })}
      label={tx(SA.reason)}
      confirmLabel={tx(SA.lift)}
      isPending={mutation.isPending}
      error={localized(mutation.error)}
      onConfirm={(reason) => mutation.mutate({ staffId, denyId: deny.id, reason }, { onSuccess: onClose })}
      onClose={onClose}
    />
  )
}
