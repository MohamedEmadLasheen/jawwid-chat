import { useCallback, useId, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useSession } from '@/core/auth/SessionProvider'
import { holdsAny, isSuperAdmin } from '@/core/permissions/capabilities'
import { Avatar } from '@/shared/components/Avatar'
import { Badge } from '@/shared/components/Badge'
import { FilterChips } from '@/shared/components/FilterChips'
import { Icon } from '@/shared/components/Icon'
import type { MenuItem } from '@/shared/components/Menu'
import { PageHeader } from '@/shared/components/PageHeader'
import { SearchField } from '@/shared/components/SearchField'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import { ReasonDialog } from '@/shared/components/ReasonDialog'
import { useStructure } from '@/features/organization/hooks'
import { accountKeys, accountsApi } from '@/features/accounts/api'
import { AccountActionDialogs, OneActionAndMore, useAccountActions, type AccountPending } from '@/features/accounts/AccountsPage'
import { A } from '@/features/accounts/copy'
import { Fact } from '@/features/profiles/RecordParts'
import { useWhen } from '@/features/devices/when'
import { roleFitsTier, staffAccountKeys, type AccessRole, type StaffAccount, type StaffAccountRole, type StaffFirstLogin } from './api'
import { NOT_SET_UP, SA, STATUS, TIER, localized, pageLabel, useCopy } from './copy'
import { countWords } from '@/features/instalments/copy'
import type { Deny, HeldKey } from './api'
import { useAccessPreview, useAccessRoles, useAccessView, useDeny, useDenies, useGrantRole, useLiftDeny, useRevokeRole, useSetupCode, useStaffAccount, useStaffAccounts } from './hooks'
import { useAccountsTabs } from './AccountsTabs'
import { ListDetail, Part, rowOpens, useOpenItem, useShown } from './ListDetail'
import { NewStaffAccountDialog } from './NewStaffAccountDialog'
import { StaffCodeSheet } from './StaffCodeSheet'
import { SearchableSelect } from '@/shared/components/SearchableSelect'
import '@/features/accounts/accounts.css'
import './staff-accounts.css'

type StatusFilter = 'all' | 'active' | 'provisioned' | 'suspended'

type Pending =
  | { act: 'new' }
  | { act: 'grant'; account: StaffAccount; role: AccessRole }
  | { act: 'revoke'; account: StaffAccount; role: StaffAccountRole }
  | { act: 'setup'; account: StaffAccount }
  | { act: 'code'; firstLogin: StaffFirstLogin }
  | { act: 'status'; account: StaffAccount; inner: AccountPending }

/**
 * PD-40 PR-5 (plan §8): staff accounts, a tab of the Accounts page, for
 * whoever holds `staff_accounts.view` -- the super admin (every staff account
 * but their own) and a department manager (the specialists of the department
 * they run). The list, every action and every role offered are the server's
 * answers; this page only lays them out.
 *
 * A list and the open account's sheet on one screen: the accounts as compact
 * rows on the start side (who, their tier and department, where the account
 * stands), and beside them the open account -- its facts, its roles, what it
 * can open page by page, and its actions as one button and a "more" menu. The
 * open account is kept in the URL (`?account=`). Every change still asks for
 * its reason in a dialog opened from the sheet.
 *
 * Not here, and why: an account's history (no endpoint reads the staff audit
 * trail yet) and its e-mail (the list does not return it).
 */
export function StaffAccountsPage() {
  const tx = useCopy()
  const { locale, t, number } = useI18n()
  const { staff } = useSession()
  const client = useQueryClient()
  const tabs = useAccountsTabs()
  const list = useStaffAccounts()
  const structure = useStructure()
  const roles = useAccessRoles()
  const [pending, setPending] = useState<Pending | null>(null)
  // Stable: the Dialog re-focuses whenever onClose changes.
  const closeAll = useCallback(() => setPending(null), [])
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [roleFilter, setRoleFilter] = useState('')
  const [departmentFilter, setDepartmentFilter] = useState('')
  const roleFilterId = useId()
  const departmentFilterId = useId()
  const [openId, open] = useOpenItem('account')

  const canCreate = holdsAny(staff, ['staff_accounts.create'])
  const accounts = list.data?.accounts ?? []
  const departments = structure.data?.departments ?? []
  const departmentName = new Map(departments.map((d) => [d.id, d.displayName]))
  const q = query.trim().toLocaleLowerCase()
  // The accounts not set up yet lead the list (a code still waiting first); the rest keep the server's order.
  const setupRank = (a: StaffAccount) => (a.setupPending ? 0 : a.status === 'provisioned' ? 1 : 2)
  const notSetUp = accounts.filter((a) => setupRank(a) < 2).length
  const listed = accounts
    .map((a, i) => [a, i] as const)
    .filter(
      ([a]) =>
        (!q || a.name.toLocaleLowerCase().includes(q)) &&
        (status === 'all' || a.status === status) &&
        (!roleFilter || a.roles.some((r) => r.id === roleFilter)) &&
        (!departmentFilter || a.departmentId === departmentFilter),
    )
    .sort(([a, i], [b, j]) => setupRank(a) - setupRank(b) || i - j)
    .map(([a]) => a)
  const roleName = (r: { nameEn: string; nameAr: string }) => (locale === 'ar' ? r.nameAr : r.nameEn)
  // The open account is read from the whole list: a filter narrows the rows, never what is open.
  const shown = useShown(openId ? accounts : listed, (a) => a.staffId, openId)

  return (
    <div className="page dir sa-page">
      <div className="page__inner">
        <PageHeader
          title={tx(SA.title)}
          tabs={tabs ?? undefined}
          actions={
            canCreate && (
              <button type="button" className="btn btn--primary" onClick={() => setPending({ act: 'new' })}>
                <Icon name="plus" size={16} />
                {tx(SA.newAccount)}
              </button>
            )
          }
        />
        <QueryBoundary isLoading={list.isLoading} error={list.error} onRetry={() => void list.refetch()}>
          <ListDetail
            openId={openId}
            backLabel={tx(SA.backToList)}
            onBack={() => open(null)}
            missing={tx(SA.notInList)}
            list={
              <section className="sheet dir-sheet md-sheet" aria-label={tx(SA.title)}>
                {/* The answer first: how many accounts are not set up yet (they lead the list), or that all are. */}
                {accounts.length > 0 && (
                  <p className={notSetUp > 0 ? 'acct-answer acct-answer--need' : 'acct-answer'}>
                    {notSetUp > 0 ? countWords(notSetUp, NOT_SET_UP, locale) : tx(SA.allSetUp)}
                  </p>
                )}
                <div className="sheet-bar md-bar">
                  <SearchField value={query} onChange={setQuery} label={tx(SA.search)} clearLabel={t('common.cancel')} />
                  <FilterChips
                    label={tx(SA.show)}
                    value={status}
                    onChange={setStatus}
                    formatCount={number}
                    options={(['all', 'active', 'provisioned', 'suspended'] as const).filter((s) => s === 'all' || s === status || accounts.some((a) => a.status === s)).map((s) => ({
                      value: s,
                      label: s === 'all' ? tx(SA.all) : tx(STATUS[s]!),
                      // How many each would show: a "Not set up" that is not empty is seen before it is chosen.
                      count: s === 'all' ? accounts.length : accounts.filter((a) => a.status === s).length,
                    }))}
                  />
                  {((roles.data?.roles.length ?? 0) > 0 || (staff && isSuperAdmin(staff.role) && departments.length > 1)) && (
                    <div className="md-pickers">
                      {(roles.data?.roles.length ?? 0) > 0 && (
                        <label className="md-picker" htmlFor={roleFilterId}>
                          <span className="sr-only">{tx(SA.filterRole)}</span>
                          <SearchableSelect id={roleFilterId} className="select" value={roleFilter} onValueChange={(v) => setRoleFilter(v)}>
                            <option value="">{tx(SA.anyRole)}</option>
                            {roles.data!.roles.map((r) => (
                              <option key={r.id} value={r.id}>
                                {roleName(r)}
                              </option>
                            ))}
                          </SearchableSelect>
                        </label>
                      )}
                      {staff && isSuperAdmin(staff.role) && departments.length > 1 && (
                        <label className="md-picker" htmlFor={departmentFilterId}>
                          <span className="sr-only">{tx(SA.filterDepartment)}</span>
                          <SearchableSelect id={departmentFilterId} className="select" value={departmentFilter} onValueChange={(v) => setDepartmentFilter(v)}>
                            <option value="">{tx(SA.anyDepartment)}</option>
                            {departments.map((d) => (
                              <option key={d.id} value={d.id}>
                                {d.displayName}
                              </option>
                            ))}
                          </SearchableSelect>
                        </label>
                      )}
                    </div>
                  )}
                </div>
                {listed.length === 0 ? (
                  <EmptyState title={tx(SA.empty)} compact />
                ) : (
                  <table className="dir-table md-table">
                    <thead>
                      <tr>
                        <th scope="col">{tx(SA.name)}</th>
                        <th scope="col">{tx(SA.status)}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {listed.map((a) => {
                        const current = shown?.staffId === a.staffId
                        return (
                          <tr key={a.staffId} className={current ? 'dir-row md-row md-row--current' : 'dir-row md-row'} onClick={rowOpens(() => open(a.staffId))}>
                            <td className="dir-cell-who">
                              <span className="dir-who">
                                <Avatar name={a.name} seed={a.staffId} />
                                <span className="dir-who__text">
                                  <button type="button" className="sa-name md__open" aria-current={current ? 'true' : undefined} onClick={() => open(a.staffId)}>
                                    <bdi>{a.name}</bdi>
                                  </button>
                                  <span className="acct-sub">
                                    <span>{tx(TIER[a.tier] ?? { ar: a.tier, en: a.tier })}</span>
                                    {a.departmentId && (
                                      <span>
                                        <bdi>{departmentName.get(a.departmentId) ?? '…'}</bdi>
                                      </span>
                                    )}
                                    {a.roles.map((r) => (
                                      <span key={r.id}>{roleName(r)}</span>
                                    ))}
                                  </span>
                                </span>
                              </span>
                            </td>
                            <td className="dir-cell-state">
                              <StaffState account={a} inList />
                            </td>
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
                <StaffAccountPane
                  key={shown.staffId}
                  account={shown}
                  departmentName={shown.departmentId ? departmentName.get(shown.departmentId) : undefined}
                  onGrant={(account, role) => setPending({ act: 'grant', account, role })}
                  onRevoke={(account, role) => setPending({ act: 'revoke', account, role })}
                  onSetupCode={(account) => setPending({ act: 'setup', account })}
                  onStatus={(account, inner) => setPending({ act: 'status', account, inner })}
                />
              )
            }
          />
        </QueryBoundary>
      </div>

      {pending?.act === 'new' && <NewStaffAccountDialog onClose={closeAll} />}
      {(pending?.act === 'grant' || pending?.act === 'revoke') && (
        <RoleChangeDialog act={pending.act} account={pending.account} role={pending.role} onDone={closeAll} />
      )}
      {pending?.act === 'setup' && (
        <SetupCodeDialog account={pending.account} onIssued={(firstLogin) => setPending({ act: 'code', firstLogin })} onClose={closeAll} />
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
            setPending(null)
          }}
        />
      )}
    </div>
  )
}

/**
 * Where a staff account stands. A first sign-in code still waiting is the
 * one thing to see, and an account not set up waits on someone too (amber
 * words); a suspended or deactivated one is a quiet word. An active one says
 * nothing in the list (`inList`), so the accounts not set up are its only
 * marks; its own sheet names it.
 */
function StaffState({ account: a, inList = false }: { account: StaffAccount; inList?: boolean }) {
  const tx = useCopy()
  const status = tx(STATUS[a.status] ?? { ar: a.status, en: a.status })
  if (inList && a.status === 'active' && !a.setupPending) return null
  return (
    <span className="acct-state">
      {a.setupPending && <Badge tone="waiting">{tx(SA.setupPending)}</Badge>}
      {a.status === 'active' ? (
        <Badge tone="neutral">{status}</Badge>
      ) : (
        // A code still waiting already says the account is not set up.
        !(a.status === 'provisioned' && a.setupPending) && <Badge tone={a.status === 'provisioned' ? 'waiting' : a.status === 'suspended' ? 'neutral' : 'outline'}>{status}</Badge>
      )}
    </span>
  )
}

/**
 * One staff account, beside the list: who it is and where it stands, its
 * actions (one stated, the rest behind "more": a new first sign-in code while
 * it has not signed in, then the PD-21 status actions the server allows on its
 * sign-in, `allowed`), its facts, its roles (granted and removed under H3-H8,
 * the server deciding each) and what it can open.
 */
function StaffAccountPane({
  account: initial,
  departmentName,
  onGrant,
  onRevoke,
  onSetupCode,
  onStatus,
}: {
  account: StaffAccount
  departmentName: string | undefined
  onGrant: (account: StaffAccount, role: AccessRole) => void
  onRevoke: (account: StaffAccount, role: StaffAccountRole) => void
  onSetupCode: (account: StaffAccount) => void
  onStatus: (account: StaffAccount, inner: AccountPending) => void
}) {
  const tx = useCopy()
  const { locale, dateTime, number } = useI18n()
  const { staff } = useSession()
  const navigate = useNavigate()
  const id = useId()
  const pickerId = `${id}-pick`
  const actionsOf = useAccountActions()
  const when = useWhen()
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

  // The stated action is the one the account needs now: a first sign-in code until it has signed in, then the reset.
  const allowed = signIn.data ? actionsOf(signIn.data, (inner) => onStatus(account, inner)) : []
  const profile: MenuItem = { key: 'profile', label: tx(SA.openProfile), icon: 'userCircle', onSelect: () => navigate(`/profile/${encodeURIComponent(account.staffId)}`) }
  const actions: MenuItem[] = [
    ...(canManage && account.status === 'provisioned' && account.accountId !== ''
      ? [{ key: 'setup', label: tx(SA.sendNewCode), icon: 'mail' as const, onSelect: () => onSetupCode(account) }]
      : []),
    ...allowed.filter((a) => !a.danger),
    profile,
    ...allowed.filter((a) => a.danger),
  ]

  return (
    <section className="sheet md-pane" aria-labelledby={`${id}-name`}>
      <header className="md-pane__head">
        <Avatar name={account.name} seed={account.staffId} size="lg" />
        <div className="md-pane__who">
          <h2 id={`${id}-name`} className="md-pane__title">
            <bdi>{account.name}</bdi>
          </h2>
          <StaffState account={account} inList />
        </div>
        <div className="md-pane__actions">
          <OneActionAndMore label={tx(A.more, { name: account.name })} actions={actions} />
        </div>
      </header>
      {account.accountId === '' && <p className="md-pane__note">{tx(SA.noSignIn)}</p>}

      <dl className="rec-facts md-pane__facts">
        <Fact icon="staff" label={tx(SA.tier)}>
          {tx(TIER[account.tier] ?? { ar: account.tier, en: account.tier })}
        </Fact>
        <Fact icon="organization" label={tx(SA.department)}>
          {account.departmentId ? <bdi>{departmentName ?? '…'}</bdi> : <span className="rec-missing">{tx(SA.noDepartment)}</span>}
        </Fact>
        <Fact icon="clock" label={tx(SA.lastLogin)}>
          {account.lastLoginAt ? <time dateTime={account.lastLoginAt} title={dateTime(account.lastLoginAt)}>{when(account.lastLoginAt, { start: true })}</time> : <span className="rec-missing">{tx(SA.never)}</span>}
        </Fact>
      </dl>

      <Part id={`${id}-roles`} title={tx(SA.detailRoles)} count={account.roles.length > 0 ? number(account.roles.length) : undefined}>
        {account.roles.length === 0 ? (
          <p className="md-part__none">{tx(SA.noRoles)}</p>
        ) : (
          <ul className="md-checks">
            {account.roles.map((r) => (
              <li key={r.id} className="md-check">
                <Icon name="checkCircle" size={18} />
                <span className="md-check__text">
                  <span className="md-check__label">
                    <bdi>{roleName(r)}</bdi>
                  </span>
                </span>
                {canManage && (
                  <button type="button" className="btn btn--sm btn--ghost md-check__act" aria-label={tx(SA.removeRole, { role: roleName(r) })} onClick={() => onRevoke(account, r)}>
                    {tx(SA.remove)}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {canManage &&
          (offered.length === 0 ? (
            roles.data && <p className="md-part__none">{tx(SA.noGrantableRoles)}</p>
          ) : (
            <div className="md-grant">
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
      </Part>

      <AccessPanel staffId={account.staffId} accountName={account.name} previewRoleId={chosen?.id ?? null} canManage={canManage} />
    </section>
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
  // Facts in one line are parted by the reader's comma, never by a dot; two sentences by a semicolon.
  const comma = locale === 'ar' ? '، ' : ', '
  const semicolon = locale === 'ar' ? '؛ ' : '; '
  const sourceText = (s: import('./api').KeySource): string => {
    if (s.type === 'super_admin') return tx(SA.srcSuperAdmin)
    if (s.type === 'tier_default') return tx(SA.srcTierDefault)
    const role = locale === 'ar' ? s.nameAr ?? s.roleKey ?? '' : s.nameEn ?? s.roleKey ?? ''
    const base = tx(SA.srcRole, { role })
    return s.grantedBy && s.grantedAt ? `${base}${comma}${tx(SA.srcGranted, { by: s.grantedBy.name ?? '—', at: date(s.grantedAt) })}` : base
  }
  const sourcesOf = (k: HeldKey) => k.sources.map(sourceText)
  const everyKey = view.data?.pages.flatMap((p) => p.keys) ?? []
  const allSame =
    everyKey.length > 1 && everyKey.every((k) => sourcesOf(k).join('\n') === sourcesOf(everyKey[0]!).join('\n'))
      ? tx(SA.allFrom, { source: sourcesOf(everyKey[0]!).join(comma) })
      : null
  return (
    <>
      <Part id={`${id}-access`} title={tx(SA.accessTitle)} hint={tx(SA.accessHint)}>
        {previewRoleId && preview.data && (
          <div className="banner banner--info md-preview" role="status">
            <strong>{tx(SA.grantPreviewTitle)}</strong>{' '}
            {preview.data.gained.length === 0
              ? tx(SA.grantPreviewNothing)
              : [
                  tx(SA.previewGain, { items: preview.data.gained.join(', ') }),
                  preview.data.pagesGained.length ? tx(SA.previewPages, { items: preview.data.pagesGained.join(', ') }) : '',
                ]
                  .filter(Boolean)
                  .join(semicolon)}
          </div>
        )}
        {allSame && <p className="md-part__source">{allSame}</p>}
        {view.isLoading ? null : view.error || !view.data ? null : view.data.pages.length === 0 ? (
          <p className="md-part__none">{tx(SA.accessNone)}</p>
        ) : (
          <ul className="md-groups" aria-label={tx(SA.accessTitle)}>
            {view.data.pages.map((p) => {
              // Where the permissions came from is said once: for the whole account when every one came the same
              // way (above the list), else under a page's name when its own all did, else on each permission.
              const first = p.keys[0] ? sourcesOf(p.keys[0]).join('\n') : ''
              const shared = allSame ? [] : p.keys.length > 0 && p.keys.every((k) => sourcesOf(k).join('\n') === first) ? sourcesOf(p.keys[0]!) : null
              return (
              <li key={p.page} className="md-group">
                <span className="md-group__head">
                  <span className="md-group__title">{tx(pageLabel(p.page))}</span>
                  {shared?.map((s, i) => (
                    <span key={i} className="md-check__src">
                      {s}
                    </span>
                  ))}
                </span>
                <ul className="md-checks">
                  {p.keys.map((k) => (
                    <li key={k.key} className={k.denied ? 'md-check md-check--off' : 'md-check'}>
                      <Icon name={k.denied ? 'prohibit' : 'check'} size={16} />
                      <span className="md-check__text">
                        <span className="md-check__label">
                          {/* The permission's key is for whoever needs it, on hover: the page reads in words. */}
                          <span className={k.denied ? 'md-struck' : undefined} title={k.key}>
                            {label(k.label)}
                          </span>
                          {k.denied && <Badge tone="warn">{tx(SA.restricted)}</Badge>}
                        </span>
                        {!shared &&
                          sourcesOf(k).map((s, i) => (
                            <span key={i} className="md-check__src">
                              {s}
                            </span>
                          ))}
                      </span>
                      {enforced && canManage && k.deniable && !k.denied && (
                        <button type="button" className="btn btn--sm btn--ghost md-check__act" aria-label={tx(SA.restrictTitle, { key: k.key, name: accountName })} onClick={() => setRestricting(k)}>
                          {tx(SA.restrict)}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
              )
            })}
          </ul>
        )}
      </Part>
      {enforced && denies.data && (
        <Part id={`${id}-denies`} title={tx(SA.restrictionsTitle)}>
          {denies.data.denies.length === 0 ? (
            <p className="md-part__none">{tx(SA.restrictionsNone)}</p>
          ) : (
            <ul className="md-checks" aria-label={tx(SA.restrictionsTitle)}>
              {denies.data.denies.map((d) => (
                <li key={d.id} className={d.active ? 'md-check' : 'md-check md-check--past'}>
                  <Icon name="prohibit" size={16} />
                  <span className="md-check__text">
                    <span className="md-check__label">
                      <code className="sa-key" dir="ltr">
                        {d.permissionKey}
                      </code>
                      <Badge tone={d.active ? 'warn' : 'neutral'}>{tx(d.liftedBy ? SA.restrictionLifted : d.active ? SA.restrictionActive : SA.restrictionExpired)}</Badge>
                    </span>
                    <span className="md-check__src">
                      {[
                        d.reason,
                        tx(SA.restrictionBy, { by: d.by.name ?? '—' }),
                        d.permanent ? tx(SA.restrictionPermanentText, { date: date(d.reviewBy ?? d.createdAt) }) : tx(SA.restrictionUntilText, { date: date(d.expiresAt ?? d.createdAt) }),
                      ].join(comma)}
                    </span>
                  </span>
                  {canManage && d.active && (
                    <button type="button" className="btn btn--sm btn--ghost md-check__act" aria-label={tx(SA.liftTitle, { key: d.permissionKey })} onClick={() => setLifting(d)}>
                      {tx(SA.lift)}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Part>
      )}
      {restricting && <RestrictDialog staffId={staffId} accountName={accountName} held={restricting} superAdmin={!!staff && isSuperAdmin(staff.role)} onClose={() => setRestricting(null)} />}
      {lifting && <LiftDialog staffId={staffId} deny={lifting} onClose={() => setLifting(null)} />}
    </>
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
