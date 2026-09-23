import { useState } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { EmptyState, ErrorState, LoadingState } from '@/shared/components/States'
import { Badge } from '@/shared/components/Badge'
import { useAnnouncements, useCancelAnnouncement, usePublishAnnouncement } from './hooks'
import { CreateAnnouncementDialog } from './CreateAnnouncementDialog'
import type { AnnouncementRow } from '@/core/api/endpoints'

/**
 * Academy announcements.
 *
 * Two states an operator needs to tell apart at a glance, and the page is built
 * around them: a DRAFT has gone nowhere and can still be edited by deleting and
 * rewriting it, and a PUBLISHED one has been handed to the notification engine
 * and has reached people. `recipient_count` is how many; until the worker's
 * sweep runs it is blank, and the page says "sending" rather than pretending to
 * a number it does not have.
 */
export function AnnouncementsPage() {
  const { t } = useI18n()
  const [composing, setComposing] = useState(false)
  const { announcements, isLoading, isError, refetch, hasNextPage, fetchNextPage } =
    useAnnouncements()

  return (
    <section className="page">
      <header className="page__header">
        <h1>{t('announcements.title')}</h1>
        <button
          type="button"
          className="button button--primary"
          onClick={() => setComposing(true)}
        >
          {t('announcements.create')}
        </button>
      </header>

      {isLoading && <LoadingState />}
      {isError && <ErrorState error={null} onRetry={() => void refetch()} />}

      {!isLoading && !isError && announcements.length === 0 && (
        <EmptyState title={t('announcements.empty')} />
      )}

      {announcements.length > 0 && (
        <ul className="list">
          {announcements.map((announcement) => (
            <AnnouncementItem key={announcement.id} announcement={announcement} />
          ))}
        </ul>
      )}

      {hasNextPage && (
        <button type="button" className="button" onClick={() => void fetchNextPage()}>
          {t('common.loadMore')}
        </button>
      )}

      {composing && <CreateAnnouncementDialog onClose={() => setComposing(false)} />}
    </section>
  )
}

function AnnouncementItem({ announcement }: { announcement: AnnouncementRow }) {
  const { t, dateTime } = useI18n()
  const publish = usePublishAnnouncement()
  const cancel = useCancelAnnouncement()
  const [confirming, setConfirming] = useState(false)

  const isDraft = announcement.status === 'draft'
  const isPublished = announcement.status === 'published'

  const audience = t(
    `announcements.audience.${
      announcement.target_type === 'all_parents'
        ? 'allParents'
        : announcement.target_type === 'all_teachers'
          ? 'allTeachers'
          : announcement.target_type === 'all_staff'
            ? 'allStaff'
            : 'selected'
    }` as Parameters<typeof t>[0],
  )

  return (
    <li className="list__item">
      <div className="list__main">
        <div className="list__title">
          <strong dir="rtl">{announcement.title_ar}</strong>
          {announcement.priority === 'urgent' && (
            <Badge tone="danger">{t('announcements.priority.urgent')}</Badge>
          )}
          {announcement.priority === 'important' && (
            <Badge tone="today">{t('announcements.priority.important')}</Badge>
          )}
          {isDraft && <Badge tone="neutral">{t('announcements.status.draft')}</Badge>}
          {announcement.status === 'cancelled' && (
            <Badge tone="neutral">{t('announcements.status.cancelled')}</Badge>
          )}
        </div>

        <p className="list__body" dir="rtl">
          {announcement.body_ar}
        </p>

        <p className="list__meta">
          {audience}
          {announcement.target_type.startsWith('all_') ? null : ` · ${announcement.target_count}`}
          {announcement.created_by_name && ` · ${announcement.created_by_name}`}
          {` · ${dateTime(announcement.created_at)}`}
          {isPublished && (
            <>
              {' · '}
              {announcement.recipient_count == null
                ? // Published, but the worker has not fanned it out yet. Saying
                  // "0 recipients" would read as a failure; this is a moment.
                  t('announcements.sending')
                : t('announcements.reached', { count: announcement.recipient_count })}
            </>
          )}
        </p>
      </div>

      <div className="list__actions">
        {isDraft && !confirming && (
          <button
            type="button"
            className="button button--primary"
            onClick={() => setConfirming(true)}
          >
            {t('announcements.publish')}
          </button>
        )}

        {isDraft && confirming && (
          <>
            {/*
              One confirmation, with the reach spelled out. Publishing hands this
              to the notification engine, which fans it out to every recipient;
              cancelling afterwards stops future fan-out and does NOT retract what
              was already sent, because a parent who was told something was told
              it.
            */}
            <span className="list__confirm">
              {t('announcements.confirmPublish', { audience })}
            </span>
            <button
              type="button"
              className="button button--primary"
              disabled={publish.isPending}
              onClick={() => void publish.mutateAsync(announcement.id)}
            >
              {t('announcements.publish')}
            </button>
            <button type="button" className="button" onClick={() => setConfirming(false)}>
              {t('common.cancel')}
            </button>
          </>
        )}

        {(isDraft || isPublished) && !confirming && (
          <button
            type="button"
            className="button"
            disabled={cancel.isPending}
            onClick={() => void cancel.mutateAsync(announcement.id)}
          >
            {t('announcements.cancel')}
          </button>
        )}
      </div>
    </li>
  )
}
