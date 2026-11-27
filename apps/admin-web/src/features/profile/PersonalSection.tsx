import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useI18n } from '@/core/i18n/I18nProvider'
import { ABOUT_MAX, DISPLAY_NAME_MAX, JOB_TITLE_MAX, profileKeys, staffProfileApi, type StaffProfile } from './api'
import { ACCOUNT_STATUS_LABEL, MISSING_LABEL, ROLE_LABEL, T, useCopy } from './copy'
import { describeError, isConflict } from './errors'
import { useAvatarRemove, useAvatarUpload, useUpdateProfile } from './hooks'
import { preparePhoto, type PreparedPhoto } from './photo'
import { StaffAvatar } from './StaffAvatar'

/**
 * Who this is, at a glance: the photo or monogram, the name in display type,
 * the title they gave themselves, then one line of official facts -- active or
 * not, role, who they report to, when they joined. A photo is chosen, then
 * previewed, then saved, or taken away; the current one stays until the new
 * one is saved. Each control renders only when the server's `access` flag for
 * it is true, and the server refuses the write anyway when it is not.
 */
export function ProfileHead({
  profile,
  refKey,
  heading,
  actions,
}: {
  profile: StaffProfile
  refKey: string
  /** The page's own name ("My profile", "Staff profile"): it stays the page heading. */
  heading: string
  actions?: ReactNode
}) {
  const tx = useCopy()
  const { locale, date } = useI18n()
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

  const canPhoto = profile.access.canEditPhoto
  const busy = upload.isPending || remove.isPending
  const error = problem ?? upload.error ?? remove.error
  const manager = profile.reportingManager

  return (
    <header className="pp-head sp-head">
      <div className="pp-head__mark">
        {prepared ? (
          <img className="sp-avatar" src={prepared.previewUrl} alt={tx(T.photoPreview)} style={{ inlineSize: 76, blockSize: 76 }} />
        ) : (
          <StaffAvatar name={profile.displayName} url={profile.avatarUrl} size={76} />
        )}
      </div>
      <div className="pp-head__text">
        <h1 className="pp-head__eyebrow">{heading}</h1>
        <p className="pp-head__name"><bdi>{profile.displayName}</bdi></p>
        {/* A missing title is named once, in the completeness line; the head stays clean. */}
        {profile.jobTitle && <p className="sp-head__title"><bdi>{profile.jobTitle}</bdi></p>}
        <p className="pp-head__meta">
          {profile.isActive ? (
            <span className="badge badge--ok">{tx(T.active)}</span>
          ) : (
            <span className="badge badge--danger">{tx(T.inactive)}</span>
          )}
          <span>{tx(ROLE_LABEL[profile.role] ?? { en: profile.role, ar: profile.role })}</span>
          {manager && (
            <span>
              {tx(T.reportsToLine)}{' '}
              {/* Only whoever sees the whole organization can be sure to open a manager's profile. */}
              {profile.viewer.organizationOverview ? (
                <Link to={`/profile/${manager.staffId}`} className="sp-head__link">{manager.displayName}</Link>
              ) : (
                <strong>{manager.displayName}</strong>
              )}
            </span>
          )}
          <span>{tx(T.joinedLine, { date: date(profile.joinedAt) })}</span>
        </p>
      </div>
      {(canPhoto || actions) && (
        <div className="pp-head__actions pp-head__actions--stack">
          <div className="pp-head__buttons">
            {canPhoto && prepared && (
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
            )}
            {canPhoto && !prepared && (
              <>
                <label htmlFor={inputId} className="btn btn--sm btn--ghost sp-file-label">
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
            {!prepared && actions}
          </div>
          {canPhoto && <span id={`${inputId}-hint`} className="pp-head__hint">{tx(T.photoHint)}</span>}
          {error ? (
            <span className="field__error" role="alert">{describeError(error, locale)}</span>
          ) : notice ? (
            <span className="sp-ok" role="status">{notice}</span>
          ) : null}
        </div>
      )}
    </header>
  )
}

/**
 * Section B: the introduction, in their own words, and the form that edits it.
 * Saving sends ONLY the fields in the form plus the version it was loaded at,
 * so two editors (the person and their manager) cannot silently overwrite each
 * other. "Edit" is on the file's head; this section shows the form it opens.
 */
export function PersonalSection({
  profile,
  refKey,
  editing,
  onDone,
}: {
  profile: StaffProfile
  refKey: string
  editing: boolean
  onDone: () => void
}) {
  const tx = useCopy()
  const { dateTime } = useI18n()
  const { access } = profile
  const someoneElse = access.relation !== 'self'

  return (
    <section className="pp-sec" aria-labelledby="sp-personal">
      <div className="pp-sec__head">
        <h2 id="sp-personal" className="pp-sec__title">{tx(T.personal)}</h2>
      </div>

      {editing ? (
        <ProfessionalForm profile={profile} refKey={refKey} onDone={onDone} />
      ) : profile.about ? (
        <p className="sp-about" dir="auto">{profile.about}</p>
      ) : (
        <p className="pp-empty">{tx(T.aboutEmpty)}</p>
      )}

      {profile.profileUpdatedAt && profile.profileUpdatedBy && (
        <p className="pp-rule">
          {tx(T.lastUpdated, { when: dateTime(profile.profileUpdatedAt), who: profile.profileUpdatedBy.displayName })}
        </p>
      )}
      {someoneElse && access.canEditProfessional && (
        <p className="pp-rule">{tx(T.editingFor, { name: profile.displayName })}</p>
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

/**
 * Account facts: read-only for everyone, because they are official fields.
 * Profile completeness closes the section as one line over a thin rule.
 */
export function AccountSection({ profile, action }: { profile: StaffProfile; action?: ReactNode }) {
  const tx = useCopy()
  const { dateTime, locale } = useI18n()
  const status = profile.account.status
  const { complete, total, missing } = profile.completeness
  const pct = total === 0 ? 100 : Math.round((complete / total) * 100)
  return (
    <section className="pp-sec" aria-labelledby="sp-account">
      <div className="pp-sec__head">
        <h2 id="sp-account" className="pp-sec__title">{tx(T.accountFacts)}</h2>
        {action}
      </div>
      <dl className="tf-kv sp-account">
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
        {!profile.reportingManager && (
          <>
            <dt>{tx(T.reportsTo)}</dt>
            <dd><span className="sp-muted">{tx(T.noManager)}</span></dd>
          </>
        )}
        <dt>{tx(T.lastActivity)}</dt>
        <dd>{profile.lastActivityAt ? dateTime(profile.lastActivityAt) : tx(T.never)}</dd>
        {profile.signInIdentity && (
          <>
            <dt>{tx(T.signIn)}</dt>
            <dd dir="ltr" className="sp-ltr">{profile.signInIdentity}</dd>
          </>
        )}
      </dl>
      <div className="sp-completeness" role="status">
        <span>
          {tx(T.completeness)}: {tx(T.completeCount, { done: complete, total })}
          {missing.length > 0 && (
            <span className="sp-muted"> — {missing.map((m) => tx(MISSING_LABEL[m])).join(locale === 'ar' ? '، ' : ', ')}</span>
          )}
        </span>
        <span className="pp-meter" aria-hidden="true">
          <span style={{ inlineSize: `${pct}%` }} />
        </span>
      </div>
      <p className="pp-rule">{tx(T.officialFieldsNote)}</p>
      <p className="pp-rule">{tx(T.contactNote)}</p>
    </section>
  )
}
