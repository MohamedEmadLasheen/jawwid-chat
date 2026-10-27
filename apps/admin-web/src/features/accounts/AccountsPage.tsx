import { useDeferredValue, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useSession } from '@/core/auth/SessionProvider'
import { isSuperAdmin } from '@/core/permissions/capabilities'
import { Badge, type Tone } from '@/shared/components/Badge'
import { Dialog } from '@/shared/components/Dialog'
import { FilterChips } from '@/shared/components/FilterChips'
import { PageHeader } from '@/shared/components/PageHeader'
import { SearchField } from '@/shared/components/SearchField'
import { QueryBoundary } from '@/shared/components/States'
import { ReasonDialog } from '@/features/family/ReasonDialog'
import { ApiError } from '@/core/api/errors'
import type { AccountStatus, AccountSummary, IssuedReset } from './api'
import { A, KIND, STATUS, describeError, useCopy } from './copy'
import { useAccounts, useIssueReset, useReactivate, useSuspend } from './hooks'
import { supportAdminApi, supportKeys, supportTokens } from '@/features/support/api'
import { S, describeError as describeSupportError } from '@/features/support/copy'
import { accountSessionsApi, sessionKeys, type SessionDto } from '@/features/devices/api'
import { D, isSessionGone } from '@/features/devices/copy'
import { SessionList, useDeviceName } from '@/features/devices/SessionList'
import '@/features/devices/devices.css'
import './accounts.css'

type Kind = 'all' | 'family' | 'teacher' | 'staff'
type Pending =
  | { act: 'reset'; account: AccountSummary }
  | { act: 'suspend'; account: AccountSummary }
  | { act: 'reactivate'; account: AccountSummary }
  | { act: 'code'; account: AccountSummary; issued: IssuedReset }
  | { act: 'impersonate'; account: AccountSummary }
  | { act: 'devices'; account: AccountSummary; notice?: string }
  | { act: 'revokeSession'; account: AccountSummary; session: SessionDto }
  | { act: 'revokeAll'; account: AccountSummary }

const STATUS_TONE: Record<AccountStatus, Tone> = {
  provisioned: 'outline',
  active: 'ok',
  suspended: 'danger',
  deactivated: 'neutral',
}

/**
 * PD-21: account administration. Staff find a parent (by the parent's, the
 * family's or a child's name) or a teacher, and reset the password or set the
 * account inactive; the super admin also other staff. PD-40: which kinds is
 * the server's answer (`administers`) -- parents for Operations and Sales,
 * teachers for the Teachers department. The server decides the list and every
 * action; the chips and buttons follow its answer, which is advisory.
 */
export function AccountsPage({ eyebrow }: { eyebrow?: string }) {
  const tx = useCopy()
  const { t, dateTime } = useI18n()
  const { staff } = useSession()
  const [q, setQ] = useState('')
  const [kind, setKind] = useState<Kind>('all')
  const [pending, setPending] = useState<Pending | null>(null)
  const deferred = useDeferredValue(q.trim())
  const list = useAccounts(deferred, kind)
  const accounts = list.data?.accounts ?? []

  const administers = list.data?.administers
  const fallback: Kind[] = staff && isSuperAdmin(staff.role) ? ['family', 'teacher', 'staff'] : ['family', 'teacher']
  const kinds: Kind[] = ['all', ...(administers ?? fallback)]
  const noneAdministered = administers !== undefined && administers.length === 0

  return (
    <div className="page">
      <div className="page__inner">
        <PageHeader eyebrow={eyebrow} title={tx(A.title)} subtitle={tx(A.subtitle)} />
        <div className="toolbar">
          <SearchField value={q} onChange={setQ} label={tx(A.search)} clearLabel={t('common.cancel')} />
          <FilterChips
            label={tx(A.show)}
            value={kind}
            onChange={setKind}
            options={kinds.map((k) => ({ value: k, label: k === 'all' ? tx(A.all) : tx(KIND[k]) }))}
          />
        </div>
        <QueryBoundary
          isLoading={list.isLoading}
          error={list.error}
          isEmpty={accounts.length === 0}
          emptyTitle={tx(noneAdministered ? A.noneAdministered : A.empty)}
          onRetry={() => void list.refetch()}
        >
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{tx(A.person)}</th>
                  <th scope="col">{tx(A.status)}</th>
                  <th scope="col">{tx(A.lastLogin)}</th>
                  <th scope="col">{tx(A.actions)}</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.accountId}>
                    <td>
                      <div dir="auto">
                        <strong>{a.name}</strong> <Badge tone="outline">{tx(KIND[a.kind])}</Badge>
                      </div>
                      {a.familyName && (
                        <div className="field__hint" dir="auto">
                          {a.familyName}
                          {a.children.length > 0 && ` · ${tx(A.children, { names: a.children.join('، ') })}`}
                        </div>
                      )}
                    </td>
                    <td>
                      <Badge tone={STATUS_TONE[a.status]} dot>
                        {tx(STATUS[a.status])}
                      </Badge>{' '}
                      {!a.hasLogin && <Badge tone="outline">{tx(A.noLogin)}</Badge>}{' '}
                      {a.lockedUntil && <Badge tone="warn">{tx(A.locked)}</Badge>}
                    </td>
                    <td>{a.lastLoginAt ? dateTime(a.lastLoginAt) : tx(A.never)}</td>
                    <td>
                      <div className="acct-actions">
                        {a.allowed.resetPassword && (
                          <button type="button" className="btn btn--sm" onClick={() => setPending({ act: 'reset', account: a })}>
                            {tx(A.resetPassword)}
                          </button>
                        )}
                        {a.allowed.suspend && (
                          <button
                            type="button"
                            className="btn btn--sm btn--danger"
                            onClick={() => setPending({ act: 'suspend', account: a })}
                          >
                            {tx(A.suspend)}
                          </button>
                        )}
                        {a.allowed.impersonate && (
                          <button type="button" className="btn btn--sm" onClick={() => setPending({ act: 'impersonate', account: a })}>
                            {tx(S.open, { name: a.name })}
                          </button>
                        )}
                        {a.allowed.signOut === true && (
                          <button type="button" className="btn btn--sm" onClick={() => setPending({ act: 'devices', account: a })}>
                            {tx(D.devicesButton)}
                          </button>
                        )}
                        {a.allowed.reactivate && (
                          <button type="button" className="btn btn--sm" onClick={() => setPending({ act: 'reactivate', account: a })}>
                            {tx(A.reactivate)}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {list.data?.truncated && <p className="field__hint">{tx(A.truncated)}</p>}
        </QueryBoundary>
        <SupportRecord />
      </div>

      {pending?.act === 'reset' && (
        <ResetDialog
          account={pending.account}
          onIssued={(issued) => setPending({ act: 'code', account: pending.account, issued })}
          onClose={() => setPending(null)}
        />
      )}
      {pending?.act === 'code' && (
        <CodeDialog account={pending.account} issued={pending.issued} onClose={() => setPending(null)} />
      )}
      {pending?.act === 'impersonate' && <StartSupportDialog account={pending.account} onClose={() => setPending(null)} />}
      {pending?.act === 'devices' && (
        <DevicesDialog
          account={pending.account}
          notice={pending.notice}
          onRevoke={(session) => setPending({ act: 'revokeSession', account: pending.account, session })}
          onRevokeAll={() => setPending({ act: 'revokeAll', account: pending.account })}
          onClose={() => setPending(null)}
        />
      )}
      {(pending?.act === 'revokeSession' || pending?.act === 'revokeAll') && (
        <RevokeSessionDialog
          account={pending.account}
          session={pending.act === 'revokeSession' ? pending.session : null}
          onDone={(notice) => setPending({ act: 'devices', account: pending.account, notice })}
          onClose={() => setPending({ act: 'devices', account: pending.account })}
        />
      )}
      {(pending?.act === 'suspend' || pending?.act === 'reactivate') && (
        <StatusDialog act={pending.act} account={pending.account} onClose={() => setPending(null)} />
      )}
    </div>
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

/** The code exists only in this dialog's props: closing it is the end of it. */
function CodeDialog({ account, issued, onClose }: { account: AccountSummary; issued: IssuedReset; onClose: () => void }) {
  const tx = useCopy()
  const [copied, setCopied] = useState(false)
  return (
    <Dialog
      title={tx(A.codeTitle, { name: account.name })}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="btn"
            onClick={() => {
              void navigator.clipboard?.writeText(issued.code).then(() => setCopied(true), () => undefined)
            }}
          >
            {copied ? tx(A.copied) : tx(A.copy)}
          </button>
          <button type="button" className="btn btn--primary" onClick={onClose}>
            {tx(A.done)}
          </button>
        </>
      }
    >
      <p>{tx(A.codeExplain, { name: account.name, minutes: issued.expiresInMinutes })}</p>
      <p className="acct-code" dir="ltr" aria-label={issued.code.split('').join(' ')}>
        {issued.code}
      </p>
      <p className="field__hint">{tx(A.codeHow)}</p>
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
        <p className="field__hint">{tx(D.devicesExplain, { name: account.name })}</p>
        {notice && (
          <p className="field__hint" role="status">
            {notice}
          </p>
        )}
        <QueryBoundary
          isLoading={list.isLoading}
          error={list.error}
          isEmpty={sessions.length === 0}
          emptyTitle={tx(D.empty)}
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
  const start = useMutation({
    mutationFn: (reason: string) => supportAdminApi.start(account.accountId, reason),
    onSuccess: (token) => {
      // In memory only: the token never reaches a URL, history state or storage.
      supportTokens.set(token)
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
 * organization, anyone else their own. Who, whom, why, when, how many requests.
 */
function SupportRecord() {
  const tx = useCopy()
  const { dateTime } = useI18n()
  const record = useQuery({ queryKey: supportKeys.record(), queryFn: () => supportAdminApi.list() })
  const sessions = record.data ?? []
  return (
    <section className="acct-record" aria-labelledby="acct-record-title">
      <h2 id="acct-record-title" className="acct-record__title">
        {tx(S.recordTitle)}
      </h2>
      {record.data && sessions.length === 0 ? (
        <p className="field__hint">{tx(S.noRecord)}</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{tx(A.person)}</th>
                <th scope="col">{tx(S.recordBy)}</th>
                <th scope="col">{tx(A.reason)}</th>
                <th scope="col">{tx(S.recordStarted)}</th>
                <th scope="col">{tx(S.recordEnded)}</th>
                <th scope="col">{tx(S.recordActions)}</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td dir="auto">{s.target.name}</td>
                  <td dir="auto">{s.staff.name}</td>
                  <td dir="auto">{s.reason}</td>
                  <td>{dateTime(s.startedAt)}</td>
                  <td>{s.endedAt ? dateTime(s.endedAt) : <Badge tone="danger">{tx(S.recordLive)}</Badge>}</td>
                  <td>{s.actions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
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
