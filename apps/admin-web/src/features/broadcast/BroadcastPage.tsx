import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  broadcastApi,
  type AudienceClause,
  type AudiencePreview,
  type BroadcastStatus,
} from '@/core/api/phase5'
import { groupApi, labelApi } from '@/core/api/directory'
import { qk } from '@/core/api/queryKeys'
import { useSession } from '@/core/auth/SessionProvider'
import { hasPermission } from '@/core/permissions/capabilities'
import { EmptyState, ErrorState, LoadingState } from '@/shared/components/States'
import { Badge } from '@/shared/components/Badge'
import { AudiencePicker, describe } from '../stories/AudiencePicker'

/**
 * BROADCAST -- compose, preview, queue, watch.
 *
 * ## The screen is deliberately asynchronous
 *
 * Sending does not wait for delivery, and the UI says so rather than hiding it
 * behind a spinner. "Queue" returns immediately, the row appears as `queued`,
 * and the counts fill in as a worker delivers. A compose screen that blocked
 * until four hundred families had been messaged would be a timeout with a
 * progress bar on it.
 *
 * ## Sent is not delivered
 *
 * The two counts are shown separately, always. `sent` means a message was
 * written and a notification scheduled -- work this system did. `delivered`
 * means a client or a push provider acknowledged it. Collapsing them into one
 * "delivered" figure would make the report a report on our own optimism, which
 * is exactly the number an operator would rely on when a family says they never
 * heard about a closure.
 */
export function BroadcastPage() {
  const qc = useQueryClient()
  const { permissions, staff } = useSession()
  const canSend = hasPermission(permissions, 'broadcasts.send')
  const canTargetEveryone = staff?.role === 'manager' || staff?.role === 'super_admin'

  const broadcasts = useQuery({
    queryKey: qk.broadcasts,
    queryFn: () => broadcastApi.list(),
    // A fan-out in flight changes the counts without any event from us, so the
    // list polls WHILE something is running and stops when nothing is.
    refetchInterval: (query) =>
      (query.state.data ?? []).some((b: BroadcastStatus) => !isTerminal(b.state)) ? 3000 : false,
  })
  const labels = useQuery({
    queryKey: qk.labels,
    queryFn: () => labelApi.list().then((r) => r.labels),
  })
  const groups = useQuery({
    queryKey: qk.groups(false),
    queryFn: () => groupApi.list(false).then((r) => r.groups),
  })

  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [audiences, setAudiences] = useState<AudienceClause[]>([])
  const [preview, setPreview] = useState<AudiencePreview | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = () => void qc.invalidateQueries({ queryKey: qk.broadcasts })

  const runPreview = useMutation({
    mutationFn: () => broadcastApi.preview(audiences),
    onSuccess: (data) => {
      setPreview(data)
      setError(null)
    },
    onError: (e: Error) => {
      setPreview(null)
      setError(e.message)
    },
  })

  const create = useMutation({
    mutationFn: () => broadcastApi.create({ title, body, audiences }),
    onSuccess: () => {
      setTitle('')
      setBody('')
      setAudiences([])
      setPreview(null)
      setError(null)
      refresh()
    },
    onError: (e: Error) => setError(e.message),
  })

  const queue = useMutation({
    mutationFn: (id: string) => broadcastApi.queue(id),
    onSuccess: refresh,
    onError: (e: Error) => setError(e.message),
  })

  const cancel = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      broadcastApi.cancel(id, reason),
    onSuccess: refresh,
    onError: (e: Error) => setError(e.message),
  })

  if (broadcasts.isLoading) return <LoadingState />
  if (broadcasts.isError) return <ErrorState error={broadcasts.error} onRetry={refresh} />

  const labelOptions = (labels.data ?? []).map((l) => ({ id: l.id, name: l.name }))
  const groupOptions = (groups.data ?? []).map((g) => ({ id: g.id, name: g.name }))

  return (
    <section className="page">
      <header className="page__header">
        <h1>Broadcast</h1>
      </header>

      {canSend && (
        <form
          className="card"
          onSubmit={(e) => {
            e.preventDefault()
            create.mutate()
          }}
        >
          <h2>New broadcast</h2>
          <label>
            <span>Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label>
            <span>Message</span>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} required />
          </label>

          <AudiencePicker
            value={audiences}
            onChange={(next) => {
              setAudiences(next)
              // A stale preview is worse than none: it would show the reach of
              // an audience the operator has since changed.
              setPreview(null)
            }}
            labels={labelOptions}
            groups={groupOptions}
            canTargetEveryone={canTargetEveryone}
          />

          <div className="card__row">
            <button
              type="button"
              onClick={() => runPreview.mutate()}
              disabled={audiences.length === 0 || runPreview.isPending}
            >
              Preview reach
            </button>
            <button
              type="submit"
              disabled={create.isPending || audiences.length === 0 || body.trim() === ''}
            >
              Create draft
            </button>
          </div>

          {preview && (
            <div className="card__note" role="status">
              <p>
                <strong>{preview.recipientCount}</strong> recipients across{' '}
                <strong>{preview.familyCount}</strong> families.
              </p>
              {/*
                Shown BEFORE the send. A label spanning the academy, targeted by
                a supervisor holding forty of its families, legitimately reaches
                forty -- and silently reaching forty when the operator believes
                they are reaching four hundred is how an announcement misses the
                families it was written for.
              */}
              {preview.notes.map((note) => (
                <p key={note} className="muted">
                  {note}
                </p>
              ))}
            </div>
          )}

          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
        </form>
      )}

      {broadcasts.data && broadcasts.data.length === 0 ? (
        <EmptyState title="No broadcasts yet." />
      ) : (
        <ul className="list" aria-label="Broadcasts">
          {(broadcasts.data ?? []).map((b) => (
            <li key={b.id} className="card">
              <div className="card__row">
                <strong>{b.title ?? b.body.slice(0, 60)}</strong>
                <Badge tone={toneFor(b.state)}>{b.state.replace('_', ' ')}</Badge>
              </div>

              {b.audiences && b.audiences.length > 0 && (
                <p className="muted">
                  {b.audiences
                    .map((a) =>
                      describe(
                        { kind: a.kind, refId: a.refId ?? undefined },
                        labelOptions,
                        groupOptions,
                      ),
                    )
                    .join(' · ')}
                </p>
              )}

              {/*
                Five numbers, because a partial failure is a real outcome and an
                operator has to be able to see WHICH part failed. Rolling these
                into one figure is how "398 of 400 reached" becomes either
                "done" or "failed", and both are lies.
              */}
              <dl className="counts">
                <div>
                  <dt>Recipients</dt>
                  <dd>{b.recipientCount}</dd>
                </div>
                <div>
                  <dt>Sent</dt>
                  <dd>{b.sentCount}</dd>
                </div>
                <div>
                  <dt>Delivered</dt>
                  <dd>{b.deliveredCount}</dd>
                </div>
                <div>
                  <dt>Failed</dt>
                  <dd>{b.failedCount}</dd>
                </div>
                <div>
                  <dt>Pending</dt>
                  <dd>{b.pendingCount}</dd>
                </div>
              </dl>

              {canSend && b.state === 'draft' && (
                <button type="button" onClick={() => queue.mutate(b.id)} disabled={queue.isPending}>
                  Send
                </button>
              )}

              {canSend && (b.state === 'queued' || b.state === 'processing') && (
                <button
                  type="button"
                  onClick={() => {
                    const reason = window.prompt('Why is this broadcast being cancelled?')
                    if (reason && reason.trim()) cancel.mutate({ id: b.id, reason: reason.trim() })
                  }}
                  disabled={cancel.isPending}
                >
                  Cancel
                </button>
              )}

              {/*
                Stated plainly rather than left for an operator to infer:
                cancelling stops what has NOT gone out. There is no un-sending a
                message, and a UI that implied otherwise would be lying about
                what the button does.
              */}
              {(b.state === 'queued' || b.state === 'processing') && (
                <p className="muted">
                  Cancelling stops undelivered recipients only. Messages already sent stay sent.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function isTerminal(state: BroadcastStatus['state']): boolean {
  return (
    state === 'completed' ||
    state === 'partial_failure' ||
    state === 'failed' ||
    state === 'cancelled'
  )
}

function toneFor(state: BroadcastStatus['state']) {
  switch (state) {
    case 'completed':
      return 'ok' as const
    case 'failed':
      return 'danger' as const
    // A partial failure is neither success nor failure, and is coloured as the
    // warning it is so an operator looks at it.
    case 'partial_failure':
      return 'waiting' as const
    case 'processing':
    case 'queued':
      return 'today' as const
    default:
      return 'neutral' as const
  }
}
