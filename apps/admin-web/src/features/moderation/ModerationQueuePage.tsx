import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  humanDuration,
  moderationApi,
  severityTone,
  type ModerationSeverity,
  type QueueItem,
} from '@/core/api/phase6'
import { qk } from '@/core/api/queryKeys'
import { useSession } from '@/core/auth/SessionProvider'
import { hasPermission } from '@/core/permissions/capabilities'
import { QueryBoundary } from '@/shared/components/States'
import { Badge } from '@/shared/components/Badge'

/**
 * THE MODERATION QUEUE.
 *
 * "Is this message safe to send to this family?" -- decided in seconds, not
 * minutes.
 *
 * ## The body is never truncated and never collapsed
 *
 * You cannot approve what you cannot read, and a "show more" on an approval
 * queue guarantees somebody approves blind. A 4000-character message scrolls
 * inside its own card; it is never cut off.
 *
 * ## Ordering is by TIME, not by severity
 *
 * Somebody is waiting on every one of these. Sorting by severity would bury the
 * low-severity item that has been waiting since this morning under every new
 * critical one -- so severity is a badge and a FILTER, and age is the order.
 * Escalated items are the single exception: an escalated item is by definition
 * one the ordering already failed.
 *
 * ## Rejecting is one step slower than approving
 *
 * Approving is the common, safe case and is one click. Rejecting opens a
 * required reason field, because the reason reaches the sender verbatim and is
 * the only thing that makes a rejection actionable. Editing is slower still,
 * because it changes what a colleague said.
 */
export function ModerationQueuePage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { permissions } = useSession()
  // Deleting is a strictly stronger act than deciding, and the permission model
  // already drew that line. The server refuses regardless of what this decides.
  const canDelete = hasPermission(permissions, 'messages.delete')

  const [escalatedOnly, setEscalatedOnly] = useState(false)
  const [severity, setSeverity] = useState<ModerationSeverity | ''>('')
  const [error, setError] = useState<string | null>(null)

  const filter = {
    escalated: escalatedOnly || undefined,
    severity: severity || undefined,
  }
  const queue = useQuery({
    queryKey: qk.moderationQueue(filter),
    queryFn: () => moderationApi.queue(filter),
  })

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.moderationAll })
    void qc.invalidateQueries({ queryKey: qk.commandCenterAll })
  }

  /**
   * One mutation for every decision.
   *
   * The card does NOT leave the list until the server confirms. An approval
   * that silently failed is content that never reached a parent, and an
   * optimistic removal would hide exactly that.
   */
  const decide = useMutation({
    mutationFn: (action: () => Promise<unknown>) => action(),
    onSuccess: () => {
      setError(null)
      refresh()
    },
    onError: (e: Error) => setError(e.message),
  })

  return (
    <div className="page">
      <h1 className="page__title">Moderation</h1>

      {error && (
        <div className="banner banner--warn" role="alert">
          {error}
        </div>
      )}

      <div className="card" style={{ marginBlockEnd: 'var(--space-4)' }}>
        <div className="row" style={{ gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <label className="row" style={{ gap: 'var(--space-2)' }}>
            <input
              type="checkbox"
              checked={escalatedOnly}
              onChange={(e) => setEscalatedOnly(e.target.checked)}
            />
            <span>Escalated only</span>
          </label>

          <label className="row" style={{ gap: 'var(--space-2)' }}>
            <span>Severity</span>
            <select
              value={severity}
              onChange={(e) => setSeverity(e.target.value as ModerationSeverity | '')}
            >
              <option value="">Any</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </label>

          <button type="button" className="btn btn--sm" onClick={() => void queue.refetch()}>
            Refresh
          </button>
        </div>
      </div>

      <QueryBoundary
        isLoading={queue.isLoading}
        error={queue.error}
        isEmpty={(queue.data ?? []).length === 0}
        // The healthy state, and it should read as one: calm, no action.
        emptyTitle={
          escalatedOnly || severity
            ? 'No messages match this filter.'
            : 'No messages waiting for approval.'
        }
        onRetry={() => void queue.refetch()}
      >
        {(queue.data ?? []).map((item) => (
          <ApprovalCard
            key={item.approvalId}
            item={item}
            canDelete={canDelete}
            busy={decide.isPending}
            onOpen={() => navigate(`/console/${item.conversationId}`)}
            onApprove={() => decide.mutate(() => moderationApi.approve(item.approvalId))}
            onReject={(reason) =>
              decide.mutate(() => moderationApi.reject(item.approvalId, reason))
            }
            onEditAndSend={(body, reason) =>
              decide.mutate(() => moderationApi.editAndSend(item.approvalId, body, reason))
            }
            onDelete={(reason) =>
              decide.mutate(() => moderationApi.remove(item.approvalId, reason))
            }
          />
        ))}
      </QueryBoundary>
    </div>
  )
}

type CardMode = 'idle' | 'rejecting' | 'editing' | 'deleting'

function ApprovalCard({
  item,
  canDelete,
  busy,
  onOpen,
  onApprove,
  onReject,
  onEditAndSend,
  onDelete,
}: {
  item: QueueItem
  canDelete: boolean
  busy: boolean
  onOpen: () => void
  onApprove: () => void
  onReject: (reason: string) => void
  onEditAndSend: (body: string, reason?: string) => void
  onDelete: (reason: string) => void
}) {
  const [mode, setMode] = useState<CardMode>('idle')
  const [reason, setReason] = useState('')
  // Pre-filled with what the sender wrote: the moderator is fixing a message,
  // not composing one, and starting from a blank box invites a rewrite.
  const [draft, setDraft] = useState(item.originalBody ?? '')

  const reset = () => {
    setMode('idle')
    setReason('')
    setDraft(item.originalBody ?? '')
  }

  return (
    <section className="card" style={{ marginBlockEnd: 'var(--space-4)' }}>
      <header className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div>
          <strong>{item.requestedByName ?? item.requestedBy}</strong>
          {' → '}
          <button type="button" className="btn btn--ghost btn--sm" onClick={onOpen}>
            {item.conversationTitle ?? item.conversationType}
          </button>
        </div>
        <div className="row" style={{ gap: 'var(--space-2)' }}>
          {item.escalatedAt && <Badge tone="danger">Escalated</Badge>}
          {item.highestSeverity && (
            <Badge tone={severityTone(item.highestSeverity)}>{item.highestSeverity}</Badge>
          )}
          {/* Elapsed time in words. Past the threshold it is escalated, which
              the badge above says outright rather than by colour alone. */}
          <span className="muted">Waiting {humanDuration(item.pendingForMs)}</span>
        </div>
      </header>

      {/* WHY it was held. A policy hold has no flags and says so, rather than
          showing an empty list that reads like a bug. */}
      <div className="row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap', marginBlockStart: 'var(--space-2)' }}>
        {item.trigger === 'policy' ? (
          <Badge tone="neutral">Held by this group&apos;s policy</Badge>
        ) : (
          item.flags.map((f, i) => (
            <Badge key={i} tone={severityTone(f.severity)}>
              {f.ruleName}
            </Badge>
          ))
        )}
      </div>

      {item.flags.some((f) => f.matchedExcerpt) && (
        <ul className="muted" style={{ marginBlockStart: 'var(--space-2)' }}>
          {item.flags
            .filter((f) => f.matchedExcerpt)
            .map((f, i) => (
              <li key={i}>
                {f.category}: <code>{f.matchedExcerpt}</code>
              </li>
            ))}
        </ul>
      )}

      {/*
        THE ORIGINAL SUBMITTED CONTENT, in full.
        `unicode-bidi: plaintext` so an Arabic message renders right-to-left and
        a mixed one does not scramble. Scrolls inside the card; never truncated.
      */}
      <blockquote
        style={{
          unicodeBidi: 'plaintext',
          whiteSpace: 'pre-wrap',
          maxBlockSize: '20rem',
          overflowY: 'auto',
          marginBlock: 'var(--space-3)',
          padding: 'var(--space-3)',
          background: 'var(--surface-2, transparent)',
          borderInlineStart: '3px solid var(--border, currentColor)',
        }}
      >
        {item.originalBody ?? <em>(no text — see the conversation for attachments)</em>}
      </blockquote>

      {mode === 'idle' && (
        <div className="row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn--primary" disabled={busy} onClick={onApprove}>
            Approve
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => setMode('editing')}>
            Edit and send
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => setMode('rejecting')}>
            Reject
          </button>
          {canDelete && (
            <button
              type="button"
              className="btn btn--ghost"
              disabled={busy}
              onClick={() => setMode('deleting')}
            >
              Delete
            </button>
          )}
          <button type="button" className="btn btn--ghost btn--sm" onClick={onOpen}>
            Open conversation
          </button>
        </div>
      )}

      {mode === 'editing' && (
        <div className="column" style={{ gap: 'var(--space-2)' }}>
          <label htmlFor={`edit-${item.approvalId}`}>
            Edited message — the original stays on record
          </label>
          <textarea
            id={`edit-${item.approvalId}`}
            rows={6}
            value={draft}
            style={{ unicodeBidi: 'plaintext' }}
            onChange={(e) => setDraft(e.target.value)}
          />
          <input
            type="text"
            placeholder="Note for the record (optional)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <p className="muted">
            The edited message is scanned again before it is sent. If it still matches a
            rule it is refused, not sent.
          </p>
          <div className="row" style={{ gap: 'var(--space-2)' }}>
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy || draft.trim() === ''}
              onClick={() => onEditAndSend(draft, reason || undefined)}
            >
              Send edited message
            </button>
            <button type="button" className="btn btn--ghost" onClick={reset}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {(mode === 'rejecting' || mode === 'deleting') && (
        <div className="column" style={{ gap: 'var(--space-2)' }}>
          <label htmlFor={`reason-${item.approvalId}`}>
            {mode === 'rejecting'
              ? 'Reason — the sender sees this, so write it to them'
              : 'Reason for withdrawing this message'}
          </label>
          <input
            id={`reason-${item.approvalId}`}
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="row" style={{ gap: 'var(--space-2)' }}>
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy || reason.trim() === ''}
              onClick={() =>
                mode === 'rejecting' ? onReject(reason.trim()) : onDelete(reason.trim())
              }
            >
              {mode === 'rejecting' ? 'Reject' : 'Delete'}
            </button>
            <button type="button" className="btn btn--ghost" onClick={reset}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
