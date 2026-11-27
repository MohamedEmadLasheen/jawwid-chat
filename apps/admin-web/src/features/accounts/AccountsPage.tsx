import { Fragment, useDeferredValue, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useSession } from '@/core/auth/SessionProvider'
import { isSuperAdmin } from '@/core/permissions/capabilities'
import { Avatar } from '@/shared/components/Avatar'
import { Badge } from '@/shared/components/Badge'
import { Dialog } from '@/shared/components/Dialog'
import { FilterChips } from '@/shared/components/FilterChips'
import { Icon } from '@/shared/components/Icon'
import type { MenuItem } from '@/shared/components/Menu'
import { PageHeader } from '@/shared/components/PageHeader'
import { RowActions } from '@/shared/components/RowActions'
import { SearchField } from '@/shared/components/SearchField'
import { QueryBoundary } from '@/shared/components/States'
import { ReasonDialog } from '@/shared/components/ReasonDialog'
import { ApiError } from '@/core/api/errors'
import { countWords } from '@/features/instalments/copy'
import { Sheet } from '@/features/profiles/RecordParts'
import type { AccountSummary, IssuedReset } from './api'
import { A, ACCOUNTS_COUNT, KIND, NEED_HAND, STATUS, describeError, useCopy } from './copy'
import { useAccounts, useIssueReset, useReactivate, useSuspend } from './hooks'
import { supportAdminApi, supportKeys, supportTokens, type SupportSession } from '@/features/support/api'
import { ACTIONS_RECORDED, MINUTES, S, describeError as describeSupportError } from '@/features/support/copy'
import { fill } from '@/features/profiles/RecordHead'
import { accountSessionsApi, sessionKeys, type SessionDto } from '@/features/devices/api'
import { D, isSessionGone } from '@/features/devices/copy'
import { SessionList, useDeviceName } from '@/features/devices/SessionList'
import { useWhen } from '@/features/devices/when'
import '@/features/devices/devices.css'
import { useAccountsTabs } from '@/features/staff-accounts/AccountsTabs'
import { FamilyAccessRecord, GrantFamilyAccessDialog, useFamilyAccess } from './FamilyAccess'
import { F } from './familyAccessCopy'
import './accounts.css'

type Kind = 'all' | 'family' | 'teacher' | 'staff'
/** One account action in progress: the dialog it shows. PD-40: the Staff accounts page reuses them. */
export type AccountPending =
  | { act: 'reset'; account: AccountSummary }
  | { act: 'suspend'; account: AccountSummary }
  | { act: 'reactivate'; account: AccountSummary }
  | { act: 'code'; account: AccountSummary; issued: IssuedReset }
  | { act: 'impersonate'; account: AccountSummary }
  | { act: 'devices'; account: AccountSummary; notice?: string }
  | { act: 'revokeSession'; account: AccountSummary; session: SessionDto }
  | { act: 'revokeAll'; account: AccountSummary }

/**
 * PD-21: account administration. Staff find a parent (by the parent's, the
 * family's or a child's name) or a teacher, and reset the password or set the
 * account inactive; the super admin also other staff. PD-40: which kinds is
 * the server's answer (`administers`) -- parents for Operations and Sales,
 * teachers for the Teachers department. The server decides the list and every
 * action; the chips and the row's actions follow its answer, which is advisory.
 *
 * One sheet of people with one action each: the masthead carries the area's
 * tabs, the sheet its own search and kinds, and a row says who the account
 * belongs to, where it stands, and offers the reset beside a "more" menu.
 * Two records follow on sheets of their own: support sessions and exceptional
 * access.
 */
export function AccountsPage({ eyebrow }: { eyebrow?: string }) {
  const tx = useCopy()
  const { t, dateTime, locale } = useI18n()
  const { staff } = useSession()
  const tabs = useAccountsTabs()
  const [q, setQ] = useState('')
  const [kind, setKind] = useState<Kind>('all')
  const [pending, setPending] = useState<AccountPending | null>(null)
  const [granting, setGranting] = useState<AccountSummary | null>(null)
  // ADMIN-002: a grantor (the Operations Manager, the super admin) may open one family to one Operations staff member.
  const access = useFamilyAccess()
  const grantees = access.data?.canGrant === true ? (access.data.grantees ?? []) : null
  const deferred = useDeferredValue(q.trim())
  const list = useAccounts(deferred, kind)
  const accounts = needFirst(list.data?.accounts ?? [])
  const actionsOf = useAccountActions()
  const when = useWhen()

  const administers = list.data?.administers
  const fallback: Kind[] = staff && isSuperAdmin(staff.role) ? ['family', 'teacher', 'staff'] : ['family', 'teacher']
  const kinds: Kind[] = ['all', ...(administers ?? fallback)]
  const noneAdministered = administers !== undefined && administers.length === 0
  // One kind in the list (an Operations desk sees parents only): the kind is not said on every row.
  const oneKind = kinds.length <= 2 || kind !== 'all'
  const needing = accounts.filter(needsHand).length

  return (
    <div className="page dir acct-page">
      <div className="page__inner">
        <PageHeader eyebrow={eyebrow} title={tx(A.title)} tabs={tabs ?? undefined} />
        <LiveSupportStrip />
        <section className="sheet dir-sheet acct-sheet" aria-label={tx(A.title)}>
          {/* The answer first: how many sign-ins need a hand in this list, or that none does. */}
          {list.data && accounts.length > 0 && (
            <p className={needing > 0 ? 'acct-answer acct-answer--need' : 'acct-answer'}>
              {needing > 0 ? countWords(needing, NEED_HAND, locale) : tx(A.noneNeedHand)}
            </p>
          )}
          <div className="sheet-bar">
            <SearchField value={q} onChange={setQ} label={tx(A.search)} clearLabel={t('common.cancel')} />
            <FilterChips
              label={tx(A.show)}
              value={kind}
              onChange={setKind}
              options={kinds.map((k) => ({ value: k, label: k === 'all' ? tx(A.all) : tx(KIND[k]) }))}
            />
            {list.data && accounts.length > 0 && !list.data.truncated && (
              <span className="dir-count">{countWords(accounts.length, ACCOUNTS_COUNT, locale)}</span>
            )}
          </div>
          <QueryBoundary
            isLoading={list.isLoading}
            error={list.error}
            isEmpty={accounts.length === 0}
            emptyTitle={tx(noneAdministered ? A.noneAdministered : A.empty)}
            onRetry={() => void list.refetch()}
          >
            <table className="dir-table acct-table">
              <thead>
                <tr>
                  <th scope="col">{tx(A.person)}</th>
                  <th scope="col">{tx(A.lastLogin)}</th>
                  <th scope="col" className="cell-actions">
                    <span className="sr-only">{tx(A.actions)}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.accountId} className="dir-row">
                    <td className="dir-cell-who">
                      <span className="dir-who">
                        <Avatar name={a.name} seed={a.accountId} />
                        <span className="dir-who__text">
                          {/* Where the account stands is said beside the name, and only when it is not the usual. */}
                          <span className="acct-name-line">
                            <strong className="dir-name">
                              <bdi>{a.name}</bdi>
                            </strong>
                            <AccountState account={a} />
                          </span>
                          {/* One line: who the account is, then the children by name (a search may have found the family by one). */}
                          <span className="acct-sub" title={a.children.length > 0 ? a.children.join(locale === 'ar' ? '، ' : ', ') : undefined}>
                            {/* The kind is said only where the list holds more than one kind. */}
                            {!oneKind && <span>{tx(KIND[a.kind])}</span>}
                            {a.familyName && (
                              <span>
                                <bdi>{a.familyName}</bdi>
                              </span>
                            )}
                            {a.children.length > 0 && <ChildNames names={a.children} />}
                          </span>
                        </span>
                      </span>
                    </td>
                    <td className={a.lastLoginAt ? 'dir-cell-quiet' : 'dir-cell-quiet dir-cell-quiet--none'} data-label={tx(A.lastLogin)}>
                      {a.lastLoginAt ? <time dateTime={a.lastLoginAt} title={dateTime(a.lastLoginAt)}>{when(a.lastLoginAt, { start: true })}</time> : <span className="dir-none">{tx(A.never)}</span>}
                    </td>
                    <td className="cell-actions">
                      <OneActionAndMore
                        label={tx(A.more, { name: a.name })}
                        actions={actionsOf(a, setPending, grantees && a.kind === 'family' && a.familyId ? () => setGranting(a) : undefined)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {list.data?.truncated && <p className="dir-foot dir-foot--note">{tx(A.truncated)}</p>}
          </QueryBoundary>
        </section>
        <SupportRecord />
        <FamilyAccessRecord />
      </div>

      <AccountActionDialogs pending={pending} onChange={setPending} />
      {granting && grantees && (
        <GrantFamilyAccessDialog account={granting} grantees={grantees} onClose={() => setGranting(null)} />
      )}
    </div>
  )
}

/** How many children a row names before it says how many more. */
const CHILDREN_NAMED = 3

/**
 * A family's children by name: each name isolated in its own direction, parted
 * by the reader's comma, so an Arabic reader meets them in order; past the
 * first few, how many more (the whole list is the row's title).
 */
function ChildNames({ names }: { names: string[] }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const comma = locale === 'ar' ? '، ' : ', '
  const shown = names.slice(0, CHILDREN_NAMED)
  return (
    <span className="acct-children">
      {tx(A.childrenLabel)}{' '}
      {shown.map((n, i) => (
        <Fragment key={i}>
          {i > 0 && comma}
          <bdi className="acct-child">{n}</bdi>
        </Fragment>
      ))}
      {names.length > shown.length && <>{comma}{tx(A.moreChildren, { n: names.length - shown.length })}</>}
    </span>
  )
}

/** Whether any account in the list needs a hand: locked out, no password yet, or set inactive. */
const needsHand = (a: AccountSummary) => !!a.lockedUntil || !a.hasLogin || a.status !== 'active'

/**
 * The accounts whose sign-in needs a hand come first, in the server's order
 * within each: locked out, then no password yet; the rest keep their place.
 */
function needFirst(accounts: AccountSummary[]): AccountSummary[] {
  const need = (a: AccountSummary) => (a.lockedUntil ? 0 : !a.hasLogin ? 1 : 2)
  return accounts
    .map((a, i) => [a, i] as const)
    .sort(([a, i], [b, j]) => need(a) - need(b) || i - j)
    .map(([a]) => a)
}

/**
 * Where an account stands, as tags, and only when it is not the usual: an
 * active account that signs in says nothing, so the few that need someone are
 * the only marks in the list. A lock is the urgent tag, a missing password an
 * amber word, an account set inactive or deactivated a quiet word.
 */
export function AccountState({ account: a }: { account: AccountSummary }) {
  const tx = useCopy()
  if (a.status === 'active' && !a.lockedUntil && a.hasLogin) return null
  return (
    <span className="acct-state">
      {a.lockedUntil && <Badge tone="danger">{tx(A.locked)}</Badge>}
      {!a.hasLogin && <Badge tone="waiting">{tx(A.noLogin)}</Badge>}
      {a.status !== 'active' && <Badge tone={a.status === 'suspended' ? 'neutral' : 'outline'}>{tx(STATUS[a.status])}</Badge>}
    </span>
  )
}

/**
 * The actions the server allows on an account (`allowed`), in the order a row
 * offers them: the reset first (the everyday one), then its devices, a
 * temporary access to its family where the page may grant one, opening it as
 * the person, and last the two that change whether the person can sign in.
 */
export function useAccountActions() {
  const tx = useCopy()
  return (a: AccountSummary, onAct: (p: AccountPending) => void, onGrant?: () => void): MenuItem[] => [
    ...(a.allowed.resetPassword ? [{ key: 'reset', label: tx(A.resetPassword), icon: 'password' as const, onSelect: () => onAct({ act: 'reset', account: a }) }] : []),
    ...(a.allowed.signOut === true ? [{ key: 'devices', label: tx(D.devicesButton), icon: 'device' as const, onSelect: () => onAct({ act: 'devices', account: a }) }] : []),
    ...(onGrant ? [{ key: 'grant', label: tx(F.grantButton), icon: 'hourglass' as const, onSelect: onGrant }] : []),
    ...(a.allowed.impersonate ? [{ key: 'impersonate', label: tx(S.open, { name: a.name }), icon: 'headset' as const, onSelect: () => onAct({ act: 'impersonate', account: a }) }] : []),
    ...(a.allowed.reactivate ? [{ key: 'reactivate', label: tx(A.reactivate), icon: 'undo' as const, onSelect: () => onAct({ act: 'reactivate', account: a }) }] : []),
    ...(a.allowed.suspend ? [{ key: 'suspend', label: tx(A.suspend), icon: 'prohibit' as const, danger: true, onSelect: () => onAct({ act: 'suspend', account: a }) }] : []),
  ]
}

/** The first action stated as the row's one button, the rest behind "more". No action, nothing drawn. */
export function OneActionAndMore({ actions, label }: { actions: MenuItem[]; label: string }) {
  const [first, ...rest] = actions
  if (!first) return null
  return (
    <RowActions
      label={label}
      primary={
        <button type="button" className="btn btn--sm" onClick={first.onSelect}>
          {first.label}
        </button>
      }
      more={rest}
    />
  )
}

/** The dialog of the action in progress, if any; `onChange(null)` closes it. */
export function AccountActionDialogs({
  pending,
  onChange,
}: {
  pending: AccountPending | null
  onChange: (p: AccountPending | null) => void
}) {
  return (
    <>
      {pending?.act === 'reset' && (
        <ResetDialog
          account={pending.account}
          onIssued={(issued) => onChange({ act: 'code', account: pending.account, issued })}
          onClose={() => onChange(null)}
        />
      )}
      {pending?.act === 'code' && (
        <CodeDialog account={pending.account} issued={pending.issued} onClose={() => onChange(null)} />
      )}
      {pending?.act === 'impersonate' && <StartSupportDialog account={pending.account} onClose={() => onChange(null)} />}
      {pending?.act === 'devices' && (
        <DevicesDialog
          account={pending.account}
          notice={pending.notice}
          onRevoke={(session) => onChange({ act: 'revokeSession', account: pending.account, session })}
          onRevokeAll={() => onChange({ act: 'revokeAll', account: pending.account })}
          onClose={() => onChange(null)}
        />
      )}
      {(pending?.act === 'revokeSession' || pending?.act === 'revokeAll') && (
        <RevokeSessionDialog
          account={pending.account}
          session={pending.act === 'revokeSession' ? pending.session : null}
          onDone={(notice) => onChange({ act: 'devices', account: pending.account, notice })}
          onClose={() => onChange({ act: 'devices', account: pending.account })}
        />
      )}
      {(pending?.act === 'suspend' || pending?.act === 'reactivate') && (
        <StatusDialog act={pending.act} account={pending.account} onClose={() => onChange(null)} />
      )}
    </>
  )
}

function ResetDialog({
  account,
  onIssued,
  onClose,
}: {
  account: AccountSummary
  onIssued: (issued: IssuedReset) => void
  onClose: () => void
}) {
  const tx = useCopy()
  const issue = useIssueReset()
  const [signOut, setSignOut] = useState(false)
  return (
    <ReasonDialog
      title={tx(A.resetTitle, { name: account.name })}
      label={tx(A.reason)}
      confirmLabel={tx(A.issue)}
      isPending={issue.isPending}
      error={localized(issue.error)}
      extra={
        <>
          <p>{tx(A.resetExplain, { name: account.name })}</p>
          <label className="acct-check">
            <input type="checkbox" checked={signOut} onChange={(e) => setSignOut(e.target.checked)} />
            <span>{tx(A.signOutEverywhere)}</span>
          </label>
        </>
      }
      onConfirm={(reason) =>
        issue.mutate({ id: account.accountId, reason, signOutEverywhere: signOut }, { onSuccess: onIssued })
      }
      onClose={onClose}
    />
  )
}

/**
 * The code exists only in this dialog's props: closing it is the end of it.
 * PD-40 PR-3: a code a department manager issues for a staff account is
 * e-mailed only and never returned -- the dialog says where it went (or that
 * it could not go), and shows no code box.
 */
function CodeDialog({ account, issued, onClose }: { account: AccountSummary; issued: IssuedReset; onClose: () => void }) {
  const tx = useCopy()
  const [copied, setCopied] = useState(false)
  const code = issued.code
  return (
    <Dialog
      title={tx(A.codeTitle, { name: account.name })}
      onClose={onClose}
      footer={
        <>
          {code && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                void navigator.clipboard?.writeText(code).then(() => setCopied(true), () => undefined)
              }}
            >
              {copied ? tx(A.copied) : tx(A.copy)}
            </button>
          )}
          <button type="button" className="btn btn--primary" onClick={onClose}>
            {tx(A.done)}
          </button>
        </>
      }
    >
      {code ? (
        <>
          <p>{tx(A.codeExplain, { name: account.name, minutes: issued.expiresInMinutes })}</p>
          <p className="acct-code" dir="ltr" aria-label={code.split('').join(' ')}>
            {code}
          </p>
          <p className="field__hint">{tx(A.codeHow)}</p>
        </>
      ) : (
        <p role="status">
          {issued.emailed === true ? tx(A.codeEmailed, { minutes: issued.expiresInMinutes }) : tx(A.codeNotEmailed)}
        </p>
      )}
      {issued.signedOutSessions > 0 && <p className="field__hint">{tx(A.signedOut, { n: issued.signedOutSessions })}</p>}
    </Dialog>
  )
}

function StatusDialog({
  act,
  account,
  onClose,
}: {
  act: 'suspend' | 'reactivate'
  account: AccountSummary
  onClose: () => void
}) {
  const tx = useCopy()
  const suspend = useSuspend()
  const reactivate = useReactivate()
  const mutation = act === 'suspend' ? suspend : reactivate
  return (
    <ReasonDialog
      title={tx(act === 'suspend' ? A.suspendTitle : A.reactivateTitle, { name: account.name })}
      label={tx(A.reason)}
      confirmLabel={tx(act === 'suspend' ? A.suspend : A.reactivate)}
      isPending={mutation.isPending}
      error={localized(mutation.error)}
      extra={<p>{tx(act === 'suspend' ? A.suspendExplain : A.reactivateExplain, { name: account.name })}</p>}
      onConfirm={(reason) => mutation.mutate({ id: account.accountId, reason }, { onSuccess: onClose })}
      onClose={onClose}
    />
  )
}

/**
 * PD-23: the account's active devices. Shown only where the server's
 * `allowed.signOut` says this administrator may end them; every revoke is
 * decided again server-side and needs a reason.
 */
function DevicesDialog({
  account,
  notice,
  onRevoke,
  onRevokeAll,
  onClose,
}: {
  account: AccountSummary
  notice?: string
  onRevoke: (session: SessionDto) => void
  onRevokeAll: () => void
  onClose: () => void
}) {
  const tx = useCopy()
  const list = useQuery({
    queryKey: sessionKeys.account(account.accountId),
    queryFn: () => accountSessionsApi.list(account.accountId),
  })
  const sessions = list.data ?? []
  return (
    <Dialog title={tx(D.devicesOf, { name: account.name })} onClose={onClose} variant="sheet">
      <section className="dev-section" aria-label={tx(D.devicesOf, { name: account.name })}>
        {sessions.length > 0 && <p className="field__hint">{tx(D.devicesExplain, { name: account.name })}</p>}
        {notice && (
          <p className="field__hint" role="status">
            {notice}
          </p>
        )}
        <QueryBoundary
          isLoading={list.isLoading}
          error={list.error}
          isEmpty={sessions.length === 0}
          emptyTitle={tx(D.emptyOf, { name: account.name })}
          onRetry={() => void list.refetch()}
          compact
        >
          <div className="dev-toolbar">
            <button type="button" className="btn btn--sm btn--danger" onClick={onRevokeAll}>
              {tx(D.signOutAll)}
            </button>
          </div>
          <SessionList sessions={sessions} onSignOut={onRevoke} compact />
        </QueryBoundary>
      </section>
    </Dialog>
  )
}

/** One device (`session`) or all of them (`session` null), with a reason -- the suspend pattern. */
function RevokeSessionDialog({
  account,
  session,
  onDone,
  onClose,
}: {
  account: AccountSummary
  session: SessionDto | null
  onDone: (notice?: string) => void
  onClose: () => void
}) {
  const tx = useCopy()
  const deviceName = useDeviceName()
  const client = useQueryClient()
  const key = sessionKeys.account(account.accountId)
  const revoke = useMutation({
    mutationFn: async (reason: string): Promise<number | null> => {
      if (session) {
        await accountSessionsApi.revoke(account.accountId, session.id, reason)
        return null
      }
      return (await accountSessionsApi.revokeAll(account.accountId, reason)).revoked
    },
    onSuccess: (revoked) => {
      void client.invalidateQueries({ queryKey: key })
      onDone(revoked === null ? undefined : tx(D.revokedAll, { n: revoked }))
    },
    onError: (error) => {
      // Already ended: refresh the list behind the dialog (inactive while this
      // dialog covers it, hence 'all'); the message says why.
      if (isSessionGone(error)) void client.invalidateQueries({ queryKey: key, refetchType: 'all' })
    },
  })
  return (
    <ReasonDialog
      title={
        session
          ? tx(D.adminRevokeTitle, { name: account.name, device: deviceName(session) })
          : tx(D.adminRevokeAllTitle, { name: account.name })
      }
      label={tx(A.reason)}
      confirmLabel={tx(session ? D.signOut : D.signOutAll)}
      isPending={revoke.isPending}
      error={localized(revoke.error)}
      extra={<p>{tx(D.devicesExplain, { name: account.name })}</p>}
      onConfirm={(reason) => revoke.mutate(reason)}
      onClose={onClose}
    />
  )
}

/** PD-21: opening an account as its person -- a support session, on the record. */
function StartSupportDialog({ account, onClose }: { account: AccountSummary; onClose: () => void }) {
  const tx = useCopy()
  const navigate = useNavigate()
  const client = useQueryClient()
  const start = useMutation({
    mutationFn: (reason: string) => supportAdminApi.start(account.accountId, reason),
    onSuccess: (token) => {
      // In memory only: the token never reaches a URL, history state or storage.
      supportTokens.set(token)
      // The record has a new session: whoever comes back to Accounts without ending it reads it live.
      void client.invalidateQueries({ queryKey: supportKeys.record() })
      navigate(`/support/${encodeURIComponent(token.session.id)}`)
    },
  })
  return (
    <ReasonDialog
      title={tx(S.startTitle, { name: account.name })}
      label={tx(S.reason)}
      confirmLabel={tx(S.start)}
      isPending={start.isPending}
      error={start.error == null ? undefined : new ApiError({ status: 0, code: 'CLIENT', messageEn: describeSupportError(start.error, 'en'), messageAr: describeSupportError(start.error, 'ar') })}
      extra={<p>{tx(S.startExplain, { name: account.name })}</p>}
      onConfirm={(reason) => start.mutate(reason)}
      onClose={onClose}
    />
  )
}

/**
 * PD-21: the record of support sessions -- the super admin's whole
 * organization, anyone else their own. Who, by whom, why, when, how many
 * requests. A live one is tagged, and the administrator who opened it may go
 * back in: the page at /support/:id asks for a fresh token with their own
 * session (the token itself is never kept), and the server decides again.
 */
function SupportRecord() {
  const tx = useCopy()
  const { dateTime, number, locale } = useI18n()
  const { staff } = useSession()
  const when = useWhen()
  const record = useQuery({ queryKey: supportKeys.record(), queryFn: () => supportAdminApi.list() })
  const sessions = record.data ?? []
  // Read once a render: a session past its time is no longer one to go back into.
  const now = Date.now()
  const live = (s: SupportSession) => !s.endedAt && Date.parse(s.expiresAt) > now
  // The live ones first, then the record in the server's order; the most recent few until asked for the rest.
  const [all, setAll] = useState(false)
  const ordered = [...sessions].sort((a, b) => Number(live(b)) - Number(live(a)))
  const shown = all ? ordered : ordered.slice(0, RECORD_FIRST)
  return (
    <Sheet id="acct-record-title" title={tx(S.recordTitle)} count={sessions.length > 0 ? number(sessions.length) : undefined}>
      {record.data && sessions.length === 0 ? (
        <p className="rec-empty">{tx(S.noRecord)}</p>
      ) : (
        <ul className="rec-list acct-sessions">
          {shown.map((s) => (
            <li key={s.id} className={live(s) ? 'rec-attn acct-session acct-session--live' : 'rec-attn acct-session'}>
              <div className="rec-attn__what">
                <span className="rec-attn__line">
                  <strong className="rec-attn__title">
                    <bdi>{s.target.name}</bdi>
                  </strong>
                  {live(s) ? <Badge tone="info">{tx(S.recordLive)}</Badge> : !s.endedAt && <Badge tone="outline">{tx(S.recordTimedOut)}</Badge>}
                </span>
                <span className="acct-session__why">
                  <bdi>{s.reason}</bdi>
                </span>
                {/* One line: who opened it and when, how long it lasted, what it did. */}
                <span className="rec-attn__sub">
                  <span title={dateTime(s.startedAt)}>{fill(tx(S.recordOpened), { by: <bdi>{s.staff.name}</bdi>, when: when(s.startedAt) })}</span>
                  {s.endedAt && (
                    <span title={dateTime(s.endedAt)}>
                      {tx(S.recordLasted, { time: countWords(Math.max(1, Math.round((Date.parse(s.endedAt) - Date.parse(s.startedAt)) / 60_000)), MINUTES, locale) })}
                    </span>
                  )}
                  {s.actions > 0 && <span>{countWords(s.actions, ACTIONS_RECORDED, locale)}</span>}
                </span>
              </div>
              <div className="rec-attn__act">
                {live(s) && staff?.id === s.staff.id && (
                  <RowActions
                    label={tx(A.more, { name: s.target.name })}
                    primary={
                      <Link to={`/support/${encodeURIComponent(s.id)}`} className="btn btn--sm">
                        {tx(S.openSession)}
                      </Link>
                    }
                  />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {shown.length < ordered.length && (
        <p className="dir-foot">
          <span />
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => setAll(true)}>
            {tx(S.recordShowAll, { n: number(ordered.length) })}
          </button>
        </p>
      )}
    </Sheet>
  )
}

/** How many support sessions the record shows before it asks to show the rest. */
const RECORD_FIRST = 5

/**
 * A support session this administrator opened and has not ended is the most
 * "right now" thing in this area: said at the top, with the way back in, not
 * only in the record at the foot of the page.
 */
function LiveSupportStrip() {
  const tx = useCopy()
  const { staff } = useSession()
  const record = useQuery({ queryKey: supportKeys.record(), queryFn: () => supportAdminApi.list() })
  const now = Date.now()
  const mine = (record.data ?? []).find((s) => !s.endedAt && Date.parse(s.expiresAt) > now && s.staff.id === staff?.id)
  if (!mine) return null
  return (
    <p className="notice notice--info acct-live">
      <Icon name="headset" size={18} />
      <span>{fill(tx(A.liveSession), { name: <bdi>{mine.target.name}</bdi> })}</span>
      <Link to={`/support/${encodeURIComponent(mine.id)}`} className="btn btn--sm">
        {tx(S.openSession)}
      </Link>
    </p>
  )
}

/** ReasonDialog shows an ApiError in the reader's language; this one carries PD-21's own wording. */
function localized(error: unknown): ApiError | undefined {
  if (error == null) return undefined
  return new ApiError({
    status: error instanceof ApiError ? error.status : 0,
    code: error instanceof ApiError ? error.code : 'CLIENT',
    messageEn: describeError(error, 'en'),
    messageAr: describeError(error, 'ar'),
  })
}
