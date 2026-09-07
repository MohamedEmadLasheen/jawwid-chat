import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { knowledgeApi, type KnowledgeArticle } from '@/core/api/ai'
import { useSession } from '@/core/auth/SessionProvider'
import { hasPermission } from '@/core/permissions/capabilities'
import { EmptyState, ErrorState, LoadingState } from '@/shared/components/States'
import { Badge } from '@/shared/components/Badge'

/**
 * APPROVED KNOWLEDGE (§36).
 *
 * The list a manager curates, and the only source the assistant may ground an
 * answer on. Two things this page makes visible because they are load-bearing:
 *
 *   - authoring and approving are different acts, so an admin sees "Save draft"
 *     and a manager additionally sees "Approve";
 *   - an approved article cannot be edited in place. It is retired or returned
 *     to draft first, because editing live academy policy without re-review is
 *     what the approval permission exists to prevent.
 *
 * Both are enforced by the server; the UI mirrors them so nobody types an edit
 * and then meets a 409.
 */
export function KnowledgePage() {
  const qc = useQueryClient()
  const { permissions } = useSession()
  const canApprove = hasPermission(permissions, 'knowledge.approve')
  const canManage = hasPermission(permissions, 'knowledge.manage')

  const [form, setForm] = useState({ title: '', question: '', answer: '', reason: '' })
  const [error, setError] = useState<string | null>(null)

  const articles = useQuery({
    queryKey: ['ai', 'knowledge'],
    queryFn: () => knowledgeApi.list().then((r) => r.articles),
  })

  const refresh = () => void qc.invalidateQueries({ queryKey: ['ai', 'knowledge'] })

  const create = useMutation({
    mutationFn: () => knowledgeApi.create(form),
    onSuccess: () => {
      setForm({ title: '', question: '', answer: '', reason: '' })
      setError(null)
      refresh()
    },
    onError: (e: Error) => setError(e.message),
  })

  const approve = useMutation({
    mutationFn: (a: KnowledgeArticle) => knowledgeApi.approve(a.id, 'reviewed and approved'),
    onSuccess: refresh,
    onError: (e: Error) => setError(e.message),
  })

  const retire = useMutation({
    // Retire, never delete: an answer that cited this article must still
    // resolve to the words it quoted.
    mutationFn: (a: KnowledgeArticle) => knowledgeApi.retire(a.id, 'no longer accurate'),
    onSuccess: refresh,
    onError: (e: Error) => setError(e.message),
  })

  if (articles.isLoading) return <LoadingState />
  if (articles.error) return <ErrorState error={articles.error} />

  const rows = articles.data ?? []

  return (
    <div className="page">
      <h1>Approved knowledge</h1>
      <p className="page__lead">
        The assistant answers only from these. Anything not written here, it does not know.
      </p>

      {canManage && (
        <form
          className="knowledge__form"
          onSubmit={(e) => {
            e.preventDefault()
            create.mutate()
          }}
        >
          <input
            placeholder="Title"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            required
          />
          <input
            placeholder="The question, in the words a family would use"
            value={form.question}
            onChange={(e) => setForm({ ...form, question: e.target.value })}
            required
          />
          <textarea
            placeholder="The approved answer. These exact words may reach a family."
            rows={3}
            value={form.answer}
            onChange={(e) => setForm({ ...form, answer: e.target.value })}
            required
          />
          {/* Mandatory, as every sensitive change in this system is: a change
              nobody explained is a change nobody can review. */}
          <input
            placeholder="Why are you adding this?"
            value={form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value })}
            required
          />
          <button type="submit" className="btn btn--primary" disabled={create.isPending}>
            Save as draft
          </button>
        </form>
      )}

      {error && <p className="assistant__error">{error}</p>}

      {rows.length === 0 ? (
        <EmptyState title="No knowledge yet. The assistant will decline every question until there is." />
      ) : (
        <ul className="knowledge__list">
          {rows.map((a) => (
            <li key={a.id} className="knowledge__item">
              <div>
                <strong>{a.title}</strong>
                <Badge tone={a.status === 'approved' ? 'ok' : 'neutral'}>{a.status}</Badge>
                <span className="knowledge__version">v{a.version}</span>
                <p className="knowledge__q">{a.question}</p>
                <p className="knowledge__a">{a.answer}</p>
              </div>
              {canApprove && (
                <div className="knowledge__actions">
                  {a.status !== 'approved' && (
                    <button type="button" className="btn btn--primary" onClick={() => approve.mutate(a)}>
                      Approve
                    </button>
                  )}
                  {a.status === 'approved' && (
                    <button type="button" className="btn" onClick={() => retire.mutate(a)}>
                      Retire
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
