import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { attentionApi, type AttentionFlag } from '@/core/api/ai'
import { EmptyState, ErrorState, LoadingState } from '@/shared/components/States'
import { AiBlock } from './AiMarker'
import { AssistantPanel } from './AssistantPanel'

/**
 * ATTENTION -- the manager's queue of conversations that may need a look.
 *
 * Phase 7 §35: from here a manager can see WHY something was flagged, read the
 * summary, use or edit a suggested reply, send it, and resolve the flag. Every
 * one of those is a separate, deliberate act.
 *
 * What this page cannot do is act on the business. There is no cancel button,
 * no refund, no suspend -- the API serves no such route from a flag, and a
 * manager who decides to take one of those actions does it through the surface
 * that already authorises and audits it (§18).
 */
const RISK_LABEL: Record<AttentionFlag['riskType'], string> = {
  frustrated_parent: 'Frustrated parent',
  unanswered_messages: 'Repeated unanswered messages',
  potential_escalation: 'Potential escalation',
  cancellation_intent: 'Cancellation intent',
}

export function AttentionPage() {
  const qc = useQueryClient()
  const [selected, setSelected] = useState<AttentionFlag | null>(null)
  const [note, setNote] = useState('')

  const flags = useQuery({
    queryKey: ['ai', 'attention'],
    queryFn: () => attentionApi.queue().then((r) => r.flags),
  })

  const refresh = () => {
    setSelected(null)
    setNote('')
    void qc.invalidateQueries({ queryKey: ['ai', 'attention'] })
  }

  const resolve = useMutation({
    mutationFn: () => attentionApi.resolve(selected!.id, note || 'handled'),
    onSuccess: refresh,
  })
  const dismissFlag = useMutation({
    mutationFn: () => attentionApi.dismiss(selected!.id, note || 'not a real risk'),
    onSuccess: refresh,
  })
  const acknowledge = useMutation({
    mutationFn: (id: string) => attentionApi.acknowledge(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['ai', 'attention'] }),
  })

  if (flags.isLoading) return <LoadingState />
  if (flags.error) return <ErrorState error={flags.error} />

  const rows = flags.data ?? []

  return (
    <div className="page page--split">
      <section className="page__list">
        <h1>Attention</h1>
        {rows.length === 0 ? (
          <EmptyState title="Nothing needs attention right now." />
        ) : (
          <ul className="attention__list">
            {rows.map((flag) => (
              <li key={flag.id}>
                <button
                  type="button"
                  className={`attention__row attention__row--${flag.severity} ${
                    selected?.id === flag.id ? 'is-selected' : ''
                  }`}
                  onClick={() => setSelected(flag)}
                >
                  <span className="attention__type">{RISK_LABEL[flag.riskType]}</span>
                  <span className="attention__severity">{flag.severity}</span>
                  {/*
                    A clock and a judgement are not the same claim, so they are
                    not shown as the same thing. `sweep` is arithmetic over
                    message timestamps and is simply true; `ai` is a reading.
                  */}
                  <span className="attention__source">
                    {flag.detectedBy === 'sweep' ? 'measured' : 'AI reading'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="page__detail">
        {!selected ? (
          <EmptyState title="Select a flag to see why it was raised." />
        ) : (
          <>
            <AiBlock kind="attention">
              <p className="attention__reasonTitle">{RISK_LABEL[selected.riskType]}</p>
              {/* §17: a concise, checkable evidence summary -- never the
                  model's internal reasoning. */}
              <p className="attention__reason">{selected.reason}</p>
              {selected.confidence && (
                <p className="attention__confidence">
                  Confidence {Math.round(Number(selected.confidence) * 100)}%
                </p>
              )}
            </AiBlock>

            <Link className="btn" to={`/console/${selected.conversationId}`}>
              Open the conversation
            </Link>

            <AssistantPanel conversationId={selected.conversationId} />

            <div className="attention__resolution">
              <label htmlFor="attention-note">What did you do?</label>
              <input
                id="attention-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Called the parent and rebooked the class"
              />
              <button type="button" className="btn btn--primary" onClick={() => resolve.mutate()}>
                Resolve
              </button>
              {/*
                Dismiss is separate from resolve on purpose: the dismissal rate
                per risk type is what tells anyone whether the classifier is
                worth running.
              */}
              <button type="button" className="btn" onClick={() => dismissFlag.mutate()}>
                Not a real risk
              </button>
              {selected.status === 'open' && (
                <button
                  type="button"
                  className="btn btn--quiet"
                  onClick={() => acknowledge.mutate(selected.id)}
                >
                  I'm on it
                </button>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  )
}
