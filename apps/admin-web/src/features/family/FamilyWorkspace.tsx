import { useState } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { ErrorState, LoadingState } from '@/shared/components/States'
import { useFamily, useFamilyCases, useFamilyMessages, useUpdateCase } from './hooks'
import { Thread } from './Thread'
import { Composer } from './Composer'
import { FamilyPanel } from './FamilyPanel'
import { CaseCards } from './CaseCards'
import { FamilyActions } from './FamilyActions'

/**
 * The conversation workspace: cases on top, one continuous thread in the
 * middle, composer at the bottom, Family 360 always visible beside it.
 */
export function FamilyWorkspace({ familyId }: { familyId: string }) {
  const { t } = useI18n()
  const [activeCaseId, setActiveCaseId] = useState<string | null>(null)

  const familyQuery = useFamily(familyId)
  const messagesQuery = useFamilyMessages(familyId)
  const casesQuery = useFamilyCases(familyId)
  const updateCase = useUpdateCase(familyId)

  if (familyQuery.isLoading) {
    return (
      <div className="column column--center">
        <LoadingState />
      </div>
    )
  }

  if (familyQuery.error || !familyQuery.data) {
    return (
      <div className="column column--center">
        <ErrorState error={familyQuery.error} onRetry={() => void familyQuery.refetch()} />
      </div>
    )
  }

  const detail = familyQuery.data
  const cases = casesQuery.data ?? []
  const activeCase = cases.find((item) => item.id === activeCaseId) ?? null

  // Filtering by case is a view over the single thread — it never opens a
  // second thread (brief §12).
  const visibleMessages = activeCaseId
    ? messagesQuery.messages.filter((message) => message.case_id === activeCaseId)
    : messagesQuery.messages

  return (
    <>
      <div className="column column--center">
        <FamilyActions detail={detail} activeCase={activeCase} />

        <CaseCards
          cases={cases}
          activeCaseId={activeCaseId}
          capabilities={detail.capabilities}
          onSelect={setActiveCaseId}
          onResolve={(caseId) => updateCase.mutate({ id: caseId, patch: { status: 'resolved' } })}
        />

        {updateCase.error && (
          <div className="banner banner--danger" role="alert">
            {t('common.staleReload')}
          </div>
        )}

        <Thread
          messages={visibleMessages}
          isLoading={messagesQuery.isFetchingNextPage}
          hasMore={Boolean(messagesQuery.hasNextPage)}
          onLoadMore={() => void messagesQuery.fetchNextPage()}
        />

        <Composer
          familyId={familyId}
          capabilities={detail.capabilities}
          activeCaseId={activeCaseId}
        />
      </div>

      <FamilyPanel detail={detail} />
    </>
  )
}
