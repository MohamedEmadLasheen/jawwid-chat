import { useState } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { QueryBoundary } from '@/shared/components/States'
import { Badge } from '@/shared/components/Badge'
import type { Story, StoryAudienceClause } from '@/core/api/endpoints'
import { AudiencePicker } from './AudiencePicker'
import {
  useCreateStory,
  useDeleteStory,
  usePublishStory,
  useStories,
  useStoryViewers,
  uploadStoryMedia,
} from './hooks'

/**
 * Stories — compose, publish, and see what happened.
 *
 * ## What this page does NOT decide
 *
 * Whether the operator may publish. The nav already gated the route by role, and
 * that gate is UX: every call behind this page is authorized server-side, so a
 * role that reached the URL anyway gets a 403 and sees the server's message. The
 * page therefore renders its controls and lets the server answer, rather than
 * second-guessing it (docs/qa/rbac-matrix.md: "A UI-only restriction is a defect,
 * not a control").
 *
 * Which stories exist. The list comes from `/stories`, already scoped to the
 * operator's organization.
 *
 * ## Why publish is a second, explicit step
 *
 * Creating a story only validates its audience; publishing resolves that audience
 * into people and starts the 24-hour clock. Collapsing them into one button would
 * mean an operator finds out how many families they just reached only afterwards.
 * Here the draft's resolved size is shown before anyone commits.
 */
export function StoriesPage() {
  const { t, date } = useI18n()
  const [viewersFor, setViewersFor] = useState<string | null>(null)

  const query = useStories(true)
  const publish = usePublishStory()
  const remove = useDeleteStory()

  return (
    <div className="page">
      <h1 className="page__title">{t('nav.stories')}</h1>

      <StoryComposer />

      <QueryBoundary
        isLoading={query.isLoading}
        error={query.error}
        isEmpty={query.stories.length === 0}
        emptyTitle={t('story.empty')}
        onRetry={() => void query.refetch()}
      >
        <ul className="card" aria-label={t('nav.stories')}>
          {query.stories.map((story) => (
            <li key={story.id} className="row">
              <div>
                <strong>{story.title || t('story.untitled')}</strong>
                <StoryStateBadge story={story} />
                {story.body && <p>{story.body}</p>}
                {story.media_kind && <span>{t(`story.media.${story.media_kind}` as 'story.media.image')}</span>}

                <p>
                  {/* Counts, never names. Opening the viewer list is a separate,
                      deliberate act — see useStoryViewers. */}
                  {t('story.delivered')}: {story.recipientCount} · {t('story.viewed')}:{' '}
                  {story.viewCount}
                </p>
                {story.expiresAt && (
                  <p>
                    {t('story.expires')}: {date(story.expiresAt)}
                  </p>
                )}
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                {story.state === 'draft' && (
                  <button
                    type="button"
                    onClick={() => publish.mutate(story.id)}
                    disabled={publish.isPending}
                  >
                    {t('story.publish')}
                  </button>
                )}
                {story.state === 'published' && (
                  <button type="button" onClick={() => setViewersFor(story.id)}>
                    {t('story.viewers')}
                  </button>
                )}
                {story.state !== 'deleted' && (
                  <DeleteStoryButton
                    onConfirm={(reason) => remove.mutate({ id: story.id, reason })}
                    pending={remove.isPending}
                  />
                )}
              </div>
            </li>
          ))}
        </ul>
      </QueryBoundary>

      {viewersFor && <ViewerList storyId={viewersFor} onClose={() => setViewersFor(null)} />}
    </div>
  )
}

function StoryStateBadge({ story }: { story: Story }) {
  const { t } = useI18n()
  // `published` is only meaningful together with the clock: a story whose
  // expires_at has passed is already unreadable to its audience even if the sweep
  // has not relabelled it yet, and showing it as live would be a lie.
  const past = story.expiresAt !== null && new Date(story.expiresAt) <= new Date()
  const state = story.state === 'published' && past ? 'expired' : story.state
  return <Badge>{t(`story.state.${state}` as 'story.state.draft')}</Badge>
}

function StoryComposer() {
  const { t } = useI18n()
  const create = useCreateStory()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [audiences, setAudiences] = useState<StoryAudienceClause[]>([])
  const [media, setMedia] = useState<
    { mediaObjectKey: string; mediaKind: string; mediaMime: string } | null
  >(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const canSubmit =
    audiences.length > 0 && (body.trim().length > 0 || media !== null) && !create.isPending

  async function onPickFile(file: File | undefined) {
    if (!file) return
    setUploadError(null)
    setUploading(true)
    try {
      setMedia(await uploadStoryMedia(file))
    } catch (e) {
      // Shown, not swallowed: a failed upload that looked like a success is how
      // an operator publishes a story with no picture in it.
      setUploadError(e instanceof Error ? e.message : t('story.uploadFailed'))
      setMedia(null)
    } finally {
      setUploading(false)
    }
  }

  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault()
        if (!canSubmit) return
        create.mutate(
          {
            title: title.trim() || undefined,
            body: body.trim() || undefined,
            ...(media ?? {}),
            audiences,
          },
          {
            onSuccess: () => {
              setTitle('')
              setBody('')
              setAudiences([])
              setMedia(null)
            },
          },
        )
      }}
    >
      <h2>{t('story.compose')}</h2>

      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t('story.title')}
        aria-label={t('story.title')}
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={t('story.body')}
        aria-label={t('story.body')}
        maxLength={2000}
      />

      <div>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,video/mp4,video/quicktime,video/webm"
          aria-label={t('story.media')}
          onChange={(e) => void onPickFile(e.target.files?.[0])}
        />
        {uploading && <span role="status">{t('story.uploading')}</span>}
        {media && <span role="status">{t('story.mediaReady')}</span>}
        {uploadError && <p role="alert">{uploadError}</p>}
      </div>

      <AudiencePicker value={audiences} onChange={setAudiences} disabled={create.isPending} />

      {create.error && <p role="alert">{String((create.error as Error).message)}</p>}

      <button type="submit" disabled={!canSubmit}>
        {t('story.saveDraft')}
      </button>
    </form>
  )
}

/**
 * Who viewed a story.
 *
 * Display names and times, which is all the server returns — the Actor contract
 * carries no phone number or email, so none can appear here however this is
 * rendered.
 */
function ViewerList({ storyId, onClose }: { storyId: string; onClose: () => void }) {
  const { t, date } = useI18n()
  const query = useStoryViewers(storyId)

  return (
    <div className="card" role="dialog" aria-label={t('story.viewers')}>
      <h2>{t('story.viewers')}</h2>
      <QueryBoundary
        isLoading={query.isLoading}
        error={query.error}
        isEmpty={(query.data ?? []).length === 0}
        emptyTitle={t('story.noViewers')}
        onRetry={() => void query.refetch()}
      >
        <ul>
          {(query.data ?? []).map((v) => (
            <li key={v.actorId}>
              {v.displayName} · {date(v.viewedAt)}
            </li>
          ))}
        </ul>
      </QueryBoundary>
      <button type="button" onClick={onClose}>
        {t('story.closeViewers')}
      </button>
    </div>
  )
}

/**
 * Deleting a story needs a reason, because the server requires one and records it
 * in the audit log. The two-step confirm is not decoration: publishing reached
 * real families, and un-publishing is not undo.
 */
function DeleteStoryButton({
  onConfirm,
  pending,
}: {
  onConfirm: (reason: string) => void
  pending: boolean
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}>
        {t('story.delete')}
      </button>
    )
  }

  return (
    <span style={{ display: 'flex', gap: 4 }}>
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={t('story.deleteReason')}
        aria-label={t('story.deleteReason')}
      />
      <button
        type="button"
        disabled={reason.trim().length === 0 || pending}
        onClick={() => {
          onConfirm(reason.trim())
          setOpen(false)
          setReason('')
        }}
      >
        {t('story.confirmDelete')}
      </button>
      <button type="button" onClick={() => setOpen(false)}>
        {t('common.cancel')}
      </button>
    </span>
  )
}
