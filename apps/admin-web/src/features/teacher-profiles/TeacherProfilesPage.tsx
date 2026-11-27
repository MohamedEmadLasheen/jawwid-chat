import { useId, useState } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { QueryBoundary } from '@/shared/components/States'
import { Badge } from '@/shared/components/Badge'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import type { CertificateReviewItem, ReviewCertificate } from '@/core/api/endpoints'
import { openCertificate, useDecideCertificate, usePendingReviews } from './hooks'
import './teacher-profiles.css'
import '@/features/teachers/rows.css'
import { Icon } from '@/shared/components/Icon'
import { PageHeader } from '@/shared/components/PageHeader'
import { RowActions } from '@/shared/components/RowActions'

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
  const { t, number } = useI18n()
  const query = usePendingReviews()

  return (
    <div className="page">
      <div className="page__inner">
        <PageHeader
          title={t('nav.teacher-profiles')}
          figures={
            query.profiles.length > 0
              ? [
                  { key: 'pending', label: t('tprofile.pending.title'), value: number(query.profiles.reduce((n, p) => n + p.pendingCertificates, 0)), tone: 'key' },
                ]
              : undefined
          }
        />

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

/** One teacher's certificates: a sheet headed by the teacher, each certificate a row decided in place. */
function TeacherRow({ profile }: { profile: CertificateReviewItem }) {
  const { t } = useI18n()

  return (
    <li className="sheet tp-teacher">
      <div className="sheet__head">
        {/* The teacher's name as the SERVER resolved it, from chat.teacher.
            The console stores no identity of its own. */}
        <strong className="sheet__title" dir="auto">
          {profile.teacherName}
        </strong>
        {profile.pendingCertificates > 0 ? (
          <Badge tone="warn">
            {profile.pendingCertificates} · {t('tprofile.cert.state.pending')}
          </Badge>
        ) : (
          <Badge tone="ok" dot>
            {t('tprofile.ready')}
          </Badge>
        )}
      </div>
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
    <li className="rowx tp-cert">
      <div className="rw-who">
        <span className="tp-cert__icon" aria-hidden="true">
          <Icon name="certificates" size={18} />
        </span>
        <span className="rw-who__text">
          <strong className="rw-name" dir="auto">{certificate.title}</strong>
          <span className="rw-sub">
            {certificate.issuingOrganization}
            {certificate.issuedOn && <> · {date(certificate.issuedOn)}</>}
          </span>
        </span>
      </div>
      <div className="rw-meta">{certificate.reviewNote && <span dir="auto">{certificate.reviewNote}</span>}</div>
      <div className="rw-tags">
        <Badge tone={tone} dot>{t(`tprofile.cert.state.${certificate.state}` as const)}</Badge>
      </div>

      <div className="cell-actions">
        {/* The decision this page exists for is stated; the file and the refusal are behind the menu. */}
        <RowActions
          primary={
            <button type="button" className="btn btn--sm btn--primary" onClick={() => decide.mutate({ certificateId: certificate.id, approved: true })} disabled={decide.isPending}>
              {t('tprofile.cert.approve')}
            </button>
          }
          more={[
            // A fresh signed URL per click. Nothing about where the file lives is
            // held here between clicks, and no URL is constructed.
            { key: 'open', label: t('tprofile.cert.open'), icon: 'file', onSelect: () => void openCertificate(certificate.id) },
            ...(decide.isPending ? [] : [{ key: 'reject', label: t('tprofile.cert.reject'), icon: 'xCircle' as const, danger: true, onSelect: () => setRejecting(true) }]),
          ]}
          label={`${t('tprofile.certificates')}: ${certificate.title}`}
        />
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
