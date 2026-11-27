import { useEffect, useId, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import { Icon } from '@/shared/components/Icon'
import type { MenuItem } from '@/shared/components/Menu'
import { DetailFoot, DetailSection, FlowSteps, type FlowStep } from '@/shared/components/RequestQueue'
import { useStructure } from '@/features/organization/hooks'
import { describeOpsError } from '../teachers/opsCopy'
import type { Pair } from '../teachers/copy'
import { trialKeys, trialsApi, type AssignResult, type NewStudentDto } from './api'
import { ChangeSupervisorDialog, transferNotice } from '@/features/organization/ChangeSupervisorDialog'
import { useCopy } from '@/features/organization/copy'
import { orgKeys } from '@/features/organization/api'
import { NS } from './newStudentsCopy'
import { ApiError } from '@/core/api/errors'
import { OP } from '@/features/intake/opsCopy'
import { groupNotice } from '@/features/intake/OpsDialogs'
import { SearchableSelect } from '@/shared/components/SearchableSelect'

const S: Record<string, Pair> = {
  setup: { en: 'Setup', ar: 'التجهيز' },
  assign: { en: 'Assign', ar: 'تعيين' },
  change: { en: 'Change', ar: 'تغيير' },
  assignTitle: { en: 'Assign a supervisor', ar: 'تعيين مشرف' },
  assignHint: {
    en: 'The supervisor becomes responsible for this family. Chat creates the family, the parent and the children from this form; the form can no longer be edited after this.',
    ar: 'يصبح المشرف مسؤولًا عن هذه الأسرة. تُنشئ المحادثات الأسرة وولي الأمر والأطفال من هذا النموذج، ولا يمكن تعديل النموذج بعد ذلك.',
  },
  supervisor: { en: 'Supervisor', ar: 'المشرف' },
  choose: { en: 'Choose…', ar: 'اختر…' },
  email: { en: 'Parent\'s sign-in e-mail', ar: 'البريد الإلكتروني لتسجيل دخول ولي الأمر' },
  emailHint: {
    en: 'The parent creates their account in the app with this e-mail.',
    ar: 'ينشئ ولي الأمر حسابه في التطبيق بهذا البريد.',
  },
  required: { en: 'Required', ar: 'مطلوب' },
  save: { en: 'Assign', ar: 'تعيين' },
  saving: { en: 'Assigning…', ar: 'جارٍ التعيين…' },
  notAssigned: { en: 'Not assigned yet', ar: 'لم يُعيَّن بعد' },
  createGroup: { en: 'Create group', ar: 'إنشاء المجموعة' },
  creating: { en: 'Creating…', ar: 'جارٍ الإنشاء…' },
  openGroup: { en: 'Open group', ar: 'فتح المجموعة' },
  group: { en: 'Group', ar: 'المجموعة' },
  noGroup: { en: 'Not created yet', ar: 'لم تُنشأ بعد' },
  groupMade: { en: 'Created', ar: 'أُنشئت' },
  parent: { en: 'Parent\'s account', ar: 'حساب ولي الأمر' },
  notStarted: {
    en: 'Not signed up yet. Ask the parent to download the app and choose "I\'m a new parent" with their e-mail.',
    ar: 'لم يُنشئ حسابه بعد. اطلب من ولي الأمر تنزيل التطبيق واختيار «ولي أمر جديد» ببريده الإلكتروني.',
  },
  codeWaiting: {
    en: 'The parent asked for a code. Send it to them on WhatsApp:',
    ar: 'طلب ولي الأمر رمزًا. أرسله إليه عبر واتساب:',
  },
  signedUp: { en: 'Signed up', ar: 'أنشأ حسابه' },
  timesNotSet: {
    en: 'Assigned. Some weekly lesson times could not be set from the form; the Teachers department sets them in Schedules:',
    ar: 'تم التعيين. تعذّر ضبط بعض مواعيد الحصص الأسبوعية من النموذج؛ يضبطها قسم المعلمين من صفحة الجداول:',
  },
}

/** What a family's card can ask of its setup directly: the next step, without hunting for it in the inspector. */
export type SetupIntent = 'assign' | 'group'

/**
 * PD-16: a new student's setup, in the family's inspector. The Operations
 * manager assigns the responsible supervisor; the supervisor creates the
 * family's group; the parent signs up in the app with a code the supervisor
 * relays on WhatsApp. Every step is decided by the server.
 *
 * Drawn as the family's steps, top to bottom: `before` is what led here (the
 * trial, the recorded subscription). The step that moves the family on is the
 * inspector's one primary action, at its foot; what only adjusts a step
 * (change the supervisor, end a code, clear a lock) stays beside that step.
 * `children` are the record's facts, between the steps and the foot; `more`
 * is what the foot keeps behind "⋯".
 */
export function NewStudentSetup({
  s,
  canAssign,
  before = [],
  intent = null,
  onIntentDone,
  more = [],
  children,
}: {
  s: NewStudentDto
  canAssign: boolean
  before?: FlowStep[]
  /** The step the family's card asked for; it is taken once, then `onIntentDone` clears it. */
  intent?: SetupIntent | null
  onIntentDone?: () => void
  more?: MenuItem[]
  children?: ReactNode
}) {
  const { locale, number } = useI18n()
  const tx = (p: Pair | undefined) => (p ? (locale === 'ar' ? p.ar : p.en) : '')
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [assigning, setAssigning] = useState(false)
  const [changing, setChanging] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const orgTx = useCopy()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const e = s.enrolment ?? null

  const createGroup = async () => {
    setPending(true)
    setError(null)
    try {
      const { conversationId } = await trialsApi.createNewStudentGroup(s.trialId)
      void qc.invalidateQueries({ queryKey: trialKeys.newStudents })
      navigate(`/chat/${conversationId}`)
    } catch (err) {
      setError(err)
      setPending(false)
    }
  }

  // PD-32: the code has no time limit; the responsible staff end it, or clear the
  // wrong-code lock after checking with the parent. Both are the server's decision.
  const signupAction = async (run: () => Promise<unknown>, message: string) => {
    setPending(true)
    setError(null)
    try {
      await run()
      setDone(message)
      void qc.invalidateQueries({ queryKey: trialKeys.newStudents })
    } catch (err) {
      setError(err)
    } finally {
      setPending(false)
    }
  }
  const signup = e?.parentSignup
  const attempts = signup && signup.state !== 'signed_up' ? signup.attempts : undefined

  // What moves the family on now, offered only where the server would accept it.
  const next: SetupIntent | 'open' | null = !e?.supervisor && canAssign ? 'assign' : e && !e.groupConversationId && e.canCreateGroup ? 'group' : e?.groupConversationId ? 'open' : null

  // The card asked for the next step: take it here, once, where its dialog and its notices live.
  useEffect(() => {
    if (!intent) return
    if (intent === 'assign' && next === 'assign') setAssigning(true)
    if (intent === 'group' && next === 'group') void createGroup()
    onIntentDone?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- taken once per request from the card
  }, [intent])

  const steps: FlowStep[] = [
    ...before,
    {
      key: 'supervisor',
      label: tx(S.supervisor),
      state: e?.supervisor ? 'done' : 'current',
      meta: e?.supervisor ? <bdi>{e.supervisor.name}</bdi> : tx(S.notAssigned),
      children:
        e?.supervisor && canAssign ? (
          // PD-24: the Operations manager changes the supervisor at any time after Assign.
          <button type="button" className="btn btn--sm" onClick={() => setChanging(true)}>
            {tx(S.change)}
          </button>
        ) : undefined,
    },
    {
      key: 'group',
      label: tx(S.group),
      state: !e ? 'todo' : e.groupConversationId ? 'done' : 'current',
      meta: !e ? undefined : e.groupConversationId ? tx(S.groupMade) : tx(S.noGroup),
    },
    {
      key: 'parent',
      label: tx(S.parent),
      state: !e || !signup ? 'todo' : signup.state === 'signed_up' ? 'done' : attempts?.locked ? 'problem' : 'current',
      meta: signup?.state === 'signed_up' ? tx(S.signedUp) : undefined,
      children:
        e && signup && signup.state !== 'signed_up' ? (
          <>
            {signup.state === 'not_started' && !attempts?.locked && <span className="rq-note">{tx(S.notStarted)}</span>}
            {signup.state === 'code_waiting' && (
              <div className="ns-code">
                <span className="rq-note">{tx(S.codeWaiting)}</span>
                {signup.code && (
                  <strong className="ns-code__value" dir="ltr" aria-live="polite" aria-label={`${tx(NS.codeLabel)} ${signup.code.split('').join(' ')}`}>
                    {signup.code}
                  </strong>
                )}
                <span className="rq-note">{tx(NS.codeValid)}</span>
                {signup.code && (
                  <button
                    type="button"
                    className="btn btn--sm"
                    disabled={pending}
                    title={tx(NS.invalidateHint)}
                    onClick={() => void signupAction(() => trialsApi.invalidateSignupCode(s.trialId), tx(NS.invalidated))}
                  >
                    {tx(NS.invalidate)}
                  </button>
                )}
              </div>
            )}
            {attempts && attempts.wrong > 0 && (
              <div className={attempts.locked ? 'ns-lock ns-lock--on' : 'ns-lock'} role={attempts.locked ? 'status' : undefined}>
                {attempts.locked ? (
                  <span>
                    <Icon name="lock" size={14} /> {tx(NS.lockedNote)}
                  </span>
                ) : (
                  <span className="rq-note">
                    {tx(NS.wrongTries)}: {number(attempts.wrong)} / {number(attempts.cap)}
                  </span>
                )}
                <button
                  type="button"
                  className="btn btn--sm"
                  disabled={pending}
                  onClick={() => void signupAction(() => trialsApi.resetSignupAttempts(s.trialId), tx(NS.resetDone))}
                >
                  {tx(NS.reset)}
                </button>
              </div>
            )}
          </>
        ) : undefined,
    },
  ]

  const primary =
    next === 'assign' ? (
      <button type="button" className="btn btn--primary" onClick={() => setAssigning(true)}>
        {tx(S.assign)}
      </button>
    ) : next === 'group' ? (
      <button type="button" className="btn btn--primary" disabled={pending} onClick={() => void createGroup()}>
        <Icon name="plus" size={14} />
        {pending ? tx(S.creating) : tx(S.createGroup)}
      </button>
    ) : next === 'open' ? (
      <button type="button" className="btn" onClick={() => navigate(`/chat/${e!.groupConversationId}`)}>
        <Icon name="conversations" size={16} />
        {tx(S.openGroup)}
      </button>
    ) : undefined

  return (
    <>
      <DetailSection title={tx(NS.setup)}>
        <FlowSteps steps={steps} label={tx(S.setup)} />
        {notice && <p className="banner banner--warning" role="status">{notice}</p>}
        {done && <p className="banner banner--info" role="status">{done}</p>}
        {error ? <p className="banner banner--danger" role="alert">{describeOpsError(error, locale)}</p> : null}
      </DetailSection>
      {children}
      <DetailFoot primary={primary} more={more} label={`${tx(NS.moreActions)}: ${s.parent.name}`} />
      {changing && e && (
        <ChangeSupervisorDialog
          name={s.parent.name}
          current={e.supervisor}
          childNames={s.children.map((c) => c.name)}
          submit={(body) => trialsApi.changeNewStudentSupervisor(s.trialId, body)}
          onClose={() => setChanging(false)}
          onDone={(result, supervisorName) => {
            setChanging(false)
            setDone(transferNotice(orgTx, result, supervisorName))
            void qc.invalidateQueries({ queryKey: trialKeys.newStudents })
            void qc.invalidateQueries({ queryKey: orgKeys.structure })
            void qc.invalidateQueries({ queryKey: ['chat'] })
          }}
        />
      )}
      {assigning && (
        <AssignDialog
          s={s}
          onClose={() => setAssigning(false)}
          onAssigned={(result, familyName) => {
            setAssigning(false)
            void qc.invalidateQueries({ queryKey: trialKeys.newStudents })
            // PD-42 PR-3: a trial sibling went to the family the parent is already in.
            if (result.attached) setDone(groupNotice(orgTx, result.group, familyName ?? s.parent.name))
            const missing = result.schedules.filter((x) => !x.set)
            if (missing.length > 0) setNotice(`${tx(S.timesNotSet)} ${[...new Set(missing.map((m) => m.reason))].join(' · ')}`)
          }}
        />
      )}
    </>
  )
}

/** PD-42 PR-3: PARENT_EXISTS names the family the trial's parent is already in. */
function existingFamily(error: unknown): { familyId: string; parentName: string | null } | null {
  if (!(error instanceof ApiError) || error.code !== 'COMM.PARENT_EXISTS') return null
  const d = (error.detail ?? {}) as { familyId?: unknown; parentName?: unknown }
  return typeof d.familyId === 'string' ? { familyId: d.familyId, parentName: typeof d.parentName === 'string' ? d.parentName : null } : null
}

function AssignDialog({ s, onClose, onAssigned }: { s: NewStudentDto; onClose: () => void; onAssigned: (r: AssignResult, familyName?: string) => void }) {
  const { locale } = useI18n()
  const tx = (p: Pair | undefined) => (p ? (locale === 'ar' ? p.ar : p.en) : '')
  const id = useId()
  const structure = useStructure()
  const supervisors = (structure.data?.departments ?? [])
    .find((d) => d.kind === 'operations')
    ?.members.filter((m) => m.position === 'supervisor' && m.isActive) ?? []
  const [supervisorId, setSupervisorId] = useState('')
  const [email, setEmail] = useState(s.parent.email ?? '')
  const [touched, setTouched] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>(null)

  const orgTx = useCopy()
  const family = existingFamily(error)
  const familyName = family?.parentName ?? s.parent.name
  // The children join the family the parent is in, with its supervisor: nothing new for the parent.
  const attach = async () => {
    if (!family || pending) return
    setPending(true)
    setError(null)
    try {
      onAssigned(await trialsApi.assignNewStudent(s.trialId, { familyId: family.familyId }), familyName)
    } catch (err) {
      setError(err)
      setPending(false)
    }
  }

  const save = async () => {
    setTouched(true)
    if (!supervisorId || !email.trim() || pending) return
    setPending(true)
    setError(null)
    try {
      onAssigned(await trialsApi.assignNewStudent(s.trialId, { supervisorId, email: email.trim() }))
    } catch (err) {
      setError(err)
      setPending(false)
    }
  }

  return (
    <Dialog
      title={`${tx(S.assignTitle)} — ${s.parent.name}`}
      onClose={onClose}
      footer={
        <>
          <DialogCancelButton onClick={onClose} />
          <button type="button" className="btn btn--primary" disabled={pending} onClick={() => void save()}>
            {pending ? tx(S.saving) : tx(S.save)}
          </button>
        </>
      }
    >
      <p className="ts-muted">{tx(S.assignHint)}</p>
      <div className="field">
        <label className="field__label" htmlFor={`${id}-sup`}>{tx(S.supervisor)}</label>
        <SearchableSelect id={`${id}-sup`} className="select" value={supervisorId} onValueChange={(v) => setSupervisorId(v)} aria-invalid={touched && !supervisorId}>
          <option value="">{tx(S.choose)}</option>
          {supervisors.map((m) => (
            <option key={m.id} value={m.id}>{m.name} ({m.learnerCount})</option>
          ))}
        </SearchableSelect>
        {touched && !supervisorId && <span className="field__error">{tx(S.required)}</span>}
      </div>
      <div className="field">
        <label className="field__label" htmlFor={`${id}-email`}>{tx(S.email)}</label>
        <input id={`${id}-email`} className="input" type="email" dir="ltr" value={email} onChange={(ev) => setEmail(ev.target.value)} aria-invalid={touched && !email.trim()} />
        <span className="field__hint">{tx(S.emailHint)}</span>
        {touched && !email.trim() && <span className="field__error">{tx(S.required)}</span>}
      </div>
      {family ? (
        <div className="banner banner--warning" role="status">
          <p>{orgTx(OP.parentExists)}</p>
          <p className="field__hint">{orgTx(OP.parentExistsHint)}</p>
          <button type="button" className="btn btn--sm btn--primary" disabled={pending} onClick={() => void attach()}>
            {orgTx(OP.addToFamily, { name: familyName })}
          </button>
        </div>
      ) : error ? (
        <p className="banner banner--danger" role="alert">{describeOpsError(error, locale)}</p>
      ) : null}
    </Dialog>
  )
}
