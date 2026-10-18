import { useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Badge } from '@/shared/components/Badge'
import { PageHeader } from '@/shared/components/PageHeader'
import { QueryBoundary } from '@/shared/components/States'
import type { EntryBrief, TeacherFile } from './api'
import { T, useCopy } from './copy'
import { useCalendarDate } from './calendar'
import { Refusal, isTeacherFileRefusal } from './Refusal'
import { useTeacherFile } from './hooks'
import { AddEntryDialog, EditPersonalDialog, type EntryIntent } from './TeacherFileDialogs'
import './teachers.css'

/**
 * PD-10: one teacher's file. Sections in the order the owner listed them;
 * the ones that wait on PD-9 or on Jawwid Core say so instead of showing a
 * plausible zero. Which controls appear comes from the server's `access`.
 */
export function TeacherFilePage({ basePath, eyebrow }: { basePath: string; eyebrow?: string }) {
  const { teacherId = '' } = useParams<{ teacherId: string }>()
  const tx = useCopy()
  const file = useTeacherFile(teacherId)
  const [editing, setEditing] = useState(false)
  const [intent, setIntent] = useState<EntryIntent | null>(null)
  const data = file.data

  return (
    <div className="page">
      <div className="page__inner">
        <p className="tf-back">
          <Link to={basePath}>{tx(T.back)}</Link>
        </p>
        {isTeacherFileRefusal(file.error) ? (
          <Refusal error={file.error} />
        ) : (
          <QueryBoundary isLoading={file.isLoading} error={file.error} onRetry={() => void file.refetch()}>
            {data && (
              <>
                <PageHeader
                  eyebrow={eyebrow}
                  title={data.teacher.name}
                  status={
                    <Badge tone={data.teacher.isActive ? 'ok' : 'outline'} dot>
                      {tx(data.teacher.isActive ? T.active : T.inactive)}
                    </Badge>
                  }
                />
                <Personal file={data} onEdit={() => setEditing(true)} />
                <Students file={data} />
                <Complaints file={data} onAdd={setIntent} />
                <Monthly file={data} onAdd={setIntent} />
                <DaysOff file={data} onAdd={setIntent} />
                <section className="card panel tf-section" aria-labelledby="tf-later">
                  <h2 id="tf-later" className="tf-section__title">
                    {tx(T.notHereYet)}
                  </h2>
                  <p className="tf-muted">{tx(T.notHereYetBody)}</p>
                </section>
                {editing && <EditPersonalDialog file={data} onClose={() => setEditing(false)} />}
                {intent && <AddEntryDialog teacherId={data.teacher.id} intent={intent} onClose={() => setIntent(null)} />}
              </>
            )}
          </QueryBoundary>
        )}
      </div>
    </div>
  )
}

function Section({
  id,
  title,
  action,
  hint,
  children,
}: {
  id: string
  title: string
  action?: ReactNode
  hint?: string
  children: ReactNode
}) {
  return (
    <section className="card panel tf-section" aria-labelledby={id}>
      <div className="tf-section__head">
        <h2 id={id} className="tf-section__title">
          {title}
        </h2>
        {action}
      </div>
      {hint && <p className="field__hint">{hint}</p>}
      {children}
    </section>
  )
}

function Byline({ entry }: { entry: EntryBrief }) {
  const tx = useCopy()
  const { dateTime } = useI18n()
  return <span className="tf-byline">{tx(T.by, { name: entry.author.name, date: dateTime(entry.createdAt) })}</span>
}

function Personal({ file, onEdit }: { file: TeacherFile; onEdit: () => void }) {
  const tx = useCopy()
  const { dateTime } = useI18n()
  const cal = useCalendarDate()
  const p = file.personal
  const missing = <span className="tf-muted">{tx(T.notRecorded)}</span>
  return (
    <Section
      id="tf-personal"
      title={tx(T.personal)}
      action={
        file.access.canEditPersonal && (
          <button type="button" className="btn btn--sm" onClick={onEdit} aria-label={tx(T.editPersonal)}>
            {tx(T.edit)}
          </button>
        )
      }
    >
      <dl className="tf-kv">
        <dt>{tx(T.fullName)}</dt>
        <dd><bdi>{p.fullName}</bdi></dd>
        <dt>{tx(T.phone)}</dt>
        {/* The value is LTR; the cell keeps the page direction, so it sits beside its label. */}
        <dd>{p.phone ? <bdi dir="ltr">{p.phone}</bdi> : missing}</dd>
        <dt>{tx(T.email)}</dt>
        <dd>{p.email ? <bdi dir="ltr">{p.email}</bdi> : missing}</dd>
        <dt>{tx(T.joinedOn)}</dt>
        <dd>{p.joinedOn ? cal.day(p.joinedOn) : missing}</dd>
      </dl>
      {p.updatedBy && p.updatedAt && (
        <p className="tf-byline">
          {tx(T.lastEdit, {
            name: p.updatedBy.name,
            date: dateTime(p.updatedAt),
          })}
        </p>
      )}
    </Section>
  )
}

function Students({ file }: { file: TeacherFile }) {
  const tx = useCopy()
  const rows = file.assignedStudents
  return (
    <Section id="tf-students" title={`${tx(T.assigned)} (${rows.length})`} hint={tx(T.assignedHint)}>
      {rows.length === 0 ? (
        <p className="tf-muted">{tx(T.noStudents)}</p>
      ) : (
        <div className="table-wrap tf-table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{tx(T.child)}</th>
                <th scope="col">{tx(T.level)}</th>
                <th scope="col">{tx(T.family)}</th>
                <th scope="col">{tx(T.supervisor)}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.learnerId}>
                  <td dir="auto">{s.name}</td>
                  <td dir="auto">{s.level ?? tx(T.none)}</td>
                  <td dir="auto">{s.family.displayName}</td>
                  <td dir="auto">{s.supervisor?.name ?? tx(T.none)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  )
}

function Complaints({ file, onAdd }: { file: TeacherFile; onAdd: (i: EntryIntent) => void }) {
  const tx = useCopy()
  const write = file.access.canWriteSupervision
  const items = file.supervision.complaints
  return (
    <Section
      id="tf-complaints"
      title={tx(T.complaints)}
      action={
        write && (
          <button type="button" className="btn btn--sm" onClick={() => onAdd({ kind: 'complaint' })}>
            {tx(T.addComplaint)}
          </button>
        )
      }
    >
      {items.length === 0 ? (
        <p className="tf-muted">{tx(T.noComplaints)}</p>
      ) : (
        <ul className="tf-entries">
          {items.map((c) => (
            <li key={c.id} className="tf-entry">
              <div className="tf-entry__head">
                <Badge tone={c.resolution ? 'ok' : 'warn'} dot>
                  {tx(c.resolution ? T.resolved : T.unresolved)}
                </Badge>
                <Byline entry={c} />
                {c.source && <span className="tf-muted">{tx(T.fromConversation)}</span>}
              </div>
              <p className="tf-entry__body" dir="auto">
                {c.body}
              </p>
              {c.resolution ? (
                <div className="tf-followup">
                  <p className="tf-entry__body" dir="auto">
                    {c.resolution.body}
                  </p>
                  <Byline entry={c.resolution} />
                </div>
              ) : (
                write && (
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => onAdd({ kind: 'complaint_resolution', refersTo: c.id })}
                  >
                    {tx(T.resolve)}
                  </button>
                )
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

function Monthly({ file, onAdd }: { file: TeacherFile; onAdd: (i: EntryIntent) => void }) {
  const tx = useCopy()
  const { number } = useI18n()
  const cal = useCalendarDate()
  const items = file.supervision.monthlyComments
  return (
    <Section
      id="tf-monthly"
      title={tx(T.monthly)}
      action={
        file.access.canWriteSupervision && (
          <button type="button" className="btn btn--sm" onClick={() => onAdd({ kind: 'monthly_comment' })}>
            {tx(T.addMonthly)}
          </button>
        )
      }
    >
      {items.length === 0 ? (
        <p className="tf-muted">{tx(T.noMonthly)}</p>
      ) : (
        <ul className="tf-entries">
          {items.map((m) => (
            <li key={m.month} className="tf-entry">
              <div className="tf-entry__head">
                <strong>{cal.month(m.month)}</strong>
                <Byline entry={m.current} />
                {m.earlierVersions.length > 0 && (
                  <span className="tf-muted">{tx(T.earlierVersions, { n: number(m.earlierVersions.length) })}</span>
                )}
              </div>
              <p className="tf-entry__body" dir="auto">
                {m.current.body}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

function DaysOff({ file, onAdd }: { file: TeacherFile; onAdd: (i: EntryIntent) => void }) {
  const tx = useCopy()
  const cal = useCalendarDate()
  const write = file.access.canWriteSupervision
  const items = file.supervision.daysOff
  return (
    <Section
      id="tf-days-off"
      title={tx(T.daysOff)}
      hint={tx(T.daysOffHint)}
      action={
        write && (
          <button type="button" className="btn btn--sm" onClick={() => onAdd({ kind: 'day_off' })}>
            {tx(T.addDayOff)}
          </button>
        )
      }
    >
      {items.length === 0 ? (
        <p className="tf-muted">{tx(T.noDaysOff)}</p>
      ) : (
        <ul className="tf-entries">
          {items.map((d) => (
            <li key={d.id} className="tf-entry">
              <div className="tf-entry__head">
                <strong className={d.cancellation ? 'tf-struck' : undefined}>{cal.day(d.date)}</strong>
                {d.cancellation && <Badge tone="outline">{tx(T.cancelled)}</Badge>}
                <Byline entry={d} />
              </div>
              <p className="tf-entry__body" dir="auto">
                {d.body}
              </p>
              {d.cancellation ? (
                <div className="tf-followup">
                  <p className="tf-entry__body" dir="auto">
                    {d.cancellation.body}
                  </p>
                  <Byline entry={d.cancellation} />
                </div>
              ) : (
                write && (
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() =>
                      onAdd({
                        kind: 'day_off_cancellation',
                        refersTo: d.id,
                        date: d.date,
                      })
                    }
                    aria-label={`${tx(T.cancel)} — ${cal.day(d.date)}`}
                  >
                    {tx(T.cancel)}
                  </button>
                )
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}
