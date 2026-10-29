import { useId, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/core/api/client'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Badge } from '@/shared/components/Badge'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import { QueryBoundary } from '@/shared/components/States'
import { describeError, useCopy, type Pair } from './copy'
import { SearchableSelect } from '@/shared/components/SearchableSelect'

/**
 * PD-35: a teacher's evaluations and improvement plans, on the Teacher File.
 * The teacher reads one only once it is shared (owner, 2026-10-26); the server
 * decides who may write, and narrows to the caller's teachers.
 */

export interface Criterion { id: string; labelEn: string; labelAr: string; position: number; isActive: boolean }
export interface Evaluation {
  id: string
  periodFrom: string
  periodTo: string
  scores: Array<{ criterionId: string; labelEn: string; labelAr: string; score: number }>
  notes: string | null
  recommendations: string | null
  author: { id: string; name: string }
  createdAt: string
  supersedesId: string | null
  superseded: boolean
  sharedAt: string | null
}
export interface Goal { id: string; position: number; body: string; dueOn: string | null; status: GoalStatus; note: string | null }
export type GoalStatus = 'open' | 'met' | 'missed' | 'dropped'
export interface Plan { id: string; title: string; evaluationId: string | null; createdAt: string; sharedAt: string | null; goals: Goal[] }
export interface TeacherRecords { canWrite?: boolean; criteria: Criterion[]; evaluations: Evaluation[]; plans: Plan[] }

const enc = encodeURIComponent
export const evaluationsApi = {
  forTeacher: (teacherId: string) => api.get<TeacherRecords>(`/teachers/${enc(teacherId)}/evaluations`),
  evaluate: (teacherId: string, body: { periodFrom: string; periodTo: string; scores: Record<string, number>; notes?: string; recommendations?: string }) =>
    api.post<TeacherRecords>(`/teachers/${enc(teacherId)}/evaluations`, body),
  shareEvaluation: (id: string) => api.post<TeacherRecords>(`/evaluations/${enc(id)}/share`),
  plan: (teacherId: string, body: { title: string; evaluationId?: string; goals: Array<{ body: string; dueOn?: string }> }) =>
    api.post<TeacherRecords>(`/teachers/${enc(teacherId)}/improvement-plans`, body),
  sharePlan: (id: string) => api.post<TeacherRecords>(`/improvement-plans/${enc(id)}/share`),
  goalStatus: (id: string, status: GoalStatus) => api.post<TeacherRecords>(`/improvement-goals/${enc(id)}/status`, { status }),
  addCriterion: (body: { labelEn: string; labelAr: string }) => api.post<{ criteria: Criterion[] }>('/evaluation-criteria', body),
  updateCriterion: (id: string, body: { labelEn?: string; labelAr?: string; isActive?: boolean }) =>
    api.post<{ criteria: Criterion[] }>(`/evaluation-criteria/${enc(id)}`, body),
}

const key = (teacherId: string) => ['teacher-files', 'evaluations', teacherId] as const

const E = {
  title: { en: 'Evaluations & improvement plans', ar: 'التقييمات وخطط التحسين' },
  hint: {
    en: 'Scores from 1 to 5. The teacher sees an evaluation or a plan only after you share it.',
    ar: 'الدرجات من 1 إلى 5. لا يرى المعلم التقييم أو الخطة إلا بعد مشاركتها.',
  },
  newEvaluation: { en: 'New evaluation', ar: 'تقييم جديد' },
  newPlan: { en: 'New plan', ar: 'خطة جديدة' },
  none: { en: 'No evaluations or plans yet.', ar: 'لا توجد تقييمات أو خطط بعد.' },
  share: { en: 'Share with teacher', ar: 'مشاركة مع المعلم' },
  shared: { en: 'Shared', ar: 'تمت المشاركة' },
  notShared: { en: 'Not shared', ar: 'لم تتم المشاركة' },
  superseded: { en: 'Superseded', ar: 'تم استبداله' },
  by: { en: 'By {name}', ar: 'بواسطة {name}' },
  recommendations: { en: 'Recommendations', ar: 'التوصيات' },
  notes: { en: 'Notes (administration only)', ar: 'ملاحظات (للإدارة فقط)' },
  from: { en: 'From', ar: 'من' },
  to: { en: 'To', ar: 'إلى' },
  noScore: { en: 'Not scored', ar: 'بدون درجة' },
  planTitle: { en: 'Plan title', ar: 'عنوان الخطة' },
  goal: { en: 'Goal {n}', ar: 'الهدف {n}' },
  due: { en: 'Due', ar: 'الموعد' },
  addGoal: { en: 'Add a goal', ar: 'إضافة هدف' },
  save: { en: 'Save', ar: 'حفظ' },
  status: { en: 'Status of goal {n}', ar: 'حالة الهدف {n}' },
  open: { en: 'Open', ar: 'مفتوح' },
  met: { en: 'Met', ar: 'تحقق' },
  missed: { en: 'Missed', ar: 'لم يتحقق' },
  dropped: { en: 'Dropped', ar: 'أُلغي' },
  criteria: { en: 'Criteria…', ar: 'المعايير…' },
  criteriaTitle: { en: 'Evaluation criteria', ar: 'معايير التقييم' },
  criteriaHint: {
    en: 'Rename or retire a criterion; a retired one stays on past evaluations.',
    ar: 'أعد تسمية المعيار أو أوقفه؛ يبقى المعيار الموقوف في التقييمات السابقة.',
  },
  labelEn: { en: 'English', ar: 'بالإنجليزية' },
  labelAr: { en: 'Arabic', ar: 'بالعربية' },
  active: { en: 'In use', ar: 'مُستخدم' },
  addCriterion: { en: 'Add a criterion', ar: 'إضافة معيار' },
  close: { en: 'Close', ar: 'إغلاق' },
} satisfies Record<string, Pair>

const STATUS: Record<GoalStatus, Pair> = { open: E.open, met: E.met, missed: E.missed, dropped: E.dropped }

export function EvaluationsSection({ teacherId, canWrite, canEditCriteria }: { teacherId: string; canWrite: boolean; canEditCriteria: boolean }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const id = useId()
  const qc = useQueryClient()
  const records = useQuery({ queryKey: key(teacherId), queryFn: () => evaluationsApi.forTeacher(teacherId) })
  const act = useMutation({
    mutationFn: (f: () => Promise<TeacherRecords>) => f(),
    onSuccess: (data) => qc.setQueryData(key(teacherId), (old: TeacherRecords | undefined) => ({ ...old, ...data })),
  })
  const [dialog, setDialog] = useState<'evaluation' | 'plan' | 'criteria' | null>(null)
  const label = (s: { labelEn: string; labelAr: string }) => (locale === 'ar' ? s.labelAr : s.labelEn)
  const data = records.data

  return (
    <section className="card panel tf-section" aria-labelledby={id}>
      <div className="tf-section__head">
        <h2 id={id} className="tf-section__title">{tx(E.title)}</h2>
        {canWrite && (
          <span className="tf-eval__actions">
            <button type="button" className="btn btn--sm" onClick={() => setDialog('evaluation')}>{tx(E.newEvaluation)}</button>
            <button type="button" className="btn btn--sm" onClick={() => setDialog('plan')}>{tx(E.newPlan)}</button>
            {canEditCriteria && (
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => setDialog('criteria')}>{tx(E.criteria)}</button>
            )}
          </span>
        )}
      </div>
      <p className="field__hint">{tx(E.hint)}</p>
      {act.error && <p className="field__error" role="alert">{describeError(act.error, locale)}</p>}
      <QueryBoundary
        isLoading={records.isLoading}
        error={records.error}
        onRetry={() => void records.refetch()}
        isEmpty={!!data && data.evaluations.length === 0 && data.plans.length === 0}
        emptyTitle={tx(E.none)}
        compact
      >
        <ul className="tf-eval">
          {data?.evaluations.map((e) => (
            <li key={e.id} className="tf-eval__item">
              <div className="tf-eval__head">
                <strong>{e.periodFrom} → {e.periodTo}</strong>
                <span className="muted">{tx(E.by, { name: e.author.name })}</span>
                {e.superseded && <Badge tone="neutral">{tx(E.superseded)}</Badge>}
                {e.sharedAt ? <Badge tone="ok" dot>{tx(E.shared)}</Badge> : <Badge tone="outline">{tx(E.notShared)}</Badge>}
                {canWrite && !e.sharedAt && !e.superseded && (
                  <button type="button" className="btn btn--sm btn--primary" disabled={act.isPending} onClick={() => act.mutate(() => evaluationsApi.shareEvaluation(e.id))}>
                    {tx(E.share)}
                  </button>
                )}
              </div>
              <ul className="tf-eval__scores">
                {e.scores.map((s) => (
                  <li key={s.criterionId}><span dir="auto">{label(s)}</span> <strong>{s.score}/5</strong></li>
                ))}
              </ul>
              {e.recommendations && <p dir="auto"><strong>{tx(E.recommendations)}:</strong> {e.recommendations}</p>}
              {e.notes && <p dir="auto" className="muted"><strong>{tx(E.notes)}:</strong> {e.notes}</p>}
            </li>
          ))}
          {data?.plans.map((p) => (
            <li key={p.id} className="tf-eval__item">
              <div className="tf-eval__head">
                <strong dir="auto">🎯 {p.title}</strong>
                {p.sharedAt ? <Badge tone="ok" dot>{tx(E.shared)}</Badge> : <Badge tone="outline">{tx(E.notShared)}</Badge>}
                {canWrite && !p.sharedAt && (
                  <button type="button" className="btn btn--sm btn--primary" disabled={act.isPending} onClick={() => act.mutate(() => evaluationsApi.sharePlan(p.id))}>
                    {tx(E.share)}
                  </button>
                )}
              </div>
              <ol className="tf-eval__goals">
                {p.goals.map((g) => (
                  <li key={g.id}>
                    <span dir="auto">{g.body}</span>
                    {g.dueOn && <span className="muted"> · {tx(E.due)} {g.dueOn}</span>}{' '}
                    {canWrite ? (
                      <SearchableSelect
                        className="select select--sm"
                        aria-label={tx(E.status, { n: g.position })}
                        value={g.status}
                        disabled={act.isPending}
                        onValueChange={(v) => act.mutate(() => evaluationsApi.goalStatus(g.id, v as GoalStatus))}
                      >
                        {(Object.keys(STATUS) as GoalStatus[]).map((s) => <option key={s} value={s}>{tx(STATUS[s])}</option>)}
                      </SearchableSelect>
                    ) : (
                      <Badge tone="neutral">{tx(STATUS[g.status])}</Badge>
                    )}
                  </li>
                ))}
              </ol>
            </li>
          ))}
        </ul>
      </QueryBoundary>
      {dialog === 'evaluation' && data && (
        <EvaluationDialog
          criteria={data.criteria.filter((c) => c.isActive)}
          onClose={() => setDialog(null)}
          onSave={(body) => act.mutateAsync(() => evaluationsApi.evaluate(teacherId, body)).then(() => setDialog(null))}
        />
      )}
      {dialog === 'criteria' && data && (
        <CriteriaDialog
          criteria={data.criteria}
          onClose={() => setDialog(null)}
          onChanged={(criteria) => qc.setQueryData(key(teacherId), (old: TeacherRecords | undefined) => (old ? { ...old, criteria } : old))}
        />
      )}
      {dialog === 'plan' && (
        <PlanDialog
          onClose={() => setDialog(null)}
          onSave={(body) => act.mutateAsync(() => evaluationsApi.plan(teacherId, body)).then(() => setDialog(null))}
        />
      )}
    </section>
  )
}

function EvaluationDialog({
  criteria,
  onClose,
  onSave,
}: {
  criteria: Criterion[]
  onClose: () => void
  onSave: (body: { periodFrom: string; periodTo: string; scores: Record<string, number>; notes?: string; recommendations?: string }) => Promise<void>
}) {
  const tx = useCopy()
  const { locale } = useI18n()
  const today = new Date().toISOString().slice(0, 10)
  const [periodFrom, setFrom] = useState(`${today.slice(0, 8)}01`)
  const [periodTo, setTo] = useState(today)
  const [scores, setScores] = useState<Record<string, number>>({})
  const [notes, setNotes] = useState('')
  const [recommendations, setRecommendations] = useState('')
  const [error, setError] = useState<unknown>(null)
  const scored = Object.keys(scores).length > 0
  const save = () => {
    setError(null)
    onSave({
      periodFrom,
      periodTo,
      scores,
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      ...(recommendations.trim() ? { recommendations: recommendations.trim() } : {}),
    }).catch(setError)
  }
  return (
    <Dialog
      title={tx(E.newEvaluation)}
      onClose={onClose}
      footer={
        <>
          <DialogCancelButton onClick={onClose} />
          <button type="button" className="btn btn--primary" disabled={!scored || !periodFrom || !periodTo} onClick={save}>{tx(E.save)}</button>
        </>
      }
    >
      <div className="tf-eval__period">
        <label className="field">
          <span className="field__label">{tx(E.from)}</span>
          <input type="date" className="input" value={periodFrom} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">{tx(E.to)}</span>
          <input type="date" className="input" value={periodTo} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      {criteria.map((c) => (
        <label key={c.id} className="field">
          <span className="field__label" dir="auto">{locale === 'ar' ? c.labelAr : c.labelEn}</span>
          <SearchableSelect
            className="select"
            value={scores[c.id] ?? ''}
            onValueChange={(v) =>
              setScores((s) => {
                const next = { ...s }
                if (v) next[c.id] = Number(v)
                else delete next[c.id]
                return next
              })
            }
          >
            <option value="">{tx(E.noScore)}</option>
            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
          </SearchableSelect>
        </label>
      ))}
      <label className="field">
        <span className="field__label">{tx(E.recommendations)}</span>
        <textarea className="textarea" rows={3} value={recommendations} onChange={(e) => setRecommendations(e.target.value)} maxLength={4000} />
      </label>
      <label className="field">
        <span className="field__label">{tx(E.notes)}</span>
        <textarea className="textarea" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} />
      </label>
      {error !== null && <p className="field__error" role="alert">{describeError(error, locale)}</p>}
    </Dialog>
  )
}

function PlanDialog({
  onClose,
  onSave,
}: {
  onClose: () => void
  onSave: (body: { title: string; goals: Array<{ body: string; dueOn?: string }> }) => Promise<void>
}) {
  const tx = useCopy()
  const { locale } = useI18n()
  const [title, setTitle] = useState('')
  const [goals, setGoals] = useState<Array<{ body: string; dueOn: string }>>([{ body: '', dueOn: '' }])
  const [error, setError] = useState<unknown>(null)
  const filled = goals.filter((g) => g.body.trim())
  const save = () => {
    setError(null)
    onSave({
      title: title.trim(),
      goals: filled.map((g) => ({ body: g.body.trim(), ...(g.dueOn ? { dueOn: g.dueOn } : {}) })),
    }).catch(setError)
  }
  return (
    <Dialog
      title={tx(E.newPlan)}
      onClose={onClose}
      footer={
        <>
          <DialogCancelButton onClick={onClose} />
          <button type="button" className="btn btn--primary" disabled={!title.trim() || filled.length === 0} onClick={save}>{tx(E.save)}</button>
        </>
      }
    >
      <label className="field">
        <span className="field__label">{tx(E.planTitle)}</span>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
      </label>
      {goals.map((g, i) => (
        <div key={i} className="tf-eval__goal-row">
          <label className="field">
            <span className="field__label">{tx(E.goal, { n: i + 1 })}</span>
            <input
              className="input"
              value={g.body}
              maxLength={1000}
              onChange={(e) => setGoals((all) => all.map((x, j) => (j === i ? { ...x, body: e.target.value } : x)))}
            />
          </label>
          <label className="field">
            <span className="field__label">{tx(E.due)}</span>
            <input
              type="date"
              className="input"
              value={g.dueOn}
              onChange={(e) => setGoals((all) => all.map((x, j) => (j === i ? { ...x, dueOn: e.target.value } : x)))}
            />
          </label>
        </div>
      ))}
      <button type="button" className="btn btn--sm btn--ghost" onClick={() => setGoals((all) => [...all, { body: '', dueOn: '' }])}>
        {tx(E.addGoal)}
      </button>
      {error !== null && <p className="field__error" role="alert">{describeError(error, locale)}</p>}
    </Dialog>
  )
}

function CriteriaDialog({
  criteria,
  onClose,
  onChanged,
}: {
  criteria: Criterion[]
  onClose: () => void
  onChanged: (criteria: Criterion[]) => void
}) {
  const tx = useCopy()
  const { locale } = useI18n()
  const [rows, setRows] = useState(criteria)
  const [fresh, setFresh] = useState({ labelEn: '', labelAr: '' })
  const op = useMutation({
    mutationFn: (f: () => Promise<{ criteria: Criterion[] }>) => f(),
    onSuccess: (r) => {
      setRows(r.criteria)
      onChanged(r.criteria)
    },
  })
  const edit = (id: string, patch: Partial<Criterion>) => setRows((all) => all.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  return (
    <Dialog
      title={tx(E.criteriaTitle)}
      onClose={onClose}
      footer={<button type="button" className="btn" onClick={onClose}>{tx(E.close)}</button>}
    >
      <p className="field__hint">{tx(E.criteriaHint)}</p>
      {op.error && <p className="field__error" role="alert">{describeError(op.error, locale)}</p>}
      {rows.map((c) => (
        <div key={c.id} className="tf-eval__goal-row">
          <label className="field">
            <span className="field__label">{tx(E.labelEn)}</span>
            <input className="input" value={c.labelEn} maxLength={80} onChange={(e) => edit(c.id, { labelEn: e.target.value })} />
          </label>
          <label className="field">
            <span className="field__label">{tx(E.labelAr)}</span>
            <input className="input" dir="rtl" value={c.labelAr} maxLength={80} onChange={(e) => edit(c.id, { labelAr: e.target.value })} />
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={c.isActive} onChange={(e) => edit(c.id, { isActive: e.target.checked })} />
            <span>{tx(E.active)}</span>
          </label>
          <button
            type="button"
            className="btn btn--sm"
            disabled={op.isPending || !c.labelEn.trim() || !c.labelAr.trim()}
            onClick={() => op.mutate(() => evaluationsApi.updateCriterion(c.id, { labelEn: c.labelEn.trim(), labelAr: c.labelAr.trim(), isActive: c.isActive }))}
          >
            {tx(E.save)}
          </button>
        </div>
      ))}
      <div className="tf-eval__goal-row">
        <label className="field">
          <span className="field__label">{tx(E.labelEn)}</span>
          <input className="input" value={fresh.labelEn} maxLength={80} onChange={(e) => setFresh((f) => ({ ...f, labelEn: e.target.value }))} />
        </label>
        <label className="field">
          <span className="field__label">{tx(E.labelAr)}</span>
          <input className="input" dir="rtl" value={fresh.labelAr} maxLength={80} onChange={(e) => setFresh((f) => ({ ...f, labelAr: e.target.value }))} />
        </label>
        <button
          type="button"
          className="btn btn--sm"
          disabled={op.isPending || !fresh.labelEn.trim() || !fresh.labelAr.trim()}
          onClick={() =>
            op.mutate(() =>
              evaluationsApi.addCriterion({ labelEn: fresh.labelEn.trim(), labelAr: fresh.labelAr.trim() }).then((r) => {
                setFresh({ labelEn: '', labelAr: '' })
                return r
              }),
            )
          }
        >
          {tx(E.addCriterion)}
        </button>
      </div>
    </Dialog>
  )
}
