import { useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useI18n } from '@/core/i18n/I18nProvider'
import { ApiError } from '@/core/api/errors'
import { Badge, type Tone } from '@/shared/components/Badge'
import { PageHeader } from '@/shared/components/PageHeader'
import { QueryBoundary } from '@/shared/components/States'
import { useCopy, type Pair } from '@/features/organization/copy'
import {
  LESSONS,
  REJECT_CATEGORIES,
  lessonAudioApi,
  lessonAudioKeys,
  type ClipView,
  type RejectCategory,
  type StringStatus,
  type StringView,
} from './api'
import { browserPlayer, type ClipPlayer } from './player'
import './lesson-audio.css'

/** PD-48 copy, Arabic and English side by side. */
const C = {
  title: { en: 'Lesson audio', ar: 'تسجيلات الدروس' },
  subtitle: {
    en: 'Computer-voice clips for the lessons. Listen to each one to the end next to its text. A clip plays to children only after two different reviewers approved it; one rejection is final.',
    ar: 'تسجيلات بصوت حاسوبي للدروس. استمع إلى كل تسجيل حتى نهايته بجانب نصه. لا يُسمَع التسجيل للأطفال إلا بعد أن يعتمده مراجعان مختلفان، ورفضٌ واحد نهائي.',
  },
  lesson: { en: 'Lesson', ar: 'الدرس' },
  unit: { en: 'Unit', ar: 'الوحدة' },
  pendingFile: { en: 'The lesson file itself is still under review: families hear nothing yet.', ar: 'ملف الدرس نفسه ما زال قيد المراجعة: لا تسمع الأسر شيئًا بعد.' },
  listen: { en: 'Listen', ar: 'استمع' },
  playing: { en: 'Playing…', ar: 'يُشغَّل…' },
  playUnit: { en: 'Play the unit', ar: 'تشغيل الوحدة' },
  stop: { en: 'Stop', ar: 'إيقاف' },
  approve: { en: 'Approve', ar: 'اعتماد' },
  approveHint: { en: 'Listen to the end first.', ar: 'استمع حتى النهاية أولًا.' },
  reject: { en: 'Reject', ar: 'رفض' },
  withdraw: { en: 'Withdraw', ar: 'سحب' },
  category: { en: 'What is wrong', ar: 'ما الخطأ' },
  reason: { en: 'Reason', ar: 'السبب' },
  confirm: { en: 'Confirm', ar: 'تأكيد' },
  cancel: { en: 'Cancel', ar: 'إلغاء' },
  mismatch: { en: 'The file is not the approved clip: it was not played. Report it.', ar: 'الملف ليس التسجيل المعتمد، فلم يُشغَّل. أبلغ عن ذلك.' },
  approvals: { en: '{n} of {of} approvals', ar: '{n} من {of} اعتمادات' },
  attempt: { en: 'Attempt {n}', ar: 'المحاولة {n}' },
  noClip: { en: 'No clip yet.', ar: 'لا يوجد تسجيل بعد.' },
  noAudio: { en: 'Decided: no audio. This word has no play button.', ar: 'تقرّر: بلا صوت. لا يظهر لهذه الكلمة زر تشغيل.' },
  needsDecision: { en: 'Three clips failed. Decide: no audio, or one more round.', ar: 'فشلت ثلاثة تسجيلات. قرّر: بلا صوت، أو جولة أخرى.' },
  decideNoAudio: { en: 'No audio', ar: 'بلا صوت' },
  decideAgain: { en: 'One more round', ar: 'جولة أخرى' },
  history: { en: 'History', ar: 'السجل' },
  approvedBy: { en: 'Approved by {by}', ar: 'اعتمده {by}' },
  by: { en: '{action} by {by}: {reason}', ar: '{action} بواسطة {by}: {reason}' },
} satisfies Record<string, Pair>

const STATUS: Record<StringStatus, { label: Pair; tone: Tone }> = {
  approved: { label: { en: 'Plays', ar: 'يُشغَّل' }, tone: 'ok' },
  pending: { label: { en: 'Waiting for review', ar: 'بانتظار المراجعة' }, tone: 'waiting' },
  needsDecision: { label: { en: 'Needs a decision', ar: 'يحتاج إلى قرار' }, tone: 'danger' },
  noAudio: { label: { en: 'No audio', ar: 'بلا صوت' }, tone: 'internal' },
  none: { label: { en: 'No clip', ar: 'بلا تسجيل' }, tone: 'internal' },
}

const CATEGORY: Record<RejectCategory, Pair> = {
  vowel: { en: 'A vowel (haraka)', ar: 'حركة' },
  final_sukun: { en: 'The final sukun', ar: 'السكون في آخر الكلمة' },
  shadda: { en: 'Shadda', ar: 'الشدة' },
  hamza: { en: 'Hamza', ar: 'الهمزة' },
  letter_sound: { en: 'A letter sound', ar: 'مخرج حرف' },
  stress: { en: 'Stress or rhythm', ar: 'النبر أو الإيقاع' },
  noise: { en: 'Noise or a cut', ar: 'تشويش أو انقطاع' },
  wrong_word: { en: 'Another word', ar: 'كلمة أخرى' },
  other: { en: 'Something else', ar: 'غير ذلك' },
}

const errorText = (e: unknown) => (e instanceof ApiError ? e.message : String((e as Error)?.message ?? e))

/**
 * PD-48: the Lesson audio review page (design §9). One unit at a time: each
 * string's vowelled text, large, beside its clips. Approve opens only after
 * this browser played the clip to the end and its bytes matched; there is no
 * bulk approve -- "Play the unit" only listens.
 */
export function LessonAudioPage({ player: given }: { player?: ClipPlayer } = {}) {
  const tx = useCopy()
  const player = useMemo(() => given ?? browserPlayer(), [given])
  const [lesson] = useState<string>(LESSONS[0])
  const access = useQuery({ queryKey: lessonAudioKeys.access, queryFn: lessonAudioApi.access, staleTime: 60_000, retry: false })
  const summary = useQuery({ queryKey: lessonAudioKeys.summary(lesson), queryFn: () => lessonAudioApi.summary(lesson), enabled: access.data?.view === true })
  const units = summary.data?.units ?? []
  const [unit, setUnit] = useState<string | null>(null)
  const current = unit ?? units[0]?.unit ?? null
  const view = useQuery({
    queryKey: lessonAudioKeys.unit(lesson, current ?? ''),
    queryFn: () => lessonAudioApi.unit(lesson, current!),
    enabled: !!current,
  })

  return (
    <div className="lesson-audio">
      <PageHeader title={tx(C.title)} subtitle={tx(C.subtitle)} />
      <QueryBoundary isLoading={access.isLoading || summary.isLoading} error={access.error ?? summary.error} isEmpty={units.length === 0} emptyTitle={tx(C.noClip)}>
        {summary.data && !summary.data.lessonApproved ? <p className="lesson-audio__note">{tx(C.pendingFile)}</p> : null}
        <nav className="lesson-audio__units" aria-label={tx(C.unit)}>
          {units.map((u) => (
            <button key={u.unit} type="button" aria-pressed={u.unit === current} onClick={() => setUnit(u.unit)}>
              {u.unit} · {u.approved}/{u.strings}
              {u.pending ? <Badge tone="waiting">{u.pending}</Badge> : null}
              {u.needsDecision ? <Badge tone="danger">{u.needsDecision}</Badge> : null}
            </button>
          ))}
        </nav>
        {view.data ? (
          <Unit
            key={`${lesson}:${current}`}
            lesson={lesson}
            strings={view.data.strings}
            required={view.data.approvalsRequired}
            canReview={access.data?.review === true}
            player={player}
          />
        ) : null}
      </QueryBoundary>
    </div>
  )
}

function Unit({ lesson, strings, required, canReview, player }: { lesson: string; strings: StringView[]; required: number; canReview: boolean; player: ClipPlayer }) {
  const tx = useCopy()
  const [playingAll, setPlayingAll] = useState(false)
  const [heard, setHeard] = useState<Record<string, string>>({})
  const [playing, setPlaying] = useState<string | null>(null)
  const [mismatch, setMismatch] = useState<Record<string, boolean>>({})
  const stopAll = useRef(false)

  const listen = async (c: ClipView) => {
    if (!c.url) return false
    setPlaying(c.clipId)
    try {
      const h = await player.play(c.url, c.audioSha256)
      if (!h.matched) {
        setMismatch((m) => ({ ...m, [c.clipId]: true }))
        return false
      }
      setHeard((m) => ({ ...m, [c.clipId]: h.audioSha256 }))
      return true
    } catch {
      return false
    } finally {
      setPlaying((p) => (p === c.clipId ? null : p))
    }
  }

  const playUnit = async () => {
    stopAll.current = false
    setPlayingAll(true)
    for (const s of strings) {
      for (const c of s.clips.filter((x) => x.url)) {
        if (stopAll.current) break
        await listen(c)
        await new Promise((r) => setTimeout(r, 600)) // a pause between clips, to stop and reject
      }
    }
    setPlayingAll(false)
  }

  return (
    <section className="lesson-audio__unit">
      <div className="lesson-audio__bar">
        {playingAll ? (
          <button
            type="button"
            onClick={() => {
              stopAll.current = true
              player.stop()
            }}
          >
            {tx(C.stop)}
          </button>
        ) : (
          <button type="button" onClick={playUnit}>
            {tx(C.playUnit)}
          </button>
        )}
      </div>
      <ol className="lesson-audio__strings">
        {strings.map((s) => (
          <li key={s.id} className={s.clips.some((c) => c.clipId === playing) ? 'is-playing' : undefined}>
            <div className="lesson-audio__text" lang="ar" dir="rtl">
              {s.text}
            </div>
            <div className="lesson-audio__meta">
              <code>{s.id}</code> <Badge tone={STATUS[s.status].tone}>{tx(STATUS[s.status].label)}</Badge>
            </div>
            {s.status === 'noAudio' ? <p>{tx(C.noAudio)}</p> : null}
            {s.status === 'needsDecision' && canReview ? <Decision lesson={lesson} s={s} /> : null}
            {s.clips.length === 0 && s.status === 'none' ? <p>{tx(C.noClip)}</p> : null}
            {s.clips.map((c) => (
              <Clip
                key={c.clipId}
                s={s}
                c={c}
                required={required}
                canReview={canReview}
                heard={heard[c.clipId]}
                mismatch={!!mismatch[c.clipId]}
                playing={playing === c.clipId}
                onListen={() => void listen(c)}
              />
            ))}
          </li>
        ))}
      </ol>
    </section>
  )
}

function Clip(props: {
  s: StringView
  c: ClipView
  required: number
  canReview: boolean
  heard: string | undefined
  mismatch: boolean
  playing: boolean
  onListen: () => void
}) {
  const { s, c, required, canReview, heard, mismatch, playing, onListen } = props
  const tx = useCopy()
  const { dateTime } = useI18n()
  const qc = useQueryClient()
  const [form, setForm] = useState<'reject' | 'withdraw' | null>(null)
  const [category, setCategory] = useState<RejectCategory>('vowel')
  const [reason, setReason] = useState('')
  const refresh = () => qc.invalidateQueries({ queryKey: lessonAudioKeys.all })
  const hashes = { textSha256: s.textSha256, audioSha256: heard ?? '' }
  const approve = useMutation({ mutationFn: () => lessonAudioApi.approve(c.clipId, hashes), onSuccess: refresh })
  const refuse = useMutation({
    mutationFn: () => (form === 'withdraw' ? lessonAudioApi.withdraw : lessonAudioApi.reject)(c.clipId, { ...hashes, category, reason: reason.trim() }),
    onSuccess: () => {
      setForm(null)
      return refresh()
    },
  })
  const error = approve.error ?? refuse.error

  return (
    <div className={`lesson-audio__clip is-${c.state}`} data-testid={`clip-${c.clipId}`}>
      <div className="lesson-audio__row">
        {c.url ? (
          <button type="button" onClick={onListen} disabled={playing}>
            {playing ? tx(C.playing) : tx(C.listen)}
          </button>
        ) : null}
        <span>{tx(C.attempt, { n: c.attempt })}</span>
        <span>{tx(C.approvals, { n: c.approvals.length, of: required })}</span>
        <span className="lesson-audio__voice">
          {c.vendor} · {c.voice}
        </span>
        {canReview && c.canReview ? (
          <>
            <button type="button" className="primary" disabled={!heard || approve.isPending} title={heard ? undefined : tx(C.approveHint)} onClick={() => approve.mutate()}>
              {tx(C.approve)}
            </button>
            <button type="button" disabled={!heard} title={heard ? undefined : tx(C.approveHint)} onClick={() => setForm('reject')}>
              {tx(C.reject)}
            </button>
          </>
        ) : null}
        {canReview && c.state === 'approved' ? (
          <button type="button" disabled={!heard} title={heard ? undefined : tx(C.approveHint)} onClick={() => setForm('withdraw')}>
            {tx(C.withdraw)}
          </button>
        ) : null}
      </div>
      {mismatch ? <p role="alert">{tx(C.mismatch)}</p> : null}
      {form ? (
        <div className="lesson-audio__form">
          <label>
            {tx(C.category)}
            <select value={category} onChange={(e) => setCategory(e.target.value as RejectCategory)}>
              {REJECT_CATEGORIES.map((k) => (
                <option key={k} value={k}>
                  {tx(CATEGORY[k])}
                </option>
              ))}
            </select>
          </label>
          <label>
            {tx(C.reason)}
            <textarea value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
          </label>
          <button type="button" disabled={!reason.trim() || refuse.isPending} onClick={() => refuse.mutate()}>
            {tx(C.confirm)}
          </button>
          <button type="button" onClick={() => setForm(null)}>
            {tx(C.cancel)}
          </button>
        </div>
      ) : null}
      {error ? <p role="alert">{errorText(error)}</p> : null}
      {c.approvals.length || c.rejections.length ? (
        <details>
          <summary>{tx(C.history)}</summary>
          <ul>
            {c.approvals.map((a, i) => (
              <li key={`a${i}`}>
                {tx(C.approvedBy, { by: a.by })} · {dateTime(a.at)}
              </li>
            ))}
            {c.rejections.map((r, i) => (
              <li key={`r${i}`}>
                {tx(C.by, { action: tx(r.action === 'withdraw' ? C.withdraw : C.reject), by: r.by, reason: `${r.category ? tx(CATEGORY[r.category as RejectCategory] ?? { en: r.category, ar: r.category }) : ''} ${r.reason ?? ''}`.trim() })} · {dateTime(r.at)}
              </li>
            ))}
            <li>
              <code>{c.audioSha256.slice(0, 12)}</code>
            </li>
          </ul>
        </details>
      ) : null}
    </div>
  )
}

function Decision({ lesson, s }: { lesson: string; s: StringView }) {
  const tx = useCopy()
  const qc = useQueryClient()
  const [reason, setReason] = useState('')
  const decide = useMutation({
    mutationFn: (decision: 'no_audio' | 'one_more_round') => lessonAudioApi.decide(lesson, s.id, { decision, reason: reason.trim() }),
    onSuccess: () => qc.invalidateQueries({ queryKey: lessonAudioKeys.all }),
  })
  return (
    <div className="lesson-audio__form">
      <p>{tx(C.needsDecision)}</p>
      <label>
        {tx(C.reason)}
        <textarea value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
      </label>
      <button type="button" disabled={!reason.trim() || decide.isPending} onClick={() => decide.mutate('no_audio')}>
        {tx(C.decideNoAudio)}
      </button>
      <button type="button" disabled={!reason.trim() || decide.isPending} onClick={() => decide.mutate('one_more_round')}>
        {tx(C.decideAgain)}
      </button>
      {decide.error ? <p role="alert">{errorText(decide.error)}</p> : null}
    </div>
  )
}

