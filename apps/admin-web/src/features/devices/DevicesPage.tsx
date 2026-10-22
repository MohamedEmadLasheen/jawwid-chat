import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useSession } from '@/core/auth/SessionProvider'
import { ApiError } from '@/core/api/errors'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import { PageHeader } from '@/shared/components/PageHeader'
import { QueryBoundary } from '@/shared/components/States'
import { mySessionsApi, sessionKeys, type SessionDto } from './api'
import { D, isSessionGone, sessionError, useCopy } from './copy'
import { SessionList, useDeviceName } from './SessionList'
import './devices.css'

type Pending = { act: 'one'; session: SessionDto } | { act: 'others' }

/**
 * PD-23 `/profile/devices`: where the signed-in staff member's account is
 * signed in, with "Sign out" per device and "Sign out all other devices".
 * Signing out THIS browser ends the session here too -- locally, without
 * another request, because the server has already ended it.
 */
export function DevicesPage() {
  const tx = useCopy()
  const list = useQuery({ queryKey: sessionKeys.mine, queryFn: mySessionsApi.list })
  const sessions = list.data ?? []
  const others = sessions.filter((s) => !s.current).length
  const [pending, setPending] = useState<Pending | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  return (
    <div className="page">
      <div className="page__inner dev-page">
        <PageHeader
          title={tx(D.title)}
          subtitle={tx(D.subtitle)}
          actions={
            <Link to="/profile" className="btn btn--sm">
              {tx(D.back)}
            </Link>
          }
        />
        {others > 0 && (
          <div className="dev-toolbar">
            <button type="button" className="btn btn--sm btn--danger" onClick={() => setPending({ act: 'others' })}>
              {tx(D.signOutOthers)}
            </button>
          </div>
        )}
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
        >
          <SessionList sessions={sessions} onSignOut={(session) => setPending({ act: 'one', session })} />
        </QueryBoundary>
      </div>

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
