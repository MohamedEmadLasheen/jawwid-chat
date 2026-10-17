import { useEffect, useId, useMemo, useState, type InputHTMLAttributes, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import { Icon, type IconName } from '@/shared/components/Icon'
import { PageHeader } from '@/shared/components/PageHeader'
import { fill, usePlural, useText } from '@/features/admin/copy'
import { useDocumentTitle } from '@/features/admin/common'
import {
  ACCEPT,
  BACKGROUNDS,
  probeDuration,
  uploadStoryMedia,
  type Background,
  type CreateStoryInput,
  type CtaKind,
  type StoryKind,
  type UploadedMedia,
} from './api'
import { AudienceBuilder, EMPTY_AUDIENCE, toClauses, type AudienceDraft } from './AudienceBuilder'
import { BACKGROUND_LABEL, COUNT, CTA_DEFAULT_TEXT, CTA_LABEL, KIND_LABEL, S } from './copy'
import { useAudienceEstimate, useAudienceFacts, useCanManageAudienceData, useCreateStory } from './hooks'
import { StoryPreview } from './StoryPreview'
import { VoiceRecorder } from './VoiceRecorder'
import './stories.css'

const MAX_BODY = 2000

const KINDS: Array<{ key: StoryKind; icon: IconName }> = [
  { key: 'text', icon: 'text' },
  { key: 'image', icon: 'image' },
  { key: 'video', icon: 'video' },
  { key: 'voice', icon: 'mic' },
]

const CTA_ICON: Record<CtaKind, IconName> = { whatsapp: 'whatsapp', message_publisher: 'messages', link: 'link' }

interface MediaState {
  uploaded: UploadedMedia | null
  previewUrl: string
  name: string
}

/**
 * Compose a story in four short steps -- what it is, an optional button, who
 * sees it, an optional name -- with the phone preview and the live audience
 * size beside it the whole time, so nothing is a surprise at "Publish".
 */
export function StoryComposer({ basePath }: { basePath: string }) {
  const tx = useText()
  const { number } = useI18n()
  const plural = usePlural()
  const navigate = useNavigate()
  useDocumentTitle(tx(S.composeTitle))

  const [kind, setKind] = useState<StoryKind>('text')
  const [body, setBody] = useState('')
  const [background, setBackground] = useState<Background>('teal')
  const [media, setMedia] = useState<MediaState | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [ctaKind, setCtaKind] = useState<CtaKind | null>(null)
  const [ctaLabel, setCtaLabel] = useState('')
  const [ctaPhone, setCtaPhone] = useState('')
  const [ctaUrl, setCtaUrl] = useState('')
  const [audience, setAudience] = useState<AudienceDraft>(EMPTY_AUDIENCE)
  const [internalName, setInternalName] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [attempted, setAttempted] = useState(false)

  const canManageData = useCanManageAudienceData()
  const facts = useAudienceFacts()
  const clauses = useMemo(() => toClauses(audience), [audience])
  const estimate = useAudienceEstimate(clauses, ctaKind)
  const create = useCreateStory()

  // Release the local preview of a replaced or abandoned file.
  const previewUrl = media?.previewUrl
  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
  }, [previewUrl])

  function switchKind(next: StoryKind) {
    if (next === kind) return
    setKind(next)
    setMedia(null)
    setUploadError(null)
  }

  async function takeFile(file: Blob, name: string, durationMs?: number) {
    setUploadError(null)
    const local = URL.createObjectURL(file)
    setMedia({ uploaded: null, previewUrl: local, name })
    setUploading(true)
    try {
      const probed =
        durationMs ?? (kind === 'video' || kind === 'voice' ? await probeDuration(file, kind === 'voice' ? 'audio' : 'video') : undefined)
      const uploaded = await uploadStoryMedia(file, probed)
      setMedia({ uploaded, previewUrl: local, name })
    } catch (e) {
      // Shown, never swallowed: a failed upload that looked like a success is
      // how a story goes out with nothing in it.
      setUploadError(e instanceof Error && e.message ? e.message : tx(S.uploadFailed))
      setMedia(null)
    } finally {
      setUploading(false)
    }
  }

  const contentReady = kind === 'text' ? body.trim().length > 0 : Boolean(media?.uploaded)
  const ctaProblem = ctaError(ctaKind, ctaUrl, ctaPhone, tx)
  const audienceReady = Boolean(clauses)
  const reach = estimate.data?.recipients
  const ready = contentReady && audienceReady && !ctaProblem && !uploading && reach !== 0

  function input(): CreateStoryInput {
    const base: CreateStoryInput = {
      audiences: clauses ?? [],
      ...(internalName.trim() ? { internalName: internalName.trim() } : {}),
      ...(ctaKind
        ? {
            cta: {
              kind: ctaKind,
              ...(ctaLabel.trim() ? { label: ctaLabel.trim() } : {}),
              ...(ctaKind === 'link' ? { url: ctaUrl.trim() } : {}),
              ...(ctaKind === 'whatsapp' ? { phone: ctaPhone.trim() } : {}),
            },
          }
        : {}),
    }
    if (kind === 'text') return { ...base, body: body.trim(), background }
    return {
      ...base,
      ...media!.uploaded!,
      ...(kind === 'voice' ? { background } : {}),
    }
  }

  function submit(publish: boolean) {
    setAttempted(true)
    if (!ready) return
    if (publish && !confirming) {
      setConfirming(true)
      return
    }
    create.mutate(
      { input: input(), publish },
      {
        onSuccess: (story) => {
          setConfirming(false)
          navigate(publish ? `${basePath}/${story.id}` : basePath)
        },
        onError: () => setConfirming(false),
      },
    )
  }

  const previewModel = {
    kind,
    body: kind === 'text' ? body : null,
    background,
    mediaUrl: media?.previewUrl ?? null,
    mediaDurationMs: media?.uploaded?.mediaDurationMs ?? null,
    cta: ctaKind ? { kind: ctaKind, label: ctaLabel || null } : null,
  }

  return (
    <div className="page stories-studio">
      <div className="page__inner">
        <Link to={basePath} className="back-link">
          <Icon name="arrowBack" size={16} />
          {tx(S.back)}
        </Link>
        <PageHeader title={tx(S.composeTitle)} />

        <div className="composer">
          <div className="composer__form">
            {/* 1 · Content */}
            <Step n={1} title={tx(S.stepContent)}>
              <div className="type-cards" role="radiogroup" aria-label={tx(S.storyType)}>
                {KINDS.map((k) => (
                  <label key={k.key} className={`type-card${kind === k.key ? ' is-selected' : ''}`}>
                    <input
                      type="radio"
                      name="story-kind"
                      className="sr-only"
                      checked={kind === k.key}
                      onChange={() => switchKind(k.key)}
                    />
                    <Icon name={k.icon} size={22} />
                    <span>{tx(KIND_LABEL[k.key])}</span>
                  </label>
                ))}
              </div>

              {kind === 'text' && (
                <div className="field">
                  <textarea
                    className="input story-textarea"
                    value={body}
                    onChange={(e) => setBody(e.target.value.slice(0, MAX_BODY))}
                    placeholder={tx(S.textPlaceholder)}
                    aria-label={tx(S.textPlaceholder)}
                    dir="auto"
                    rows={5}
                  />
                  <p className="field__hint">{fill(tx(S.charsLeft), { n: number(MAX_BODY - body.length) })}</p>
                </div>
              )}

              {(kind === 'image' || kind === 'video' || kind === 'voice') && (
                <div className="field">
                  {kind === 'voice' && !media && (
                    <div className="voice-pick">
                      <VoiceRecorder disabled={uploading} onRecorded={(blob, ms) => void takeFile(blob, 'voice.m4a', ms)} />
                      <span className="voice-pick__or">{tx(S.orUpload)}</span>
                    </div>
                  )}
                  <MediaPicker
                    kind={kind}
                    media={media}
                    uploading={uploading}
                    onFile={(f) => void takeFile(f, f.name)}
                    onRemove={() => setMedia(null)}
                  />
                  {uploadError && <p className="field__error" role="alert">{uploadError}</p>}
                  <p className="field__hint">{tx(S.noCaption)}</p>
                </div>
              )}

              {(kind === 'text' || kind === 'voice') && (
                <div className="field">
                  <span className="field__label" id="bg-label">{tx(S.background)}</span>
                  <div className="swatches" role="radiogroup" aria-labelledby="bg-label">
                    {BACKGROUNDS.map((b) => (
                      <label key={b} className={`swatch story-bg--${b}${background === b ? ' is-selected' : ''}`}>
                        <input
                          type="radio"
                          name="story-bg"
                          className="sr-only"
                          checked={background === b}
                          onChange={() => setBackground(b)}
                        />
                        <span className="sr-only">{tx(BACKGROUND_LABEL[b]!)}</span>
                        {background === b && <Icon name="check" size={14} />}
                      </label>
                    ))}
                  </div>
                </div>
              )}
              {attempted && !contentReady && !uploading && <p className="field__error">{tx(S.needContent)}</p>}
            </Step>

            {/* 2 · Button */}
            <Step n={2} title={tx(S.stepButton)}>
              <div className="cta-choices" role="radiogroup" aria-label={tx(S.stepButton)}>
                <CtaChoice selected={ctaKind === null} onSelect={() => setCtaKind(null)} icon="close" label={tx(S.ctaNone)} />
                {(Object.keys(CTA_LABEL) as CtaKind[]).map((k) => (
                  <CtaChoice key={k} selected={ctaKind === k} onSelect={() => setCtaKind(k)} icon={CTA_ICON[k]} label={tx(CTA_LABEL[k])} />
                ))}
              </div>

              {ctaKind === 'whatsapp' && (
                <TextField
                  label={tx(S.ctaPhone)}
                  hint={tx(S.ctaPhoneHint)}
                  value={ctaPhone}
                  onChange={setCtaPhone}
                  inputMode="tel"
                  dir="ltr"
                  error={attempted ? ctaProblem : null}
                />
              )}
              {ctaKind === 'link' && (
                <TextField
                  label={tx(S.ctaUrl)}
                  hint={tx(S.ctaUrlHint)}
                  value={ctaUrl}
                  onChange={setCtaUrl}
                  inputMode="url"
                  placeholder="https://"
                  dir="ltr"
                  error={attempted ? ctaProblem : null}
                />
              )}
              {ctaKind === 'message_publisher' && <p className="field__hint">{tx(S.ctaMessageHint)}</p>}
              {ctaKind && (
                <TextField
                  label={tx(S.ctaLabel)}
                  hint={fill(tx(S.ctaLabelHint), { default: tx(CTA_DEFAULT_TEXT[ctaKind]) })}
                  value={ctaLabel}
                  onChange={(v) => setCtaLabel(v.slice(0, 40))}
                  dir="auto"
                />
              )}
            </Step>

            {/* 3 · Audience */}
            <Step n={3} title={tx(S.stepAudience)}>
              <AudienceBuilder
                value={audience}
                onChange={setAudience}
                facts={facts.data}
                dataPath={canManageData ? `${basePath}?tab=audience` : null}
              />
              {attempted && !audienceReady && <p className="field__error">{tx(S.needAudience)}</p>}
            </Step>

            {/* 4 · Name */}
            <Step n={4} title={tx(S.stepName)}>
              <TextField
                label={tx(S.internalName)}
                hint={tx(S.internalNameHint)}
                value={internalName}
                onChange={(v) => setInternalName(v.slice(0, 120))}
                dir="auto"
              />
            </Step>
          </div>

          <aside className="composer__aside">
            <div className="composer__sticky">
              <StoryPreview story={previewModel} />
              <ReachCard
                loading={estimate.isFetching && !estimate.data}
                hasAudience={audienceReady}
                estimate={estimate.data}
                error={estimate.error as Error | null}
              />
              {create.error && (
                <p className="field__error" role="alert">{(create.error as Error).message}</p>
              )}
              <div className="composer__actions">
                <button type="button" className="btn" onClick={() => submit(false)} disabled={create.isPending}>
                  {tx(S.saveDraft)}
                </button>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => submit(true)}
                  disabled={create.isPending || (attempted && !ready)}
                >
                  <Icon name="send" size={16} />
                  {tx(S.publishNow)}
                </button>
              </div>
            </div>
          </aside>
        </div>
      </div>

      {confirming && (
        <Dialog
          title={tx(S.confirmTitle)}
          onClose={() => setConfirming(false)}
          footer={
            <>
              <DialogCancelButton onClick={() => setConfirming(false)} />
              <button type="button" className="btn btn--primary" onClick={() => submit(true)} disabled={create.isPending}>
                {tx(S.publishNow)}
              </button>
            </>
          }
        >
          <p>{fill(tx(S.confirmBody), { n: plural(COUNT.people, reach ?? 0) })}</p>
        </Dialog>
      )}
    </div>
  )
}

function ctaError(
  kind: CtaKind | null,
  url: string,
  phone: string,
  tx: (b: { en: string; ar: string }) => string,
): string | null {
  if (kind === 'link') {
    try {
      const u = new URL(url.trim())
      return u.protocol === 'https:' ? null : tx(S.ctaUrlHint)
    } catch {
      return tx(S.ctaUrlHint)
    }
  }
  if (kind === 'whatsapp') {
    const digits = phone.replace(/[\s\-().]/g, '').replace(/^(\+|00)/, '')
    return /^[1-9][0-9]{6,14}$/.test(digits) ? null : tx(S.ctaPhoneHint)
  }
  return null
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="compose-step" aria-labelledby={`compose-step-${n}`}>
      <h2 className="compose-step__title" id={`compose-step-${n}`}>
        <span className="compose-step__num" aria-hidden="true">{n}</span>
        {title}
      </h2>
      {children}
    </section>
  )
}

function CtaChoice({
  selected,
  onSelect,
  icon,
  label,
}: {
  selected: boolean
  onSelect: () => void
  icon: IconName
  label: string
}) {
  return (
    <label className={`cta-choice${selected ? ' is-selected' : ''}`}>
      <input type="radio" name="story-cta" className="sr-only" checked={selected} onChange={onSelect} />
      <Icon name={icon} size={16} />
      <span>{label}</span>
    </label>
  )
}

function TextField({
  label,
  hint,
  value,
  onChange,
  error,
  ...rest
}: {
  label: string
  hint?: string
  value: string
  onChange: (v: string) => void
  error?: string | null
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const id = useId()
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>{label}</label>
      <input
        id={id}
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby={hint ? `${id}-hint` : undefined}
        aria-invalid={error ? true : undefined}
        {...rest}
      />
      {hint && <p className="field__hint" id={`${id}-hint`}>{hint}</p>}
      {error && <p className="field__error">{error}</p>}
    </div>
  )
}

function MediaPicker({
  kind,
  media,
  uploading,
  onFile,
  onRemove,
}: {
  kind: 'image' | 'video' | 'voice'
  media: MediaState | null
  uploading: boolean
  onFile: (f: File) => void
  onRemove: () => void
}) {
  const tx = useText()
  const [over, setOver] = useState(false)
  const limits = kind === 'image' ? S.photoLimits : kind === 'video' ? S.videoLimits : S.voiceLimits

  if (media) {
    return (
      <div className="media-chosen">
        <Icon name={kind === 'image' ? 'image' : kind === 'video' ? 'video' : 'mic'} size={18} />
        <span className="media-chosen__name" dir="auto">{media.name}</span>
        {uploading ? (
          <span className="media-chosen__status" role="status">{tx(S.uploading)}</span>
        ) : (
          <span className="media-chosen__status media-chosen__status--ok">
            <Icon name="check" size={14} />
          </span>
        )}
        <button type="button" className="btn btn--ghost btn--sm" onClick={onRemove} disabled={uploading}>
          {tx(S.remove)}
        </button>
      </div>
    )
  }

  return (
    <label
      className={`dropzone${over ? ' is-over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        const f = e.dataTransfer.files?.[0]
        if (f) onFile(f)
      }}
    >
      <input
        type="file"
        className="sr-only"
        accept={ACCEPT[kind]}
        aria-label={tx(S.chooseFile)}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onFile(f)
          e.target.value = ''
        }}
      />
      <span className="dropzone__icon" aria-hidden="true"><Icon name="upload" size={22} /></span>
      <span className="dropzone__title">{tx(S.dropHint)}</span>
      <span className="dropzone__hint">{tx(limits)}</span>
    </label>
  )
}

function ReachCard({
  loading,
  hasAudience,
  estimate,
  error,
}: {
  loading: boolean
  hasAudience: boolean
  estimate: { recipients: number; contacts: number; teachers: number; families: number; excludedByReplyScope: number } | undefined
  error: Error | null
}) {
  const tx = useText()
  const plural = usePlural()
  const { number } = useI18n()
  if (!hasAudience) return null
  return (
    <div className="reach-card" aria-live="polite">
      <span className="reach-card__label">{tx(S.willReach)}</span>
      {loading || !estimate ? (
        <span className="reach-card__value reach-card__value--muted">{error ? '—' : tx(S.estimating)}</span>
      ) : (
        <>
          <span className="reach-card__value">{plural(COUNT.people, estimate.recipients)}</span>
          <span className="reach-card__split">
            {[
              estimate.contacts > 0 && plural(COUNT.parents, estimate.contacts),
              estimate.teachers > 0 && plural(COUNT.teachers, estimate.teachers),
              estimate.families > 0 && plural(COUNT.families, estimate.families),
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
          {estimate.recipients === 0 && <span className="field__error">{tx(S.emptyAudience)}</span>}
          {estimate.excludedByReplyScope > 0 && (
            <span className="reach-card__note">
              {fill(tx(S.excludedNote), { n: number(estimate.excludedByReplyScope) })}
            </span>
          )}
        </>
      )}
      {error && <span className="field__error">{error.message}</span>}
    </div>
  )
}
