import { useId, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useSession } from '@/core/auth/SessionProvider'
import { ApiError } from '@/core/api/errors'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import { Icon } from '@/shared/components/Icon'
import { PageHeader } from '@/shared/components/PageHeader'
import { QueryBoundary } from '@/shared/components/States'
import { mySessionsApi, sessionKeys, type SessionDto } from './api'
import { D, DEVICES, isSessionGone, sessionError, useCopy } from './copy'
import { countWords } from '@/features/instalments/copy'
import { T as PROFILE } from '@/features/profile/copy'
import { SessionList, isUnrecognised, useDeviceName } from './SessionList'
import './devices.css'

type Pending = { act: 'one'; session: SessionDto } | { act: 'others' }

/**
 * PD-23 `/profile/devices`: where the signed-in staff member's account is
 * signed in. The page is its masthead and one sheet; the same sheet is the
 * "Devices & sessions" tab of My profile, so the two read as one thing.
 */
export function DevicesPage() {
  const tx = useCopy()
  return (
    <div className="page dev-page">
      <div className="page__inner">
        <PageHeader back={{ to: '/profile', label: tx(PROFILE.myProfile) }} title={tx(D.title)} />
        <MyDevices />
      </div>
    </div>
  )
}

/**
 * The sheet of one's own signed-in devices: this browser first and tagged,
 * "Sign out" on each row, and "Sign out all other devices" as the sheet's one
 * action. Signing out THIS browser ends the session here too -- locally,
 * without another request, because the server has already ended it.
 */
export function MyDevices() {
  const tx = useCopy()
  const { locale } = useI18n()
  const deviceName = useDeviceName()
  const titleId = useId()
  const list = useQuery({ queryKey: sessionKeys.mine, queryFn: mySessionsApi.list })
  const sessions = list.data ?? []
  const others = sessions.filter((s) => !s.current).length
  const [pending, setPending] = useState<Pending | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  return (
    <div className="dev-mine">
      {notice && (
        <p className="notice notice--info dev-notice" role="status">
          {notice}
        </p>
      )}
      <section className="sheet dev-sheet" aria-labelledby={titleId}>
        <div className="sheet__head">
          <div className="dev-sheet__title">
            <h2 id={titleId} className="sheet__title">
              {tx(D.signedInDevices)}
            </h2>
            {sessions.length > 0 && (
              <span className="sheet__count">
                {/* The answer: on how many devices, and whether one of them cannot be recognised. */}
                {tx(sessions.some(isUnrecognised) ? D.summaryUnknown : D.summary, {
                  devices: countWords(new Set(sessions.map(deviceName)).size, DEVICES, locale),
                })}
              </span>
            )}
          </div>
          {others > 0 && (
            <button type="button" className="btn btn--sm dev-signout-others" onClick={() => setPending({ act: 'others' })}>
              <Icon name="signOut" size={16} />
              {tx(D.signOutOthers)}
            </button>
          )}
        </div>
        <QueryBoundary
          isLoading={list.isLoading}
          error={list.error}
          isEmpty={sessions.length === 0}
          emptyTitle={tx(D.empty)}
          onRetry={() => void list.refetch()}
          compact
        >
          <SessionList sessions={sessions} onSignOut={(session) => setPending({ act: 'one', session })} />
        </QueryBoundary>
      </section>

      {pending?.act === 'one' && <RevokeOneDialog session={pending.session} onClose={() => setPending(null)} />}
      {pending?.act === 'others' && (
        <RevokeOthersDialog
          onDone={(n) => {
            setNotice(tx(D.revokedOthers, { n }))
            setPending(null)
          }}
          onClose={() => setPending(null)}
        />
      )}
    </div>
  )
}

function RevokeOneDialog({ session, onClose }: { session: SessionDto; onClose: () => void }) {
  const tx = useCopy()
  const name = useDeviceName()
  const client = useQueryClient()
  const { signOutLocally } = useSession()
  const revoke = useMutation({
    mutationFn: () => mySessionsApi.revoke(session.id),
    onSuccess: () => {
      if (session.current) {
        // The server ended this browser's session: end it here, sending nothing.
        signOutLocally()
        return
      }
      void client.invalidateQueries({ queryKey: sessionKeys.mine })
      onClose()
    },
    onError: (error) => {
      // Already ended (or never ours): the list is stale, not the person.
      if (isSessionGone(error)) void client.invalidateQueries({ queryKey: sessionKeys.mine })
    },
  })
  return (
    <ConfirmDialog
      title={tx(D.confirmTitle, { device: name(session) })}
      body={tx(session.current ? D.confirmCurrentBody : D.confirmBody)}
      confirmLabel={tx(D.signOut)}
      isPending={revoke.isPending}
      error={sessionError(revoke.error)}
      onConfirm={() => revoke.mutate()}
      onClose={onClose}
    />
  )
}

function RevokeOthersDialog({ onDone, onClose }: { onDone: (revoked: number) => void; onClose: () => void }) {
  const tx = useCopy()
  const client = useQueryClient()
  const revoke = useMutation({
    mutationFn: () => mySessionsApi.revokeOthers(),
    onSuccess: (r) => onDone(r.revoked),
    onSettled: () => client.invalidateQueries({ queryKey: sessionKeys.mine }),
  })
  return (
    <ConfirmDialog
      title={tx(D.confirmOthersTitle)}
      body={tx(D.confirmOthersBody)}
      confirmLabel={tx(D.signOutOthers)}
      isPending={revoke.isPending}
      error={sessionError(revoke.error)}
      onConfirm={() => revoke.mutate()}
      onClose={onClose}
    />
  )
}

function ConfirmDialog({
  title,
  body,
  confirmLabel,
  isPending,
  error,
  onConfirm,
  onClose,
}: {
  title: string
  body: string
  confirmLabel: string
  isPending: boolean
  error: unknown
  onConfirm: () => void
  onClose: () => void
}) {
  const { t, locale } = useI18n()
  return (
    <Dialog
      title={title}
      onClose={onClose}
      footer={
        <>
          <DialogCancelButton onClick={onClose} />
          <button type="button" className="btn btn--danger" disabled={isPending} onClick={onConfirm}>
            {isPending ? t('common.loading') : confirmLabel}
          </button>
        </>
      }
    >
      <p>{body}</p>
      {error != null && (
        <div className="field__error" role="alert">
          {error instanceof ApiError ? error.localized(locale) : t('common.offline')}
        </div>
      )}
    </Dialog>
  )
}
