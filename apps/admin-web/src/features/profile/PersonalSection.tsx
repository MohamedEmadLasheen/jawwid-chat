import { useEffect, useId, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Fact, Sheet } from '@/features/profiles/RecordParts'
import { ABOUT_MAX, DISPLAY_NAME_MAX, JOB_TITLE_MAX, profileKeys, staffProfileApi, type StaffProfile } from './api'
import { ACCOUNT_STATUS_LABEL, MISSING_LABEL, T, useCopy } from './copy'
import { describeError, isConflict } from './errors'
import { useAvatarRemove, useAvatarUpload, useUpdateProfile } from './hooks'
import { preparePhoto, type PreparedPhoto } from './photo'

/**
 * The photo. Choosing one is choose -> preview -> use, or cancel; the current
 * photo stays until the new one is saved. The actions live in the file's "more"
 * menu; the preview takes the monogram's place in the masthead and its two
 * answers sit in a bar under it. Offered only when the server's `canEditPhoto`
 * says so, and the server refuses the write anyway when it is not.
 */
export function usePhotoDraft(profile: StaffProfile, refKey: string) {
  const tx = useCopy()
  const inputId = useId()
  const fileRef = useRef<HTMLInputElement>(null)
  const upload = useAvatarUpload(refKey)
  const remove = useAvatarRemove(refKey)
  const [prepared, setPrepared] = useState<PreparedPhoto | null>(null)
  const [problem, setProblem] = useState<unknown>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(
    () => () => {
      if (prepared) URL.revokeObjectURL?.(prepared.previewUrl)
    },
    [prepared],
  )

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

  return {
    inputId,
    fileRef,
    prepared,
    notice,
    /** The file input's name, and the menu item that opens it. */
    label: tx(profile.avatarUrl ? T.photoReplace : T.photoChoose),
    busy: upload.isPending || remove.isPending,
    uploading: upload.isPending,
    error: problem ?? upload.error ?? remove.error,
    choose,
    pick: () => fileRef.current?.click(),
    cancel: () => setPrepared(null),
    use: () => {
      if (!prepared) return
      upload.mutate(prepared.blob, {
        onSuccess: () => {
          setPrepared(null)
          setNotice(tx(T.photoSaved))
        },
      })
    },
    remove: () => {
      setProblem(null)
      setNotice(null)
      remove.mutate(undefined, { onSuccess: () => setNotice(tx(T.photoRemoved)) })
    },
  }
}

/**
 * The file input the menu opens and, while a photo waits or after one was
 * saved or refused, the bar under the masthead that says so.
 */
export function PhotoBar({ photo }: { photo: ReturnType<typeof usePhotoDraft> }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const hintId = `${photo.inputId}-hint`
  return (
    <>
      <input
        ref={photo.fileRef}
        id={photo.inputId}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sp-file-input"
        aria-label={photo.label}
        aria-describedby={photo.prepared ? hintId : undefined}
        tabIndex={-1}
        disabled={photo.busy}
        onChange={(e) => void photo.choose(e.target.files?.[0])}
      />
      {(photo.prepared || photo.error || photo.notice) && (
        <div className="rec-photo" role="group" aria-label={tx(T.photo)}>
          {photo.prepared && (
            <>
              <span id={hintId} className="rec-photo__hint">
                {tx(T.photoHint)}
              </span>
              <span className="rec-photo__buttons">
                <button type="button" className="btn btn--sm" disabled={photo.busy} onClick={photo.use}>
                  {photo.uploading ? tx(T.photoUploading) : tx(T.photoUse)}
                </button>
                <button type="button" className="btn btn--sm btn--ghost" disabled={photo.busy} onClick={photo.cancel}>
                  {tx(T.cancel)}
                </button>
              </span>
            </>
          )}
          {photo.error ? (
            <span className="field__error" role="alert">
              {describeError(photo.error, locale)}
            </span>
          ) : photo.notice ? (
            <span className="sp-ok" role="status">
              {photo.notice}
            </span>
          ) : null}
        </div>
      )}
    </>
  )
}

/**
 * The introduction, in their own words, and the form that edits it: a sheet of
 * the Overview. Saving sends ONLY the fields in the form plus the version it
 * was loaded at, so two editors (the person and their manager) cannot silently
 * overwrite each other. "Edit" is in the masthead; this sheet shows the form it opens.
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
    <Sheet
      id="sp-personal"
      section="personal"
      title={tx(T.personal)}
      rule={someoneElse && access.canEditProfessional ? tx(T.editingFor, { name: profile.displayName }) : undefined}
    >
      {editing ? (
        <ProfessionalForm profile={profile} refKey={refKey} onDone={onDone} />
      ) : profile.about ? (
        <p className="sp-about" dir="auto">{profile.about}</p>
      ) : (
        <p className="rec-empty">{tx(T.aboutEmpty)}</p>
      )}
      {profile.profileUpdatedAt && profile.profileUpdatedBy && (
        <p className="sp-sheet__foot">
          {tx(T.lastUpdated, { when: dateTime(profile.profileUpdatedAt), who: profile.profileUpdatedBy.displayName })}
        </p>
      )}
    </Sheet>
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
 * Account facts, on the canvas beside the work: read-only for everyone,
 * because they are official fields. Profile completeness closes the group as
 * one line over a thin rule, then the two rules that protect people.
 */
export function AccountGroup({ profile, completenessShown = false }: { profile: StaffProfile; completenessShown?: boolean }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const status = profile.account.status
  const { complete, total, missing } = profile.completeness
  const pct = total === 0 ? 100 : Math.round((complete / total) * 100)
  // The role, the status word and the last activity are in the record's head; the margin keeps the rest.
  const statusNeedsSaying = !profile.account.hasLogin || (status !== null && status !== 'active')
  const rules = (
    <details className="sp-defs">
      <summary>{tx(T.aboutFields)}</summary>
      <ul>
        <li>{tx(T.officialFieldsNote)}</li>
        <li>{tx(T.contactNote)}</li>
      </ul>
    </details>
  )
  // Nothing of their own to say here (a manager reading an active colleague): only the rules, quietly.
  if (!profile.signInIdentity && !statusNeedsSaying && status && profile.reportingManager && !completenessShown) {
    return <div className="aside-group rec-group" data-section="account">{rules}</div>
  }
  return (
    <section className="aside-group rec-group" aria-labelledby="sp-account" data-section="account">
      <div className="rec-group__head">
        <h2 id="sp-account" className="aside-group__title">{tx(T.accountFacts)}</h2>
      </div>
      <dl className="rec-facts">
        {profile.signInIdentity && (
          <Fact icon="mail" label={tx(T.signIn)}>
            <span dir="ltr" className="sp-ltr">{profile.signInIdentity}</span>
          </Fact>
        )}
        {(statusNeedsSaying || !status) && (
          <Fact icon="userCheck" label={tx(T.status)}>
            {!profile.account.hasLogin ? (
              tx(T.noLogin)
            ) : status ? (
              tx(ACCOUNT_STATUS_LABEL[status] ?? { en: status, ar: status })
            ) : (
              <span className="rec-missing">{tx(T.never)}</span>
            )}
          </Fact>
        )}
        {!profile.reportingManager && (
          <Fact icon="user" label={tx(T.reportsTo)}>
            <span className="rec-missing">{tx(T.noManager)}</span>
          </Fact>
        )}
      </dl>
      {/* A nudge for the person themselves; a manager reads the profile, not its upkeep. */}
      {completenessShown && (
        <div className="sp-completeness">
          <span>
            {tx(T.completeness)}: {tx(T.completeCount, { done: complete, total })}
            {missing.length > 0 && (
              <span className="sp-muted">{locale === 'ar' ? '، ينقصه: ' : '; missing: '}{missing.map((m) => tx(MISSING_LABEL[m])).join(locale === 'ar' ? '، ' : ', ')}</span>
            )}
          </span>
          <span className="pp-meter" aria-hidden="true">
            <span style={{ inlineSize: `${pct}%` }} />
          </span>
        </div>
      )}
      {rules}
    </section>
  )
}
