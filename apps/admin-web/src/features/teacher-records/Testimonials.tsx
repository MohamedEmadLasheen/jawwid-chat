import { useId, useState } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Badge } from '@/shared/components/Badge'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import { FilterChips } from '@/shared/components/FilterChips'
import { SearchableSelect } from '@/shared/components/SearchableSelect'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import { useSupervisionDirectory } from '@/features/teacher-files/hooks'
import { FeedbackStatusBadge, ReplyDialog } from '@/features/teacher-supervision/FeedbackParts'
import { describeFeedbackError } from '@/features/teacher-supervision/copy'
import { useTakeFeedback } from '@/features/teacher-supervision/hooks'
import { SectionIntro } from '@/features/teacher-supervision/SectionIntro'
import { TESTIMONIAL_SOURCES, type Testimonial, type TestimonialSource } from './api'
import { R, useCopy, type Pair } from './copy'
import { useRecordTestimonial, useTeacherStudents, useTestimonials, useVoidEntry } from './hooks'

type Origin = 'all' | 'parent' | 'staff'

const SOURCE_LABEL: Record<TestimonialSource, Pair> = {
  parent_message: R.source_parent_message,
  parent_call: R.source_parent_call,
  staff_observation: R.source_staff_observation,
  other: R.source_other,
}

/**
 * PD-52 page B, Testimonials: the parents' praise (PD-32, read in place, never
 * copied) and the testimonials staff record, newest first. Praise is taken and
 * replied to as on the Parent feedback list; a staff testimonial entered by
 * mistake is corrected (hidden, never deleted). `canRecord` is
 * GET /teacher-records/access's grants.record; the server decides each request.
 */
export function TestimonialsSection({ canRecord, teacher, month }: { canRecord: boolean; teacher?: string; month?: string }) {
  const tx = useCopy()
  const { locale, dateTime } = useI18n()
  const [origin, setOrigin] = useState<Origin>('all')
  const [showCorrected, setShowCorrected] = useState(false)
  const list = useTestimonials({ teacher, month, voided: showCorrected })
  const take = useTakeFeedback()
  const [recording, setRecording] = useState(false)
  const [replying, setReplying] = useState<Testimonial | null>(null)
  const [correcting, setCorrecting] = useState<Testimonial | null>(null)
  const checkId = useId()
  const rows = (list.data?.testimonials ?? []).filter((t) => origin === 'all' || t.origin === origin)

  return (
    <>
      <SectionIntro
        hint={tx(R.testimonialsHint)}
        actions={
          canRecord && (
            <button type="button" className="btn btn--sm" onClick={() => setRecording(true)}>
              {tx(R.recordTestimonial)}
            </button>
          )
        }
      />
      <div className="toolbar th-filters">
        <FilterChips<Origin>
          label={tx(R.origin)}
          value={origin}
          onChange={setOrigin}
          options={[
            { value: 'all', label: tx(R.allOrigins) },
            { value: 'parent', label: tx(R.fromParents) },
            { value: 'staff', label: tx(R.fromStaff) },
          ]}
        />
        <label className="th-check" htmlFor={checkId}>
          <input id={checkId} type="checkbox" checked={showCorrected} onChange={(e) => setShowCorrected(e.target.checked)} />
          <span>{tx(R.showCorrected)}</span>
        </label>
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
            <EmptyState title={tx(R.empty)} />
          ) : (
            <ul className="tf-entries th-complaints">
              {rows.map((t) => (
                <li key={`${t.origin}-${t.id}`} className="tf-entry">
                  <div className="tf-entry__head">
                    <Badge tone={t.origin === 'parent' ? 'ok' : 'info'}>{t.origin === 'parent' ? tx(R.parentApp) : tx(R.fromStaff)}</Badge>
                    {t.status && <FeedbackStatusBadge status={t.status} />}
                    {t.source && t.source !== 'parent_app' && <span className="tf-byline">{tx(SOURCE_LABEL[t.source])}</span>}
                    <span className="tf-byline">{dateTime(t.createdAt)}</span>
                  </div>
                  <div className="tf-entry__head">
                    <span dir="auto">{t.teacher.name}</span>
                    {t.child && <span dir="auto">{tx(R.child, { name: t.child.name })}</span>}
                    {t.prospect && <span dir="auto">{tx(R.child, { name: t.prospect.name })}</span>}
                    {t.parent && <span dir="auto">{tx(R.parentBy, { name: t.parent.name })}</span>}
                    {t.author && <span className="tf-muted" dir="auto">{tx(R.by, { name: t.author.name })}</span>}
                  </div>
                  <p className="tf-entry__body" dir="auto">
                    {t.body}
                  </p>
                  {t.voided && (
                    <p className="tf-muted" dir="auto">
                      {tx(R.corrected, { reason: t.voided.body })}
                    </p>
                  )}
                  {canRecord && !t.voided && (
                    <div className="th-actions">
                      {t.origin === 'parent' && t.status === 'received' && (
                        <button type="button" className="btn btn--sm" disabled={take.isPending} onClick={() => take.mutate(t.id)}>
                          {tx(R.take)}
                        </button>
                      )}
                      {t.origin === 'parent' && (
                        <button type="button" className="btn btn--primary btn--sm" onClick={() => setReplying(t)}>
                          {t.response ? tx(R.changeReply) : tx(R.reply)}
                        </button>
                      )}
                      {t.origin === 'staff' && (
                        <button type="button" className="btn btn--sm btn--ghost" onClick={() => setCorrecting(t)}>
                          {tx(R.correct)}
                        </button>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </QueryBoundary>
      )}
      {recording && <RecordTestimonialDialog initialTeacher={teacher ?? ''} onClose={() => setRecording(false)} />}
      {replying && replying.parent && (
        <ReplyDialog
          feedbackId={replying.id}
          category="praise"
          parentName={replying.parent.name}
          current={replying.response}
          onClose={() => setReplying(null)}
        />
      )}
      {correcting && <CorrectDialog entryId={correcting.id} onClose={() => setCorrecting(null)} />}
    </>
  )
}

function RecordTestimonialDialog({ initialTeacher, onClose }: { initialTeacher: string; onClose: () => void }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const directory = useSupervisionDirectory()
  const record = useRecordTestimonial()
  const ids = { teacher: useId(), source: useId(), student: useId(), text: useId() }
  const [teacher, setTeacher] = useState(initialTeacher)
  const [source, setSource] = useState<TestimonialSource | ''>('')
  const [student, setStudent] = useState('')
  const [text, setText] = useState('')
  const [touched, setTouched] = useState(false)
  const students = useTeacherStudents(teacher)
  const missing = { teacher: !teacher, source: !source, text: !text.trim() }

  return (
    <Dialog
      title={tx(R.recordTestimonial)}
      onClose={onClose}
      footer={
        <>
          <DialogCancelButton onClick={onClose} />
          <button
            type="button"
            className="btn btn--primary"
            disabled={record.isPending}
            onClick={() => {
              setTouched(true)
              if (missing.teacher || missing.source || missing.text) return
              record.mutate(
                { teacherId: teacher, body: text.trim(), source: source as TestimonialSource, ...(student ? { learnerId: student } : {}) },
                { onSuccess: onClose },
              )
            }}
          >
            {record.isPending ? '…' : tx(R.recordTestimonial)}
          </button>
        </>
      }
    >
      {record.error ? (
        <div className="banner banner--danger" role="alert">
          {describeFeedbackError(record.error, locale)}
        </div>
      ) : null}
      <div className="field">
        <label className="field__label" htmlFor={ids.teacher}>
          {tx(R.teacher)}
        </label>
        <SearchableSelect
          id={ids.teacher}
          className="input"
          value={teacher}
          onValueChange={(v) => {
            setTeacher(v)
            setStudent('')
          }}
        >
          <option value="">—</option>
          {(directory.data?.teachers ?? [])
            .filter((t) => t.isActive)
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
        </SearchableSelect>
        {touched && missing.teacher && <p className="field__error">{tx(R.required)}</p>}
      </div>
      <div className="field">
        <label className="field__label" htmlFor={ids.source}>
          {tx(R.source)}
        </label>
        <SearchableSelect id={ids.source} className="input" value={source} onValueChange={(v) => setSource(v as TestimonialSource | '')}>
          <option value="">—</option>
          {TESTIMONIAL_SOURCES.map((s) => (
            <option key={s} value={s}>
              {tx(SOURCE_LABEL[s])}
            </option>
          ))}
        </SearchableSelect>
        {touched && missing.source && <p className="field__error">{tx(R.required)}</p>}
      </div>
      <div className="field">
        <label className="field__label" htmlFor={ids.student}>
          {tx(R.student)}
        </label>
        <SearchableSelect id={ids.student} className="input" value={student} disabled={!teacher} onValueChange={(v) => setStudent(v)}>
          <option value="">—</option>
          {(students.data?.students ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </SearchableSelect>
      </div>
      <div className="field">
        <label className="field__label" htmlFor={ids.text}>
          {tx(R.text)}
        </label>
        <textarea id={ids.text} className="input" rows={4} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} dir="auto" />
        {touched && missing.text && <p className="field__error">{tx(R.required)}</p>}
      </div>
    </Dialog>
  )
}

/** A complaint or testimonial entered by mistake: hidden with a reason, never deleted. Once. */
export function CorrectDialog({ entryId, onClose }: { entryId: string; onClose: () => void }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const correct = useVoidEntry()
  const id = useId()
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  return (
    <Dialog
      title={tx(R.correctTitle)}
      onClose={onClose}
      footer={
        <>
          <DialogCancelButton onClick={onClose} />
          <button
            type="button"
            className="btn btn--primary"
            disabled={correct.isPending}
            onClick={() => {
              setTouched(true)
              if (!reason.trim()) return
              correct.mutate({ id: entryId, reason: reason.trim() }, { onSuccess: onClose })
            }}
          >
            {correct.isPending ? '…' : tx(R.correct)}
          </button>
        </>
      }
    >
      <p className="field__hint">{tx(R.correctHint)}</p>
      {correct.error ? (
        <div className="banner banner--danger" role="alert">
          {describeFeedbackError(correct.error, locale)}
        </div>
      ) : null}
      <div className="field">
        <label className="field__label" htmlFor={id}>
          {tx(R.reason)}
        </label>
        <textarea id={id} className="input" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} dir="auto" />
        {touched && !reason.trim() && <p className="field__error">{tx(R.required)}</p>}
      </div>
    </Dialog>
  )
}
