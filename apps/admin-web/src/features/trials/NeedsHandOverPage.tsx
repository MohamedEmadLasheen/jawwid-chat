import { useI18n } from '@/core/i18n/I18nProvider'
import { PageHeader } from '@/shared/components/PageHeader'
import { EmptyState } from '@/shared/components/States'
import { NeedsHandOver } from '../sales-pipeline/NeedsHandOver'
import { H } from '../sales-pipeline/copy'
import { useHandOverAccess } from '../sales-pipeline/hooks'
import { TrialsAreaTabs } from './area'
import '../teachers/teachers.css'
import '../trials/trials.css'
import '../sales-pipeline/sales-pipeline.css'

/**
 * PD-59 (option O4): Operations' read-only "Needs hand-over" list, in the Trials area beside New students,
 * where Operations works (Operations has no Sales area). It is offered only when the server's access
 * answer says this person may read it, and shows the MINIMISED projection: no Sales owner, no pipeline
 * counts, no contact value. Nothing here writes: the missing channel is added in the family's own profile.
 */
export function NeedsHandOverPage() {
  const { locale } = useI18n()
  const tx = (p: { en: string; ar: string }) => (locale === 'ar' ? p.ar : p.en)
  const access = useHandOverAccess()
  const mode = access.data?.handOver ?? null
  return (
    <div className="page">
      <div className="page__inner">
        <PageHeader title={tx(H.title)} />
        <TrialsAreaTabs />
        {access.isLoading ? null : mode === null ? (
          <EmptyState title={tx(H.forbidden)} />
        ) : (
          <NeedsHandOver minimal={mode === 'operations'} />
        )}
      </div>
    </div>
  )
}
