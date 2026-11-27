import { useId, useState } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { QueryBoundary } from '@/shared/components/States'
import { Badge } from '@/shared/components/Badge'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import type { CertificateReviewItem, ReviewCertificate } from '@/core/api/endpoints'
import { openCertificate, useDecideCertificate, usePendingReviews } from './hooks'
import './teacher-profiles.css'

/**
 * Teacher CREDENTIAL review.
 *
 * ## What this console no longer does
 *
 * APPROVE A PROFILE. There is no profile-level review any more: a teacher owns
 * their professional profile and publishes it by saving it. The Approve and
 * Request-changes controls are gone along with the endpoints behind them, and so
 * is the revision detail panel -- there is no revision.
 *
 * What remains is the part that was never about revisions: a document a teacher
 * uploads claiming a qualification is not verified by having been uploaded. Each
 * credential is decided on its own, and a teacher may never decide their own --
 * enforced by the service and, independently, by a database trigger.
 *
 * ## What is never rendered
 *
 * Any profile id, any reviewer id, any object key, any storage path. The profile
 * id exists in this file only as a React key -- the same way a story id does --
 * and the server never sends the other three.
 */
export function TeacherProfilesPage() {
  const { t } = useI18n()
  const query = usePendingReviews()

  return (
    <div className="page">
      <div className="page__inner">
      <header className="page-header">
        <div className="page-header__text">
          <h1 className="page-header__title">{t('nav.teacher-profiles')}</h1>
        </div>
      </header>

      <QueryBoundary
        isLoading={query.isLoading}
        error={query.error}
        isEmpty={query.profiles.length === 0}
        emptyTitle={t('tprofile.empty')}
        onRetry={() => void query.refetch()}
      >
        <ul className="tp-list" aria-label={t('tprofile.pending.title')}>
          {query.profiles.map((profile) => (
            <TeacherRow key={profile.profileId} profile={profile} />
          ))}
        </ul>
      </QueryBoundary>
      </div>
    </div>
  )
}

function TeacherRow({ profile }: { profile: CertificateReviewItem }) {
  const { t } = useI18n()

  return (
    <li className="tp-teacher">
      <div className="tp-teacher__head">
        {/* The teacher's name as the SERVER resolved it, from chat.teacher.
            The console stores no identity of its own. */}
        <strong className="tp-teacher__name" dir="auto">{profile.teacherName}</strong>
        {profile.pendingCertificates > 0 ? (
          <Badge tone="warn" dot>
            {profile.pendingCertificates} · {t('tprofile.cert.state.pending')}
          </Badge>
        ) : (
          <Badge tone="ok" dot>{t('tprofile.ready')}</Badge>
        )}
      </div>

      <h2 className="section-label tp-teacher__label">{t('tprofile.certificates')}</h2>
      <ul className="tp-certs" aria-label={t('tprofile.certificates')}>
        {profile.certificates.map((certificate) => (
          <CertificateRow key={certificate.id} certificate={certificate} />
        ))}
      </ul>
    </li>
  )
}

function CertificateRow({ certificate }: { certificate: ReviewCertificate }) {
  const { t, date } = useI18n()
  const decide = useDecideCertificate()
  const [rejecting, setRejecting] = useState(false)

  const tone =
    certificate.state === 'approved'
      ? 'ok'
      : certificate.state === 'rejected'
        ? 'danger'
        : 'warn'

  return (
    <li className="tp-cert">
      <div className="tp-cert__main">
        <div className="tp-cert__head">
          <strong className="tp-cert__title" dir="auto">{certificate.title}</strong>
          <Badge tone={tone} dot>{t(`tprofile.cert.state.${certificate.state}` as const)}</Badge>
        </div>
        <p className="tp-cert__meta">
          {certificate.issuingOrganization}
          {certificate.issuedOn && <> · {date(certificate.issuedOn)}</>}
        </p>
        {certificate.reviewNote && <p className="tp-cert__note" dir="auto">{certificate.reviewNote}</p>}
      </div>

      <div className="tp-cert__actions">
        <button
          type="button"
          className="btn btn--sm btn--ghost"
          // A fresh signed URL per click. Nothing about where the file lives is
          // held here between clicks, and no URL is constructed.
          onClick={() => void openCertificate(certificate.id)}
        >
          {t('tprofile.cert.open')}
        </button>
        <button
          type="button"
          className="btn btn--sm btn--primary"
          onClick={() =>
            decide.mutate({ certificateId: certificate.id, approved: true })
          }
          disabled={decide.isPending}
        >
          {t('tprofile.cert.approve')}
        </button>
        <button
          type="button"
          className="btn btn--sm"
          onClick={() => setRejecting(true)}
          disabled={decide.isPending}
        >
          {t('tprofile.cert.reject')}
        </button>
      </div>

      {decide.error != null && <p className="tp-cert__error" role="alert">{(decide.error as Error).message}</p>}

      {rejecting && (
        <NoteDialog
          title={t('tprofile.cert.rejectTitle')}
          label={t('tprofile.cert.rejectNote')}
          requiredMessage={t('tprofile.cert.rejectNoteRequired')}
          pending={decide.isPending}
          onCancel={() => setRejecting(false)}
          onSubmit={(note) =>
            decide.mutate(
              { certificateId: certificate.id, approved: false, note },
              { onSuccess: () => setRejecting(false) },
            )
          }
        />
      )}
    </li>
  )
}

/**
 * Collect a note before a decision that needs one.
 *
 * The note is required HERE as well as on the server, so a reviewer is told
 * before the round trip rather than after it. The server's rule is still the
 * one that counts.
 */
function NoteDialog({
  title,
  label,
  requiredMessage,
  pending,
  onCancel,
  onSubmit,
}: {
  title: string
  label: string
  requiredMessage: string
  pending: boolean
  onCancel: () => void
  onSubmit: (note: string) => void
}) {
  const { t } = useI18n()
  const [note, setNote] = useState('')
  const [touched, setTouched] = useState(false)
  const noteId = useId()
  const invalid = note.trim().length === 0

  return (
    <Dialog
      title={title}
      onClose={onCancel}
      footer={
        <>
          <DialogCancelButton onClick={onCancel} />
          <button
            type="button"
            className="btn btn--primary"
            disabled={pending}
            onClick={() => {
              setTouched(true)
              if (invalid) return
              onSubmit(note.trim())
            }}
          >
            {t('tprofile.submit')}
          </button>
        </>
      }
    >
      <div className="field">
        <label className="field__label" htmlFor={noteId}>
          {label}
        </label>
        <textarea
          id={noteId}
          className="input"
          rows={3}
          dir="auto"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          aria-invalid={touched && invalid}
        />
        {touched && invalid && (
          <p className="field__error" role="alert">
            {requiredMessage}
          </p>
        )}
      </div>
    </Dialog>
  )
}
