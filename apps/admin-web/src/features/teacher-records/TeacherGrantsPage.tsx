import { useSearchParams } from 'react-router-dom'
import { FilterChips } from '@/shared/components/FilterChips'
import { PageHeader } from '@/shared/components/PageHeader'
import { EmptyState, LoadingState } from '@/shared/components/States'
import { RewardsSection } from '@/features/teacher-supervision/RewardsAndComplaints'
import '@/features/teacher-supervision/teacher-supervision.css'
import { R, useCopy } from './copy'
import { useTeacherRecordsAccess } from './hooks'
import { TestimonialsSection } from './Testimonials'
import { TeacherPicker, TeacherStrip } from './TeacherStrip'
import './teacher-records.css'

export type GrantsSection = 'grants' | 'testimonials'
export const GRANTS_SECTIONS: readonly GrantsSection[] = ['grants', 'testimonials']

/**
 * PD-52 page B, Grants & Testimonials (docs/product/pd052-teacher-records-pages-plan.md
 * §5.3): PD-11's grants (an amount only for the finance tier, §11 a) and the
 * testimonials -- the parents' praise, read in place, and staff's. `&teacher=`
 * narrows to one teacher and shows their strip (§5.5). What the page offers is
 * GET /teacher-records/access's answer; the server decides each request.
 */
export function TeacherGrantsPage({ basePath, eyebrow }: { basePath: string; eyebrow?: string }) {
  const tx = useCopy()
  const access = useTeacherRecordsAccess()
  const [params, setParams] = useSearchParams()
  const asked = params.get('section') as GrantsSection | null
  const section: GrantsSection = asked && GRANTS_SECTIONS.includes(asked) ? asked : 'grants'
  const teacher = params.get('teacher') ?? ''
  const set = (patch: Record<string, string>) =>
    setParams(
      (current) => {
        const p = new URLSearchParams(current)
        for (const [k, v] of Object.entries(patch)) {
          if (v) p.set(k, v)
          else p.delete(k)
        }
        return p
      },
      { replace: true },
    )

  const a = access.data
  if (access.isLoading) return <LoadingState />
  if (!a || !a.grants.view) {
    return (
      <div className="page">
        <div className="page__inner">
          <PageHeader eyebrow={eyebrow} title={tx(R.grantsTitle)} />
          <EmptyState icon="lock" title={tx(R.denied)} />
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page__inner">
        <PageHeader eyebrow={eyebrow ?? tx(R.group)} title={tx(R.grantsTitle)} subtitle={tx(R.grantsSubtitle)} />
        <FilterChips<GrantsSection>
          variant="tabs"
          label={tx(R.sections)}
          value={section}
          onChange={(next) => set({ section: next })}
          options={[
            { value: 'grants', label: tx(R.grants) },
            { value: 'testimonials', label: tx(R.testimonials) },
          ]}
        />
        <div className="tr-toolbar">
          <TeacherPicker value={teacher} onChange={(id) => set({ teacher: id })} />
        </div>
        <TeacherStrip teacherId={teacher || null} basePath={basePath} />
        <div className="th-body">
          {/* PD-52 PR-5: Sales names the student or trial of every grant and testimonial. */}
          {section === 'grants' && <RewardsSection basePath={basePath} canRecord={a.grants.record} requireAbout={a.basis === 'sales'} />}
          {section === 'testimonials' && (
            <TestimonialsSection canRecord={a.grants.record} teacher={teacher || undefined} requireAbout={a.basis === 'sales'} />
          )}
        </div>
      </div>
    </div>
  )
}
