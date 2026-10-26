import { useId, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import { Badge } from '@/shared/components/Badge'
import { Icon } from '@/shared/components/Icon'
import { useStructure } from '@/features/organization/hooks'
import { describeOpsError } from '../teachers/opsCopy'
import type { Pair } from '../teachers/copy'
import { trialKeys, trialsApi, type AssignResult, type NewStudentDto } from './api'
import { ChangeSupervisorDialog, transferNotice } from '@/features/organization/ChangeSupervisorDialog'
import { useCopy } from '@/features/organization/copy'
import { orgKeys } from '@/features/organization/api'
import { NS } from './newStudentsCopy'

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

/**
 * PD-16: a new student's setup, on their New Students card. The Operations
 * manager assigns the responsible supervisor; the supervisor creates the
 * family's group; the parent signs up in the app with a code the supervisor
 * relays on WhatsApp. Every step is decided by the server.
 */
export function NewStudentSetup({ s, canAssign }: { s: NewStudentDto; canAssign: boolean }) {
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

  return (
    <section className="ns-block ns-block--setup" aria-label={tx(S.setup)}>
      <h3 className="ns-block__title">{tx(NS.setup)}</h3>
      <dl className="ns-pairs">
        <div>
          <dt>{tx(S.supervisor)}</dt>
          <dd className="ns-inline">
            {e?.supervisor ? (
              <>
                <span dir="auto">{e.supervisor.name}</span>
                {canAssign && (
                  // PD-24: the Operations manager changes the supervisor at any time after Assign.
                  <button type="button" className="btn btn--sm" onClick={() => setChanging(true)}>
                    {tx(S.change)}
                  </button>
                )}
              </>
            ) : canAssign ? (
              <button type="button" className="btn btn--sm btn--primary" onClick={() => setAssigning(true)}>
                {tx(S.assign)}
              </button>
            ) : (
              <span className="ts-muted">{tx(S.notAssigned)}</span>
            )}
          </dd>
        </div>
        {e && (
          <div>
            <dt>{tx(S.group)}</dt>
            <dd className="ns-inline">
              {e.groupConversationId ? (
                <button type="button" className="btn btn--sm" onClick={() => navigate(`/chat/${e.groupConversationId}`)}>
                  <Icon name="messages" size={14} />
                  {tx(S.openGroup)}
                </button>
              ) : e.canCreateGroup ? (
                <button type="button" className="btn btn--sm btn--primary" disabled={pending} onClick={() => void createGroup()}>
                  <Icon name="plus" size={14} />
                  {pending ? tx(S.creating) : tx(S.createGroup)}
                </button>
              ) : (
                <span className="ts-muted">{tx(S.noGroup)}</span>
              )}
            </dd>
          </div>
        )}
        {e && signup && (
          <div>
            <dt>{tx(S.parent)}</dt>
            <dd>
              {signup.state === 'signed_up' && (
                <Badge tone="ok">
                  <Icon name="check" size={12} /> {tx(S.signedUp)}
                </Badge>
              )}
              {signup.state === 'not_started' && !attempts?.locked && <span className="ts-muted ns-note">{tx(S.notStarted)}</span>}
              {signup.state === 'code_waiting' && (
                <div className="ns-code">
                  <span className="ns-note">{tx(S.codeWaiting)}</span>
                  {signup.code && (
                    <strong className="ns-code__value" dir="ltr" aria-live="polite" aria-label={`${tx(NS.codeLabel)} ${signup.code.split('').join(' ')}`}>
                      {signup.code}
                    </strong>
                  )}
                  <span className="ts-muted ns-note">{tx(NS.codeValid)}</span>
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
                    <span className="ts-muted">
                      {tx(NS.wrongTries)}: {number(attempts.wrong)} / {number(attempts.cap)}
                    </span>
                  )}
                  <button
                    type="button"
                    className={attempts.locked ? 'btn btn--sm btn--primary' : 'btn btn--sm'}
                    disabled={pending}
                    onClick={() => void signupAction(() => trialsApi.resetSignupAttempts(s.trialId), tx(NS.resetDone))}
                  >
                    {tx(NS.reset)}
                  </button>
                </div>
              )}
            </dd>
          </div>
        )}
      </dl>
      {notice && <p className="banner banner--warning" role="status">{notice}</p>}
      {done && <p className="banner banner--info" role="status">{done}</p>}
      {error ? <p className="banner banner--danger" role="alert">{describeOpsError(error, locale)}</p> : null}
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
          onAssigned={(result) => {
            setAssigning(false)
            void qc.invalidateQueries({ queryKey: trialKeys.newStudents })
            const missing = result.schedules.filter((x) => !x.set)
            if (missing.length > 0) setNotice(`${tx(S.timesNotSet)} ${[...new Set(missing.map((m) => m.reason))].join(' · ')}`)
          }}
        />
      )}
    </section>
  )
}

function AssignDialog({ s, onClose, onAssigned }: { s: NewStudentDto; onClose: () => void; onAssigned: (r: AssignResult) => void }) {
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
        <select id={`${id}-sup`} className="select" value={supervisorId} onChange={(ev) => setSupervisorId(ev.target.value)} aria-invalid={touched && !supervisorId}>
          <option value="">{tx(S.choose)}</option>
          {supervisors.map((m) => (
            <option key={m.id} value={m.id}>{m.name} ({m.learnerCount})</option>
          ))}
        </select>
        {touched && !supervisorId && <span className="field__error">{tx(S.required)}</span>}
      </div>
      <div className="field">
        <label className="field__label" htmlFor={`${id}-email`}>{tx(S.email)}</label>
        <input id={`${id}-email`} className="input" type="email" dir="ltr" value={email} onChange={(ev) => setEmail(ev.target.value)} aria-invalid={touched && !email.trim()} />
        <span className="field__hint">{tx(S.emailHint)}</span>
        {touched && !email.trim() && <span className="field__error">{tx(S.required)}</span>}
      </div>
      {error ? <p className="banner banner--danger" role="alert">{describeOpsError(error, locale)}</p> : null}
    </Dialog>
  )
}
