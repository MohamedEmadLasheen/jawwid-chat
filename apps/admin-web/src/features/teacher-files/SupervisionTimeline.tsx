import { useId, useMemo, useState } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Badge, type Tone } from '@/shared/components/Badge'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import { FilterChips } from '@/shared/components/FilterChips'
import type { TimelineItem } from './api'
import { T, describeError, useCopy, type Pair } from './copy'
import { useCalendarDate } from './calendar'
import { useAddNote, useRecordBonus, useSupervisionTimeline } from './hooks'

type Filter = 'all' | 'recognition' | 'concerns' | 'lessons' | 'moves'

const KIND: Record<string, { label: Pair; tone: Tone; filter: Exclude<Filter, 'all'> }> = {
  bonus: { label: T.tBonus, tone: 'ok', filter: 'recognition' },
  note: { label: T.tNote, tone: 'info', filter: 'recognition' },
  monthly_comment: { label: T.tMonthly, tone: 'info', filter: 'recognition' },
  complaint: { label: T.tComplaint, tone: 'warn', filter: 'concerns' },
  complaint_resolution: { label: T.tResolution, tone: 'ok', filter: 'concerns' },
  complaint_followup: { label: T.tFollowUp, tone: 'info', filter: 'concerns' },
  teacher_apology: { label: T.tTeacherApology, tone: 'warn', filter: 'lessons' },
  teacher_no_show: { label: T.tTeacherNoShow, tone: 'danger', filter: 'lessons' },
  late_apology: { label: T.tLateApology, tone: 'outline', filter: 'lessons' },
  makeup_followup: { label: T.tMakeup, tone: 'outline', filter: 'lessons' },
  transfer_in: { label: T.tTransferIn, tone: 'outline', filter: 'moves' },
  transfer_out: { label: T.tTransferOut, tone: 'outline', filter: 'moves' },
  day_off: { label: T.tDayOff, tone: 'outline', filter: 'moves' },
}

/**
 * PD-11's supervision timeline on the Teacher File: one chronological line of
 * everything recorded about the teacher. The list is the server's query over
 * the records themselves; this section only filters and lays it out. Absent
 * for anyone the server refuses.
 *
 * Two acts belong here because they have no other section: a free note, and
 * the bonus ticket (whose card reaches the teacher in their supervision chat;
 * the amount is payroll's and never typed here).
 */
export function SupervisionTimeline({ teacherId, canWrite }: { teacherId: string; canWrite: boolean }) {
  const tx = useCopy()
  const { dateTime } = useI18n()
  const cal = useCalendarDate()
  const timeline = useSupervisionTimeline(teacherId)
  const [filter, setFilter] = useState<Filter>('all')
  const [dialog, setDialog] = useState<'note' | 'bonus' | null>(null)
  const items = timeline.data?.items ?? []
  const shown = useMemo(
    () => (filter === 'all' ? items : items.filter((i) => KIND[i.type]?.filter === filter)),
    [items, filter],
  )
  if (timeline.isLoading || timeline.error || !timeline.data) return null

  const count = (f: Exclude<Filter, 'all'>) => items.filter((i) => KIND[i.type]?.filter === f).length

  return (
    <section className="card panel tf-section" aria-labelledby="tf-timeline">
      <div className="tf-section__head">
        <h2 id="tf-timeline" className="tf-section__title">
          {tx(T.timeline)}
        </h2>
        {canWrite && (
          <div className="tf-actions">
            <button type="button" className="btn btn--sm" onClick={() => setDialog('note')}>
              {tx(T.addNote)}
            </button>
            <button type="button" className="btn btn--sm btn--primary" onClick={() => setDialog('bonus')}>
              {tx(T.recordBonus)}
            </button>
          </div>
        )}
      </div>
      <p className="field__hint">{tx(T.timelineHint)}</p>
      <FilterChips<Filter>
        label={tx(T.timeline)}
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: tx(T.filterAll), count: items.length },
          { value: 'recognition', label: tx(T.filterRecognition), count: count('recognition') },
          { value: 'concerns', label: tx(T.filterConcerns), count: count('concerns') },
          { value: 'lessons', label: tx(T.filterLessons), count: count('lessons') },
          { value: 'moves', label: tx(T.filterMoves), count: count('moves') },
        ]}
      />
      {shown.length === 0 ? (
        <p className="tf-muted">{tx(T.noTimeline)}</p>
      ) : (
        <ol className="tf-entries tf-timeline">
          {shown.map((item) => (
            <TimelineRow key={`${item.type}-${item.id}`} item={item} when={dateTime(item.at)} day={cal.day} month={cal.month} />
          ))}
        </ol>
      )}
      {dialog && <TimelineDialog teacherId={teacherId} kind={dialog} onClose={() => setDialog(null)} />}
    </section>
  )
}

function TimelineRow({
  item,
  when,
  day,
  month,
}: {
  item: TimelineItem
  when: string
  day: (ymd: string) => string
  month: (ym: string) => string
}) {
  const tx = useCopy()
  const { dateTime } = useI18n()
  const kind = KIND[item.type]
  const context = item.lesson
    ? tx(T.lessonOf, { name: item.lesson.learnerName, date: dateTime(item.lesson.startsAt) })
    : item.learner
      ? item.learner.name
      : item.day
        ? day(item.day)
        : item.period
          ? month(item.period)
          : null
  return (
    <li className="tf-entry">
      <div className="tf-entry__head">
        <Badge tone={kind?.tone ?? 'neutral'} dot>
          {tx(kind?.label ?? T.tOther)}
        </Badge>
        {context && <strong dir="auto">{context}</strong>}
        <span className="tf-byline">{item.byName ? tx(T.by, { name: item.byName, date: when }) : when}</span>
      </div>
      {item.body && (
        <p className="tf-entry__body" dir="auto">
          {item.body}
        </p>
      )}
    </li>
  )
}

function TimelineDialog({ teacherId, kind, onClose }: { teacherId: string; kind: 'note' | 'bonus'; onClose: () => void }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const note = useAddNote(teacherId)
  const bonus = useRecordBonus(teacherId)
  const mutation = kind === 'note' ? note : bonus
  const id = useId()
  const [text, setText] = useState('')
  const [touched, setTouched] = useState(false)
  const missing = !text.trim()
  return (
    <Dialog
      title={tx(kind === 'note' ? T.addNote : T.recordBonus)}
      onClose={onClose}
      footer={
        <>
          <DialogCancelButton onClick={onClose} />
          <button
            type="button"
            className="btn btn--primary"
            disabled={mutation.isPending}
            onClick={() => {
              setTouched(true)
              if (missing) return
              mutation.mutate(text.trim(), { onSuccess: onClose })
            }}
          >
            {mutation.isPending ? tx(T.saving) : tx(T.save)}
          </button>
        </>
      }
    >
      {kind === 'bonus' && <p className="field__hint">{tx(T.bonusHint)}</p>}
      <div className="field">
        <label className="field__label" htmlFor={id}>
          {tx(kind === 'note' ? T.note : T.bonusReason)}
        </label>
        <textarea
          id={id}
          className="input tf-textarea"
          value={text}
          dir="auto"
          rows={4}
          maxLength={2000}
          onChange={(e) => setText(e.target.value)}
          aria-invalid={touched && missing}
          aria-describedby={touched && missing ? `${id}-err` : undefined}
        />
        {touched && missing && (
          <span id={`${id}-err`} className="field__error">
            {tx(T.required)}
          </span>
        )}
      </div>
      {mutation.error ? (
        <div className="banner banner--danger" role="alert">
          {describeError(mutation.error, locale)}
        </div>
      ) : null}
    </Dialog>
  )
}
