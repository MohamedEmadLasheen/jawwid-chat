import { useRef, useState } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { QueryBoundary } from '@/shared/components/States'
import { Badge } from '@/shared/components/Badge'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import type { ReviewCertificate } from '@/core/api/endpoints'
import {
  openCertificate,
  useApproveProfile,
  useDecideCertificate,
  usePendingReviews,
  useRequestChanges,
  useReviewRevision,
} from './hooks'

/**
 * Teacher professional profile review.
 *
 * ## What this console does not decide
 *
 * WHETHER AN APPROVAL IS LEGAL. The Approve button is disabled while a
 * certificate is still pending, and that is a COURTESY -- it explains in words
 * why the action is unavailable instead of letting an operator click something
 * that fails. The rule is enforced by the service and, independently, by a
 * database trigger. If the two ever disagree, the server wins and the error is
 * shown as it arrived.
 *
 * WHAT STATE A REVISION IS IN after an action. Every mutation invalidates the
 * list and the detail, including on failure: two reviewers can hold the same
 * revision, and the most common failure here is "somebody else already acted".
 * Nothing is optimistic, because an optimistic approval paints the outcome the
 * reviewer expected over the race they lost.
 *
 * ## What is never rendered
 *
 * The revision id, any reviewer id, any object key, any storage path. The
 * revision id exists in this file only as a path parameter and a query key --
 * the same way a story id does -- and the server never sends the other three.
 */
export function TeacherProfilesPage() {
  const { t, date } = useI18n()
  const [reviewing, setReviewing] = useState<string | null>(null)

  const query = usePendingReviews()

  return (
    <div className="page">
      <h1 className="page__title">{t('nav.teacher-profiles')}</h1>

      <QueryBoundary
        isLoading={query.isLoading}
        error={query.error}
        isEmpty={query.revisions.length === 0}
        emptyTitle={t('tprofile.empty')}
        onRetry={() => void query.refetch()}
      >
        <ul className="card" aria-label={t('tprofile.pending.title')}>
          {query.revisions.map((revision) => (
            <li key={revision.revisionId} className="row">
              <div>
                {/* The teacher's name as the SERVER resolved it, from
                    chat.teacher. The console stores no identity of its own. */}
                <strong>{revision.teacherName}</strong>
                <Badge tone="waiting">{t(`tprofile.state.${revision.state}` as const)}</Badge>

                <p>
                  {revision.submittedAt && (
                    <>
                      {t('tprofile.submitted')}: {date(revision.submittedAt)} ·{' '}
                    </>
                  )}
                  {t('tprofile.certificates')}: {revision.certificates.length}
                </p>

                <p>
                  {revision.pendingCertificates > 0 ? (
                    <Badge tone="now">
                      {revision.pendingCertificates} · {t('tprofile.cert.state.pending')}
                    </Badge>
                  ) : (
                    <Badge tone="ok">{t('tprofile.ready')}</Badge>
                  )}
                </p>
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={() => setReviewing(revision.revisionId)}>
                  {t('tprofile.review')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </QueryBoundary>

      {reviewing && (
        <ReviewPanel revisionId={reviewing} onClose={() => setReviewing(null)} />
      )}
    </div>
  )
}

function ReviewPanel({
  revisionId,
  onClose,
}: {
  revisionId: string
  onClose: () => void
}) {
  const { t } = useI18n()
  const query = useReviewRevision(revisionId)
  const [askingChanges, setAskingChanges] = useState(false)

  const approve = useApproveProfile(revisionId)
  const requestChanges = useRequestChanges(revisionId)

  const revision = query.data
  const blocked = (revision?.pendingCertificates ?? 0) > 0
  const isPending = revision?.state === 'pending_review'
  const busy = approve.isPending || requestChanges.isPending

  /**
   * `disabled={busy}` is not enough on its own.
   *
   * react-query flips `isPending` on a later render, so two clicks landing in
   * the same tick both see an enabled button and both fire. A ref is written
   * synchronously inside the handler, which is the only thing that closes that
   * window. The server is idempotent-keyed and would refuse the second approval
   * anyway -- this stops the operator seeing two requests and one confusing
   * error for an action they performed once.
   */
  const inFlight = useRef(false)
  const once = (run: () => void) => () => {
    if (inFlight.current) return
    inFlight.current = true
    run()
  }

  return (
    <Dialog title={t('tprofile.section.profile')} onClose={onClose}>
      <QueryBoundary
        isLoading={query.isLoading}
        error={query.error}
        onRetry={() => void query.refetch()}
      >
        {revision && (
          <div>
            <h3>{revision.teacherName}</h3>
            <p>{t('tprofile.role.teacher')}</p>

            <Field label={t('tprofile.field.bio')} value={revision.bio} />
            <Field
              label={t('tprofile.field.specialization')}
              value={revision.specialization}
            />
            <Field
              label={t('tprofile.field.qualifications')}
              value={revision.qualifications}
            />
            <Field label={t('tprofile.field.experience')} value={revision.experience} />
            <Field
              label={t('tprofile.field.languages')}
              value={revision.languages.join(', ')}
            />

            <h4>{t('tprofile.certificates')}</h4>
            <ul aria-label={t('tprofile.certificates')}>
              {revision.certificates.map((certificate) => (
                <CertificateRow
                  key={certificate.id}
                  certificate={certificate}
                  revisionId={revisionId}
                />
              ))}
            </ul>

            {/* The reason is stated rather than implied by a dead button. */}
            {blocked && <p role="status">{t('tprofile.approve.blocked')}</p>}
            {!isPending && <p role="status">{t('tprofile.approve.notPending')}</p>}

            {approve.error != null && (
              <p role="alert">{(approve.error as Error).message}</p>
            )}
            {requestChanges.error != null && (
              <p role="alert">{(requestChanges.error as Error).message}</p>
            )}
            {approve.isSuccess && <p role="status">{t('tprofile.approved')}</p>}
            {requestChanges.isSuccess && (
              <p role="status">{t('tprofile.changesRequested')}</p>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={once(() =>
                  approve.mutate(revisionId, {
                    onSettled: () => {
                      inFlight.current = false
                    },
                  }),
                )}
                disabled={blocked || !isPending || busy}
              >
                {t('tprofile.approve')}
              </button>
              <button
                type="button"
                onClick={() => setAskingChanges(true)}
                disabled={!isPending || busy}
              >
                {t('tprofile.requestChanges')}
              </button>
            </div>

            {askingChanges && (
              <NoteDialog
                title={t('tprofile.requestChanges.title')}
                label={t('tprofile.requestChanges.note')}
                requiredMessage={t('tprofile.requestChanges.noteRequired')}
                pending={requestChanges.isPending}
                onCancel={() => setAskingChanges(false)}
                onSubmit={(note) => {
                  if (inFlight.current) return
                  inFlight.current = true
                  requestChanges.mutate(
                    { id: revisionId, note },
                    {
                      onSuccess: () => setAskingChanges(false),
                      onSettled: () => {
                        inFlight.current = false
                      },
                    },
                  )
                }}
              />
            )}
          </div>
        )}
      </QueryBoundary>
    </Dialog>
  )
}

function Field({ label, value }: { label: string; value: string | null }) {
  const { t } = useI18n()
  return (
    <p>
      <strong>{label}: </strong>
      {value && value.length > 0 ? value : <em>{t('tprofile.field.empty')}</em>}
    </p>
  )
}

function CertificateRow({
  certificate,
  revisionId,
}: {
  certificate: ReviewCertificate
  revisionId: string
}) {
  const { t, date } = useI18n()
  const decide = useDecideCertificate(revisionId)
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
          requiredMessage={t('tprofile.requestChanges.noteRequired')}
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
