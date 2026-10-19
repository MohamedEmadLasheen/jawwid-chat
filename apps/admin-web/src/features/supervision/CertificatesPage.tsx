import { useState } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Badge } from '@/shared/components/Badge'
import { FilterChips } from '@/shared/components/FilterChips'
import { PageHeader } from '@/shared/components/PageHeader'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import { useCalendarDate } from '@/features/teacher-files/calendar'
import type { Certificate, CertificateState } from './api'
import { S, describeError, isSupervisionRefusal, useCopy } from './copy'
import { useCertificates } from './hooks'
import { DeclineCertificateDialog, IssueCertificateDialog } from './SupervisionDialogs'
import { TeachersTabs } from './TeachersTabs'
import './supervision.css'

type Filter = CertificateState | 'all'

/**
 * PD-12: the Certificates page. Opens on what is waiting, oldest first; each
 * row is issued (the file goes to the student's group) or declined (the reason
 * goes to the teacher, privately).
 */
export function CertificatesPage({ basePath, eyebrow }: { basePath: string; eyebrow?: string }) {
  const tx = useCopy()
  const { locale, dateTime } = useI18n()
  const cal = useCalendarDate()
  const [filter, setFilter] = useState<Filter>('requested')
  const list = useCertificates(filter === 'all' ? undefined : filter)
  const [issuing, setIssuing] = useState<Certificate | null>(null)
  const [declining, setDeclining] = useState<Certificate | null>(null)
  const rows = list.data?.certificates ?? []

  const stateLabel = (s: CertificateState) =>
    s === 'requested' ? tx(S.stateRequested) : s === 'issued' ? tx(S.stateIssued) : tx(S.stateDeclined)
  const stateTone = (s: CertificateState) => (s === 'requested' ? 'warn' : s === 'issued' ? 'ok' : 'outline')

  return (
    <div className="page">
      <div className="page__inner">
        <PageHeader eyebrow={eyebrow} title={tx(S.certTitle)} subtitle={tx(S.certSubtitle)} />
        <TeachersTabs basePath={basePath} />
        {isSupervisionRefusal(list.error) ? (
          <EmptyState icon="lock" title={describeError(list.error, locale)} />
        ) : (
          <>
            <div className="toolbar">
              <FilterChips<Filter>
                label={tx(S.certTitle)}
                value={filter}
                onChange={setFilter}
                options={[
                  { value: 'requested', label: tx(S.stateRequested) },
                  { value: 'issued', label: tx(S.stateIssued) },
                  { value: 'declined', label: tx(S.stateDeclined) },
                  { value: 'all', label: tx(S.stateAll) },
                ]}
              />
            </div>
            <QueryBoundary isLoading={list.isLoading} error={list.error} onRetry={() => void list.refetch()}>
              {rows.length === 0 ? (
                <EmptyState title={tx(S.noCertificates)} />
              ) : (
                <div className="table-wrap sv-table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th scope="col">{tx(S.certificate)}</th>
                        <th scope="col">{tx(S.student)}</th>
                        <th scope="col">{tx(S.teacher)}</th>
                        <th scope="col">{tx(S.requested)}</th>
                        <th scope="col">
                          <span className="sr-only">{tx(S.issue)}</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((c) => (
                        <tr key={c.id}>
                          <td>
                            <div className="sv-cell-main">
                              <strong dir="auto">{c.title}</strong>
                              <span dir="auto">{c.achievement}</span>
                              <span className="sv-muted">
                                {tx(S.achievedOn)}: {cal.day(c.achievedOn)}
                                {c.grade ? ` · ${tx(S.grade)}: ${c.grade}` : ''}
                              </span>
                              {c.note && (
                                <span className="sv-muted" dir="auto">
                                  {tx(S.teacherNote)}: {c.note}
                                </span>
                              )}
                              {c.declineReason && (
                                <span className="sv-muted" dir="auto">
                                  {tx(S.declinedBecause, { reason: c.declineReason })}
                                </span>
                              )}
                            </div>
                          </td>
                          <td dir="auto">{c.learner.name}</td>
                          <td dir="auto">{c.teacher.name}</td>
                          <td>{dateTime(c.requestedAt)}</td>
                          <td>
                            {c.state === 'requested' ? (
                              <div className="sv-actions">
                                <button
                                  type="button"
                                  className="btn btn--primary btn--sm"
                                  disabled={c.canDeliver === false}
                                  title={c.canDeliver === false ? tx(S.noGroup) : undefined}
                                  onClick={() => setIssuing(c)}
                                >
                                  {tx(S.issue)}
                                </button>
                                <button type="button" className="btn btn--ghost btn--sm" onClick={() => setDeclining(c)}>
                                  {tx(S.decline)}
                                </button>
                                {c.canDeliver === false && <span className="sv-muted">{tx(S.noGroup)}</span>}
                              </div>
                            ) : (
                              <Badge tone={stateTone(c.state)} dot>
                                {stateLabel(c.state)}
                              </Badge>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </QueryBoundary>
          </>
        )}
        {issuing && <IssueCertificateDialog certificate={issuing} onClose={() => setIssuing(null)} />}
        {declining && <DeclineCertificateDialog certificate={declining} onClose={() => setDeclining(null)} />}
      </div>
    </div>
  )
}
