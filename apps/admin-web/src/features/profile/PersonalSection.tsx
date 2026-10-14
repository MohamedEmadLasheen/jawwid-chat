import { useEffect, useId, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useI18n } from '@/core/i18n/I18nProvider'
import { ABOUT_MAX, DISPLAY_NAME_MAX, JOB_TITLE_MAX, profileKeys, staffProfileApi, type StaffProfile } from './api'
import { ACCOUNT_STATUS_LABEL, ROLE_LABEL, T, useCopy } from './copy'
import { describeError, isConflict } from './errors'
import { useAvatarRemove, useAvatarUpload, useUpdateProfile } from './hooks'
import { preparePhoto, type PreparedPhoto } from './photo'
import { StaffAvatar } from './StaffAvatar'

/**
 * Section A + B: the photo, the name, the job title and the introduction.
 *
 * Each control renders only when the server's `access` flag for it is true,
 * and the server refuses the write anyway when it is not. Saving sends ONLY
 * the fields in this form plus the version it was loaded at, so two editors
 * (the person and their manager) cannot silently overwrite each other.
 */
export function PersonalSection({ profile, refKey }: { profile: StaffProfile; refKey: string }) {
  const tx = useCopy()
  const { dateTime } = useI18n()
  const { access } = profile
  const [editing, setEditing] = useState(false)
  const someoneElse = access.relation !== 'self'

  return (
    <section className="card sp-card" aria-labelledby="sp-personal">
      <div className="sp-card__head">
        <h2 id="sp-personal" className="sp-card__title">{tx(T.personal)}</h2>
        {(access.canEditProfessional || access.canEditDisplayName) && !editing && (
          <button type="button" className="btn btn--sm" onClick={() => setEditing(true)}>
            {tx(T.edit)}
          </button>
        )}
      </div>

      <div className="sp-identity">
        <PhotoControl profile={profile} refKey={refKey} />
        <div className="sp-identity__text">
          <div className="sp-name">{profile.displayName}</div>
          <div className="sp-title">{profile.jobTitle ?? <span className="sp-muted">{tx(T.notSet)}</span>}</div>
          <div className="sp-chips">
            <span className="badge badge--coverage">{tx(ROLE_LABEL[profile.role] ?? { en: profile.role, ar: profile.role })}</span>
            {profile.isActive ? (
              <span className="badge badge--ok">{tx(T.active)}</span>
            ) : (
              <span className="badge badge--danger">{tx(T.inactive)}</span>
            )}
          </div>
        </div>
      </div>

      {editing ? (
        <ProfessionalForm profile={profile} refKey={refKey} onDone={() => setEditing(false)} />
      ) : (
        <>
          <h3 className="sp-subtitle">{tx(T.about)}</h3>
          {profile.about ? (
            <p className="sp-about" dir="auto">{profile.about}</p>
          ) : (
            <p className="sp-muted">{tx(T.aboutEmpty)}</p>
          )}
        </>
      )}

      {profile.profileUpdatedAt && profile.profileUpdatedBy && (
        <p className="sp-footnote">
          {tx(T.lastUpdated, { when: dateTime(profile.profileUpdatedAt), who: profile.profileUpdatedBy.displayName })}
        </p>
      )}
      {someoneElse && access.canEditProfessional && (
        <p className="sp-footnote">{tx(T.editingFor, { name: profile.displayName })}</p>
      )}
    </section>
  )
}

function ProfessionalForm({ profile, refKey, onDone }: { profile: StaffProfile; refKey: string; onDone: () => void }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const ids = { name: useId(), title: useId(), about: useId(), reason: useId() }
  const save = useUpdateProfile(refKey)
  const queryClient = useQueryClient()
  const { access } = profile
  const [latest, setLatest] = useState<StaffProfile | null>(null)

  const [name, setName] = useState(profile.displayName)
  const [title, setTitle] = useState(profile.jobTitle ?? '')
  const [about, setAbout] = useState(profile.about ?? '')
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  // The version the user started editing from -- not whatever is cached now.
  const version = useRef(profile.version)

  const titleLen = Array.from(title.trim()).length
  const aboutLen = Array.from(about.trim()).length
  const nameLen = Array.from(name.trim()).length
  const errors = {
    title: titleLen > JOB_TITLE_MAX ? tx(T.tooLong, { max: JOB_TITLE_MAX }) : null,
    about: aboutLen > ABOUT_MAX ? tx(T.tooLong, { max: ABOUT_MAX }) : null,
    name:
      access.canEditDisplayName && nameLen === 0 ? tx(T.required)
      : nameLen > DISPLAY_NAME_MAX ? tx(T.tooLong, { max: DISPLAY_NAME_MAX })
      : null,
  }
  const invalid = Boolean(errors.title || errors.about || errors.name)

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    setTouched(true)
    if (invalid) return
    const body: Parameters<typeof save.mutate>[0] = { expectedVersion: version.current }
    if (access.canEditProfessional) {
      body.jobTitle = title
      body.about = about
    }
    if (access.canEditDisplayName && name.trim() !== profile.displayName) body.displayName = name
    if (access.relation !== 'self' && reason.trim()) body.reason = reason
    save.mutate(body, { onSuccess: onDone })
  }

  return (
    <form className="sp-form" onSubmit={submit} noValidate>
      {access.canEditDisplayName && (
        <div className="field">
          <label className="field__label" htmlFor={ids.name}>{tx(T.displayName)}</label>
          <input
            id={ids.name}
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={touched && Boolean(errors.name)}
            aria-describedby={`${ids.name}-hint`}
            dir="auto"
          />
          <span id={`${ids.name}-hint`} className={touched && errors.name ? 'field__error' : 'field__hint'}>
            {(touched && errors.name) || tx(T.displayNameHint)}
          </span>
        </div>
      )}
      {access.canEditProfessional && (
        <>
          <div className="field">
            <label className="field__label" htmlFor={ids.title}>{tx(T.jobTitle)}</label>
            <input
              id={ids.title}
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              aria-invalid={Boolean(errors.title)}
              aria-describedby={`${ids.title}-hint`}
              dir="auto"
            />
            <span id={`${ids.title}-hint`} className={errors.title ? 'field__error' : 'field__hint'}>
              {errors.title ?? tx(T.jobTitleHint)}
            </span>
          </div>
          <div className="field">
            <label className="field__label" htmlFor={ids.about}>{tx(T.about)}</label>
            <textarea
              id={ids.about}
              className="textarea sp-textarea"
              value={about}
              rows={7}
              onChange={(e) => setAbout(e.target.value)}
              aria-invalid={Boolean(errors.about)}
              aria-describedby={`${ids.about}-hint ${ids.about}-count`}
              dir="auto"
            />
            <span id={`${ids.about}-hint`} className={errors.about ? 'field__error' : 'field__hint'}>
              {errors.about ?? tx(T.aboutHint)}
            </span>
            <span id={`${ids.about}-count`} className="field__hint" aria-live="polite">
              {tx(T.charCount, { n: aboutLen, max: ABOUT_MAX })}
            </span>
          </div>
        </>
      )}
      {access.relation !== 'self' && (
        <div className="field">
          <label className="field__label" htmlFor={ids.reason}>{tx(T.editReason)}</label>
          <input id={ids.reason} className="input" value={reason} onChange={(e) => setReason(e.target.value)} dir="auto" />
        </div>
      )}

      {save.error && (
        <div className="banner banner--danger" role="alert">
          {describeError(save.error, locale)}
          {isConflict(save.error) && (
            <button
              type="button"
              className="btn btn--sm"
              style={{ marginInlineStart: 8 }}
              onClick={async () => {
                // Fetch the newer version WITHOUT touching the form: what the
                // user typed stays, and the next Save is a deliberate overwrite.
                const fresh = await queryClient.fetchQuery({
                  queryKey: profileKeys.profile(refKey),
                  queryFn: () => staffProfileApi.get(refKey),
                  staleTime: 0,
                })
                version.current = fresh.version
                setLatest(fresh)
                save.reset()
              }}
            >
              {tx(T.reload)}
            </button>
          )}
        </div>
      )}
      {latest && (
        <div className="banner banner--info" role="status">
          {tx(T.latestLoaded)}
          <div className="sp-latest">
            <strong>{tx(T.jobTitle)}:</strong> <span dir="auto">{latest.jobTitle ?? '—'}</span>
            <br />
            <strong>{tx(T.about)}:</strong> <span dir="auto" className="sp-about">{latest.about ?? '—'}</span>
          </div>
        </div>
      )}

      <div className="sp-actions">
        <button type="button" className="btn" onClick={onDone} disabled={save.isPending}>
          {tx(T.cancel)}
        </button>
        <button type="submit" className="btn btn--primary" disabled={save.isPending}>
          {save.isPending ? tx(T.saving) : tx(T.save)}
        </button>
      </div>
    </form>
  )
}

/** Choose -> preview -> save; or remove. The current photo stays until the new one is committed. */
function PhotoControl({ profile, refKey }: { profile: StaffProfile; refKey: string }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const inputId = useId()
  const fileRef = useRef<HTMLInputElement>(null)
  const upload = useAvatarUpload(refKey)
  const remove = useAvatarRemove(refKey)
  const [prepared, setPrepared] = useState<PreparedPhoto | null>(null)
  const [problem, setProblem] = useState<unknown>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => () => {
    if (prepared) URL.revokeObjectURL?.(prepared.previewUrl)
  }, [prepared])

  if (!profile.access.canEditPhoto) {
    return <StaffAvatar name={profile.displayName} url={profile.avatarUrl} size={96} />
  }

  const choose = async (file: File | undefined) => {
    setProblem(null)
    setNotice(null)
    if (!file) return
    try {
      setPrepared(await preparePhoto(file))
    } catch (error) {
      setProblem(error)
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const busy = upload.isPending || remove.isPending
  const error = problem ?? upload.error ?? remove.error

  return (
    <div className="sp-photo">
      {prepared ? (
        <img className="sp-avatar" src={prepared.previewUrl} alt={tx(T.photoPreview)} style={{ inlineSize: 96, blockSize: 96 }} />
      ) : (
        <StaffAvatar name={profile.displayName} url={profile.avatarUrl} size={96} />
      )}
      <div className="sp-photo__controls">
        {prepared ? (
          <>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              disabled={busy}
              onClick={() =>
                upload.mutate(prepared.blob, {
                  onSuccess: () => {
                    setPrepared(null)
                    setNotice(tx(T.photoSaved))
                  },
                })
              }
            >
              {upload.isPending ? tx(T.photoUploading) : tx(T.photoUse)}
            </button>
            <button type="button" className="btn btn--sm" disabled={busy} onClick={() => setPrepared(null)}>
              {tx(T.cancel)}
            </button>
          </>
        ) : (
          <>
            <label htmlFor={inputId} className="btn btn--sm sp-file-label">
              {profile.avatarUrl ? tx(T.photoReplace) : tx(T.photoChoose)}
            </label>
            <input
              ref={fileRef}
              id={inputId}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sp-file-input"
              aria-describedby={`${inputId}-hint`}
              disabled={busy}
              onChange={(e) => void choose(e.target.files?.[0])}
            />
            {profile.avatarUrl && (
              <button
                type="button"
                className="btn btn--sm btn--ghost"
                disabled={busy}
                onClick={() => remove.mutate(undefined, { onSuccess: () => setNotice(tx(T.photoRemoved)) })}
              >
                {tx(T.photoRemove)}
              </button>
            )}
          </>
        )}
        <span id={`${inputId}-hint`} className="field__hint">{tx(T.photoHint)}</span>
        {error ? (
          <span className="field__error" role="alert">{describeError(error, locale)}</span>
        ) : notice ? (
          <span className="sp-ok" role="status">{notice}</span>
        ) : null}
      </div>
    </div>
  )
}

/** Account facts: read-only for everyone, because they are official fields. */
export function AccountSection({ profile }: { profile: StaffProfile }) {
  const tx = useCopy()
  const { date, dateTime } = useI18n()
  const status = profile.account.status
  return (
    <section className="card sp-card" aria-labelledby="sp-account">
      <h2 id="sp-account" className="sp-card__title">{tx(T.accountFacts)}</h2>
      <dl className="sp-facts">
        <dt>{tx(T.role)}</dt>
        <dd>{tx(ROLE_LABEL[profile.role] ?? { en: profile.role, ar: profile.role })}</dd>
        <dt>{tx(T.status)}</dt>
        <dd>
          {!profile.account.hasLogin
            ? tx(T.noLogin)
            : status
              ? tx(ACCOUNT_STATUS_LABEL[status] ?? { en: status, ar: status })
              : tx(T.never)}
        </dd>
        <dt>{tx(T.reportsTo)}</dt>
        <dd>{profile.reportingManager ? profile.reportingManager.displayName : <span className="sp-muted">{tx(T.noManager)}</span>}</dd>
        <dt>{tx(T.joined)}</dt>
        <dd>{date(profile.joinedAt)}</dd>
        <dt>{tx(T.lastActivity)}</dt>
        <dd>{profile.lastActivityAt ? dateTime(profile.lastActivityAt) : tx(T.never)}</dd>
        {profile.signInIdentity && (
          <>
            <dt>{tx(T.signIn)}</dt>
            <dd dir="ltr" className="sp-ltr">{profile.signInIdentity}</dd>
          </>
        )}
      </dl>
      <p className="sp-footnote">{tx(T.officialFieldsNote)}</p>
      <p className="sp-footnote">{tx(T.contactNote)}</p>
    </section>
  )
}
