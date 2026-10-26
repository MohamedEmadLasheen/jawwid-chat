import { useI18n } from '@/core/i18n/I18nProvider'
import { ApiError } from '@/core/api/errors'
import { F, describeFeedbackError, useCopy } from '@/features/teacher-supervision/copy'
import { FeedbackItem } from '@/features/teacher-supervision/FeedbackParts'
import { useFamilyFeedback } from '@/features/teacher-supervision/hooks'

/**
 * PD-32 on the Parent File (PD-17): what this family sent from the app about
 * their children's teachers, read only. The server decides who reads it -- the
 * Teachers department, the super admin, and the children's supervisor (their
 * own children only); anyone else is refused (403, or 404 for staff outside
 * the family), and the section is then simply not there. Taking and replying are the Supervision page's.
 */
export function FamilyFeedbackSection({ familyId }: { familyId: string }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const list = useFamilyFeedback(familyId)
  // Refused (403) or out of the viewer's scope (404, the same answer as no such family): not shown.
  if (list.error instanceof ApiError && (list.error.isForbidden || list.error.isNotFound)) return null
  if (list.isLoading) return null
  const rows = list.data?.feedback ?? []
  return (
    <section className="card panel tf-section" aria-labelledby="pf-feedback">
      <div className="tf-section__head">
        <h2 id="pf-feedback" className="tf-section__title">
          {tx(F.familyTitle)}
        </h2>
      </div>
      <p className="field__hint">{tx(F.familyHint)}</p>
      {list.error ? (
        <p className="tf-muted">{describeFeedbackError(list.error, locale)}</p>
      ) : rows.length === 0 ? (
        <p className="tf-muted">{tx(F.familyEmpty)}</p>
      ) : (
        <ul className="tf-entries">
          {rows.map((f) => (
            <FeedbackItem key={f.id} feedback={f} />
          ))}
        </ul>
      )}
    </section>
  )
}
