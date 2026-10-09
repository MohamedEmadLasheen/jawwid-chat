import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useI18n } from '@/core/i18n/I18nProvider'
import { QueryBoundary } from '@/shared/components/States'
import { avatarApi, uploadAvatar, type MyAvatar } from './api'

/**
 * The signed-in staff member's profile photo, and nothing else.
 *
 * Deliberately a SLICE, not an account screen. Staff management, permissions and
 * notification settings are separate concerns; this page exists because a group chat shows
 * the sender's face and an admin had no way to have one. Everything it needs is the photo.
 *
 * Built from the console's existing vocabulary -- `page`, `card`, `btn`, `state`,
 * `QueryBoundary` -- rather than a second look. The only new rule is `.avatar`, because the
 * console had never had to draw a person before.
 *
 * The URL it renders is a short-lived signed URL. It is never stored and never treated as
 * identity: both mutations invalidate the query so the next paint uses a URL the server has
 * just signed, rather than one this response happened to carry.
 */

const QUERY_KEY = ['me', 'avatar'] as const

/** Mirrors the server's rule. A client check is a convenience; the server is the control. */
const ACCEPTED = 'image/jpeg,image/png,image/webp,image/heic'
const MAX_BYTES = 8 * 1024 * 1024

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return parts.slice(0, 2).map((p) => p[0]!.toUpperCase()).join('')
}

export function ProfilePage() {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const fileInput = useRef<HTMLInputElement>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const query = useQuery({ queryKey: QUERY_KEY, queryFn: () => avatarApi.mine() })

  const settled = (next: MyAvatar) => {
    setProblem(null)
    queryClient.setQueryData(QUERY_KEY, next)
    void queryClient.invalidateQueries({ queryKey: QUERY_KEY })
  }

  const upload = useMutation({
    mutationFn: (file: File) => uploadAvatar(file),
    onSuccess: settled,
    onError: () => setProblem(t('profile.photo.uploadFailed')),
  })

  const remove = useMutation({
    mutationFn: () => avatarApi.remove(),
    onSuccess: settled,
    onError: () => setProblem(t('profile.photo.removeFailed')),
  })

  const busy = upload.isPending || remove.isPending

  function choose(file: File | undefined) {
    setProblem(null)
    // Cancelling the picker is not a failure and must say nothing.
    if (!file) return
    if (file.size > MAX_BYTES) {
      setProblem(t('profile.photo.tooLarge'))
      return
    }
    upload.mutate(file)
  }

  return (
    <div className="page">
      <h1 className="page__title">{t('profile.photo.title')}</h1>

      <QueryBoundary
        isLoading={query.isLoading}
        error={query.error}
        onRetry={() => void query.refetch()}
      >
        {query.data ? (
          <div className="card">
            <p className="profile__hint">{t('profile.photo.hint')}</p>

            <div className="profile__identity">
              {query.data.avatarUrl ? (
                <img
                  className="avatar avatar--lg"
                  src={query.data.avatarUrl}
                  alt={t('profile.photo.alt', { name: query.data.displayName })}
                  width={96}
                  height={96}
                />
              ) : (
                // Initials, never a generic silhouette: a list of people without photos
                // should still be a list of distinguishable people.
                <span
                  className="avatar avatar--lg avatar--initials"
                  role="img"
                  aria-label={t('profile.photo.none', { name: query.data.displayName })}
                >
                  {initialsOf(query.data.displayName)}
                </span>
              )}
              <div>
                <div className="profile__name">{query.data.displayName}</div>
                {busy ? (
                  <div className="profile__status" aria-live="polite">
                    {t('profile.photo.working')}
                  </div>
                ) : null}
              </div>
            </div>

            <input
              ref={fileInput}
              type="file"
              accept={ACCEPTED}
              hidden
              onChange={(event) => {
                choose(event.target.files?.[0])
                // Reset, so picking the same file twice still fires a change.
                event.target.value = ''
              }}
            />

            <div className="profile__actions">
              <button
                type="button"
                className="btn btn--primary"
                disabled={busy}
                onClick={() => fileInput.current?.click()}
              >
                {query.data.avatarUrl
                  ? t('profile.photo.change')
                  : t('profile.photo.add')}
              </button>

              {query.data.avatarUrl ? (
                <button
                  type="button"
                  className="btn btn--ghost"
                  disabled={busy}
                  onClick={() => remove.mutate()}
                >
                  {t('profile.photo.remove')}
                </button>
              ) : null}
            </div>

            {problem ? (
              <div className="banner banner--danger" role="alert">
                {problem}
              </div>
            ) : null}
          </div>
        ) : null}
      </QueryBoundary>
    </div>
  )
}
