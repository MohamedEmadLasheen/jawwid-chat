import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { assistantApi } from '@/core/api/ai'
import { AiBlock } from './AiMarker'

/**
 * The per-conversation assistant: a summary, and a drafted reply.
 *
 * Nothing here sends anything on its own. `generate` writes a draft; a separate
 * click, after the manager has read the words, calls `send` -- which the server
 * routes through the ordinary message pipeline authored by that manager, so
 * BR-1, scope and moderation all apply (Phase 7 §10).
 */
export function AssistantPanel({ conversationId }: { conversationId: string }) {
  const qc = useQueryClient()
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<string | null>(null)

  const summary = useQuery({
    queryKey: ['ai', 'summary', conversationId],
    queryFn: () => assistantApi.summarize(conversationId),
  })

  const suggestions = useQuery({
    queryKey: ['ai', 'suggestions', conversationId],
    queryFn: () => assistantApi.suggestions(conversationId).then((r) => r.suggestions),
  })

  const pending = suggestions.data?.[0] ?? null

  const generate = useMutation({
    mutationFn: () => assistantApi.generate(conversationId),
    onSuccess: (result) => {
      setError(
        result.suggestion
          ? null
          : // Not a failure. The assistant declines when a good reply would
            // need a promise it may not make, and a manager writing it
            // themselves is the correct outcome.
            'The assistant has nothing to suggest here. Write the reply yourself.',
      )
      setDraft(null)
      void qc.invalidateQueries({ queryKey: ['ai', 'suggestions', conversationId] })
    },
    onError: (e: Error) => setError(e.message),
  })

  const send = useMutation({
    mutationFn: () => assistantApi.send(pending!.id, draft ?? undefined),
    onSuccess: (result) => {
      setSent(result.messageId)
      setDraft(null)
      setError(null)
      void qc.invalidateQueries({ queryKey: ['ai', 'suggestions', conversationId] })
    },
    // A refusal from the send pipeline surfaces verbatim. The draft stays
    // pending, exactly as the server left it.
    onError: (e: Error) => setError(e.message),
  })

  const dismiss = useMutation({
    mutationFn: () => assistantApi.dismiss(pending!.id),
    onSuccess: () => {
      setDraft(null)
      void qc.invalidateQueries({ queryKey: ['ai', 'suggestions', conversationId] })
    },
  })

  const s = summary.data?.summary

  return (
    <div className="assistant">
      {s ? (
        <AiBlock kind="summary">
          <dl className="assistant__summary">
            <dt>Problem</dt><dd>{s.problem}</dd>
            <dt>What was done</dt><dd>{s.whatWasDone}</dd>
            <dt>Pending action</dt><dd>{s.pendingAction}</dd>
            <dt>Important history</dt><dd>{s.importantHistory}</dd>
          </dl>
          {/*
            Inferences are rendered APART from the four sections and labelled as
            readings rather than record. A hedge folded into the prose is a
            hedge a hurried manager skims past (§13).
          */}
          {s.inferences.length > 0 && (
            <div className="assistant__inferences">
              <strong>Inferred, not stated:</strong>
              <ul>{s.inferences.map((i, n) => <li key={n}>{i}</li>)}</ul>
            </div>
          )}
        </AiBlock>
      ) : summary.isLoading ? (
        <p className="assistant__muted">Summarising…</p>
      ) : (
        <p className="assistant__muted">
          No summary available. The conversation itself is unaffected.
        </p>
      )}

      {pending ? (
        <AiBlock
          kind="suggestion"
          footer={
            <>
              <button
                type="button"
                className="btn btn--primary"
                disabled={send.isPending}
                onClick={() => send.mutate()}
              >
                {draft !== null && draft !== pending.body ? 'Send edited reply' : 'Send'}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => setDraft(draft === null ? pending.body : null)}
              >
                {draft === null ? 'Edit' : 'Cancel edit'}
              </button>
              <button type="button" className="btn btn--quiet" onClick={() => dismiss.mutate()}>
                Dismiss
              </button>
            </>
          }
        >
          {draft === null ? (
            <p className="assistant__draft">{pending.body}</p>
          ) : (
            <textarea
              className="assistant__editor"
              value={draft}
              rows={4}
              onChange={(e) => setDraft(e.target.value)}
              aria-label="Edit the suggested reply before sending"
            />
          )}
        </AiBlock>
      ) : (
        <button
          type="button"
          className="btn"
          disabled={generate.isPending}
          onClick={() => generate.mutate()}
        >
          {generate.isPending ? 'Drafting…' : 'Draft a reply'}
        </button>
      )}

      {sent && <p className="assistant__ok">Sent as message {sent}.</p>}
      {error && <p className="assistant__error">{error}</p>}
    </div>
  )
}
