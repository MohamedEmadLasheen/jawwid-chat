import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { FilterChips } from '@/shared/components/FilterChips'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import { teacherFilePath } from '@/features/supervision/TeachersTabs'
import { useOpensTeacherFiles } from '@/features/teacher-files/hooks'
import type { FeedbackCategory, FeedbackStatus, StaffFeedback } from './api'
import { F, describeFeedbackError, useCopy } from './copy'
import { FeedbackItem, ReplyDialog } from './FeedbackParts'
import { useParentFeedback, useTakeFeedback } from './hooks'
import { SectionIntro } from './SectionIntro'

type CategoryFilter = 'all' | FeedbackCategory
type StatusFilter = 'all' | FeedbackStatus

/** PD-32 on the Teacher Supervision page: every parent's feedback, with Take and Reply. */
export function ParentFeedbackSection({ basePath }: { basePath: string }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const [category, setCategory] = useState<CategoryFilter>('all')
  const [status, setStatus] = useState<StatusFilter>('all')
  const list = useParentFeedback({ ...(category !== 'all' ? { category } : {}), ...(status !== 'all' ? { status } : {}) })
  const take = useTakeFeedback()
  // PD-26 amendment: an Operations supervisor sees the teacher's name, not a Teacher File link.
  const opensFiles = useOpensTeacherFiles()
  const [replying, setReplying] = useState<StaffFeedback | null>(null)
  const canWrite = list.data?.canWrite ?? false
  const rows = list.data?.feedback ?? []

  return (
    <>
      <SectionIntro hint={tx(F.hint)} />
      <div className="toolbar th-filters">
        <FilterChips<CategoryFilter>
          label={tx(F.category)}
          value={category}
          onChange={setCategory}
          options={[
            { value: 'all', label: tx(F.allCategories) },
            { value: 'praise', label: tx(F.praise) },
            { value: 'suggestion', label: tx(F.suggestion) },
            { value: 'complaint', label: tx(F.complaint) },
          ]}
        />
        <FilterChips<StatusFilter>
          label={tx(F.status)}
          value={status}
          onChange={setStatus}
          options={[
            { value: 'all', label: tx(F.allStatuses) },
            { value: 'received', label: tx(F.received) },
            { value: 'in_review', label: tx(F.in_review) },
            { value: 'resolved', label: tx(F.resolved) },
          ]}
        />
      </div>
      {take.error ? (
        <div className="banner banner--danger" role="alert">
          {describeFeedbackError(take.error, locale)}
        </div>
      ) : null}
      {list.error ? (
        <EmptyState icon="lock" title={describeFeedbackError(list.error, locale)} />
      ) : (
        <QueryBoundary isLoading={list.isLoading} error={null} onRetry={() => void list.refetch()}>
          {rows.length === 0 ? (
            <EmptyState title={tx(F.empty)} />
          ) : (
            <ul className="tf-entries th-complaints">
              {rows.map((f) => (
                <FeedbackItem
                  key={f.id}
                  feedback={f}
                  teacherHref={opensFiles ? teacherFilePath(basePath, f.teacher.id) : undefined}
                  actions={
                    canWrite && (
                      <>
                        {f.status === 'received' && (
                          <button type="button" className="btn btn--sm" disabled={take.isPending} onClick={() => take.mutate(f.id)}>
                            {tx(F.take)}
                          </button>
                        )}
                        <button type="button" className="btn btn--primary btn--sm" onClick={() => setReplying(f)}>
                          {f.response ? tx(F.changeReply) : tx(F.reply)}
                        </button>
                      </>
                    )
                  }
                />
              ))}
            </ul>
          )}
        </QueryBoundary>
      )}
      {replying && (
        <ReplyDialog
          feedbackId={replying.id}
          category={replying.category}
          parentName={replying.parent.name}
          current={replying.response}
          links={
            <div className="th-actions">
              {opensFiles && (
                <Link className="btn btn--sm btn--ghost" to={teacherFilePath(basePath, replying.teacher.id)}>
                  {tx(F.openTeacherFile)}
                </Link>
              )}
              <Link className="btn btn--sm btn--ghost" to={{ search: '?section=complaints' }} onClick={() => setReplying(null)}>
                {tx(F.openComplaints)}
              </Link>
            </div>
          }
          onClose={() => setReplying(null)}
        />
      )}
    </>
  )
}
