import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { QueryBoundary } from '@/shared/components/States'
import type { InboxSection } from '@/core/api/endpoints'
import { useInboxSection } from './hooks'
import { InboxRowItem } from './InboxRowItem'
import { OrderFeedbackDialog } from './OrderFeedbackDialog'
import { AwaySummary } from './AwaySummary'
import { FamilyWorkspace } from '@/features/family/FamilyWorkspace'

/**
 * Sections, in the order the brief lists them (§8). "Covering" is separate on
 * purpose: an operator must be able to tell at a glance whether she is holding
 * a family because she owns it or because she is covering it.
 */
const SECTIONS: InboxSection[] = ['now', 'today', 'covering', 'waiting_family', 'quiet']

function SectionList({
  section,
  selectedFamilyId,
  onSelect,
}: {
  section: InboxSection
  selectedFamilyId: string | null
  onSelect: (familyId: string) => void
}) {
  const { t } = useI18n()
  const [feedbackFor, setFeedbackFor] = useState<{ familyId: string; position: number } | null>(null)
  const query = useInboxSection(section)

  return (
    <>
      <div className="column__scroll">
        <QueryBoundary
          isLoading={query.isLoading}
          error={query.error}
          isEmpty={query.rows.length === 0}
          emptyTitle={t(`inbox.empty.${section}` as const)}
          onRetry={() => void query.refetch()}
        >
          {query.rows.map((row) => (
            <InboxRowItem
              key={row.family_id}
              row={row}
              selected={row.family_id === selectedFamilyId}
              onSelect={onSelect}
            />
          ))}

          {query.hasNextPage && (
            <button
              type="button"
              className="btn"
              style={{ margin: 12 }}
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {t('common.loadMore')}
            </button>
          )}

          {/*
            Calibration hook (brief §6). Anchored to the top row, because the
            question being answered is "should this have been first?".
          */}
          {query.rows.length > 0 && query.rows[0] && (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              style={{ margin: 12 }}
              onClick={() => setFeedbackFor({ familyId: query.rows[0]!.family_id, position: 0 })}
            >
              {t('inbox.orderWrong')}
            </button>
          )}
        </QueryBoundary>
      </div>

      {feedbackFor && (
        <OrderFeedbackDialog
          section={section}
          familyId={feedbackFor.familyId}
          position={feedbackFor.position}
          onClose={() => setFeedbackFor(null)}
        />
      )}
    </>
  )
}

export function InboxPage() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const { familyId } = useParams<{ familyId: string }>()
  const [section, setSection] = useState<InboxSection>('now')
  const [showAway, setShowAway] = useState(false)

  const selectFamily = (id: string) => navigate(`/inbox/${id}`)

  return (
    <>
      <div className="column column--list">
        <div className="column__header" style={{ gap: 4, flexWrap: 'wrap' }}>
          {SECTIONS.map((candidate) => (
            <button
              key={candidate}
              type="button"
              className="composer__tab"
              aria-pressed={section === candidate}
              onClick={() => setSection(candidate)}
            >
              {t(`bucket.${candidate}` as const)}
            </button>
          ))}
          <button
            type="button"
            className="composer__tab"
            aria-pressed={showAway}
            onClick={() => setShowAway((value) => !value)}
          >
            {t('inbox.away')}
          </button>
        </div>

        {showAway ? (
          <div className="column__scroll">
            <AwaySummary onOpenFamily={selectFamily} />
          </div>
        ) : (
          <SectionList
            section={section}
            selectedFamilyId={familyId ?? null}
            onSelect={selectFamily}
          />
        )}
      </div>

      {familyId ? (
        <FamilyWorkspace familyId={familyId} />
      ) : (
        <div className="column column--center">
          <div className="state">
            <div className="state__title">{t('inbox.empty.now')}</div>
          </div>
        </div>
      )}
    </>
  )
}
