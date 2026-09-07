import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { storyApi, type AudienceClause } from '@/core/api/phase5'
import { groupApi, labelApi } from '@/core/api/directory'
import { qk } from '@/core/api/queryKeys'
import { useSession } from '@/core/auth/SessionProvider'
import { hasPermission } from '@/core/permissions/capabilities'
import { EmptyState, ErrorState, LoadingState } from '@/shared/components/States'
import { Badge } from '@/shared/components/Badge'
import { AudiencePicker, describe } from './AudiencePicker'

/**
 * STORIES -- compose, choose an audience, publish.
 *
 * Publishing is `stories.publish`, held by admin, manager and super_admin. The
 * check here is `hasPermission` against the actor's EFFECTIVE permissions, so a
 * per-account DENY hides the control for one person without inventing a role
 * for them -- and the server refuses the request regardless of what this
 * decides. Hiding the button is courtesy; the refusal is the boundary.
 *
 * Note the two-step: CREATE writes a draft with its audience validated, and
 * PUBLISH resolves that audience to people and goes live. They are separate
 * because resolution is a SNAPSHOT: a draft written on Monday and published on
 * Thursday should reach Thursday's families, not Monday's.
 */
export function StoriesPage() {
  const qc = useQueryClient()
  const { permissions, staff } = useSession()
  const canPublish = hasPermission(permissions, 'stories.publish')
  // Only an organization-wide role may address the whole academy. Presentation
  // only; the server enforces it.
  const canTargetEveryone = staff?.role === 'manager' || staff?.role === 'super_admin'

  const stories = useQuery({ queryKey: qk.stories, queryFn: () => storyApi.list() })
  const labels = useQuery({ queryKey: qk.labels, queryFn: () => labelApi.list().then((r) => r.labels) })
  const groups = useQuery({
    queryKey: qk.groups(false),
    queryFn: () => groupApi.list(false).then((r) => r.groups),
  })

  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [audiences, setAudiences] = useState<AudienceClause[]>([])
  const [error, setError] = useState<string | null>(null)

  const refresh = () => void qc.invalidateQueries({ queryKey: qk.stories })

  const create = useMutation({
    mutationFn: () => storyApi.create({ title, body, audiences }),
    onSuccess: () => {
      setTitle('')
      setBody('')
      setAudiences([])
      setError(null)
      refresh()
    },
    onError: (e: Error) => setError(e.message),
  })

  const publish = useMutation({
    mutationFn: (id: string) => storyApi.publish(id),
    onSuccess: refresh,
    onError: (e: Error) => setError(e.message),
  })

  if (stories.isLoading) return <LoadingState />
  if (stories.isError) return <ErrorState error={stories.error} onRetry={refresh} />

  const labelOptions = (labels.data ?? []).map((l) => ({ id: l.id, name: l.name }))
  const groupOptions = (groups.data ?? []).map((g) => ({ id: g.id, name: g.name }))

  return (
    <section className="page">
      <header className="page__header">
        <h1>Stories</h1>
      </header>

      {canPublish && (
        <form
          className="card"
          onSubmit={(e) => {
            e.preventDefault()
            create.mutate()
          }}
        >
          <h2>New story</h2>
          <label>
            <span>Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label>
            <span>Body</span>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} />
          </label>

          <AudiencePicker
            value={audiences}
            onChange={setAudiences}
            labels={labelOptions}
            groups={groupOptions}
            canTargetEveryone={canTargetEveryone}
          />

          {error && <p role="alert" className="error">{error}</p>}

          <button
            type="submit"
            disabled={create.isPending || audiences.length === 0 || body.trim() === ''}
          >
            Save draft
          </button>
        </form>
      )}

      {stories.data && stories.data.length === 0 ? (
        <EmptyState title="No stories yet." />
      ) : (
        <ul className="list" aria-label="Stories">
          {(stories.data ?? []).map((story) => (
            <li key={story.id} className="card">
              <div className="card__row">
                <strong>{story.title ?? '(untitled)'}</strong>
                <Badge tone={story.state === 'published' ? 'ok' : 'neutral'}>
                  {story.state}
                </Badge>
              </div>
              {story.body && <p>{story.body}</p>}

              {/*
                The AUTHORED intent, kept alongside the counts, because
                "this went to 412 people" is not an answer to "who did you send
                this to?".
              */}
              {story.audiences && story.audiences.length > 0 && (
                <p className="muted">
                  {story.audiences
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

              {story.state === 'published' && (
                <p className="muted">
                  {story.recipientCount ?? 0} recipients · {story.viewCount ?? 0} views
                  {story.expiresAt && ` · expires ${new Date(story.expiresAt).toLocaleString()}`}
                </p>
              )}

              {canPublish && story.state === 'draft' && (
                <button
                  type="button"
                  onClick={() => publish.mutate(story.id)}
                  disabled={publish.isPending}
                >
                  Publish
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
