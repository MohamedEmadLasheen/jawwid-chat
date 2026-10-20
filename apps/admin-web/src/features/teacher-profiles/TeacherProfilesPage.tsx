import { useState } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { QueryBoundary } from '@/shared/components/States'
import { Badge } from '@/shared/components/Badge'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import type { CertificateReviewItem, ReviewCertificate } from '@/core/api/endpoints'
import { openCertificate, useDecideCertificate, usePendingReviews } from './hooks'

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
      <h1 className="page__title">{t('nav.teacher-profiles')}</h1>

      <QueryBoundary
        isLoading={query.isLoading}
        error={query.error}
        isEmpty={query.profiles.length === 0}
        emptyTitle={t('tprofile.empty')}
        onRetry={() => void query.refetch()}
      >
        <ul className="card" aria-label={t('tprofile.pending.title')}>
          {query.profiles.map((profile) => (
            <TeacherRow key={profile.profileId} profile={profile} />
          ))}
        </ul>
      </QueryBoundary>
    </div>
  )
}

function TeacherRow({ profile }: { profile: CertificateReviewItem }) {
  const { t } = useI18n()

  return (
    <li className="row">
      <div>
        {/* The teacher's name as the SERVER resolved it, from chat.teacher.
            The console stores no identity of its own. */}
        <strong>{profile.teacherName}</strong>
        {profile.pendingCertificates > 0 ? (
          <Badge tone="now">
            {profile.pendingCertificates} · {t('tprofile.cert.state.pending')}
          </Badge>
        ) : (
          <Badge tone="ok">{t('tprofile.ready')}</Badge>
        )}

        <h4>{t('tprofile.certificates')}</h4>
        <ul aria-label={t('tprofile.certificates')}>
          {profile.certificates.map((certificate) => (
            <CertificateRow key={certificate.id} certificate={certificate} />
          ))}
        </ul>
      </div>
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
        : 'now'

  return (
    <li>
      <strong>{certificate.title}</strong>
      <Badge tone={tone}>{t(`tprofile.cert.state.${certificate.state}` as const)}</Badge>

      <p>
        {certificate.issuingOrganization}
        {certificate.issuedOn && <> · {date(certificate.issuedOn)}</>}
      </p>
      {certificate.reviewNote && <p>{certificate.reviewNote}</p>}

      {decide.error != null && <p role="alert">{(decide.error as Error).message}</p>}

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          // A fresh signed URL per click. Nothing about where the file lives is
          // held here between clicks, and no URL is constructed.
          onClick={() => void openCertificate(certificate.id)}
        >
          {t('tprofile.cert.open')}
        </button>
        <button
          type="button"
          onClick={() =>
            decide.mutate({ certificateId: certificate.id, approved: true })
          }
          disabled={decide.isPending}
        >
          {t('tprofile.cert.approve')}
        </button>
        <button
          type="button"
          onClick={() => setRejecting(true)}
          disabled={decide.isPending}
        >
          {t('tprofile.cert.reject')}
        </button>
      </div>

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
      <label>
        {label}
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          aria-label={label}
        />
      </label>
      {touched && invalid && <p role="alert">{requiredMessage}</p>}
    </Dialog>
  )
}
