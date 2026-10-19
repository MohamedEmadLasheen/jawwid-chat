import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSession } from '@/core/auth/SessionProvider'
import { qk } from '@/core/api/queryKeys'
import { useDebounced } from '@/shared/hooks/useDebounced'
import { studioApi, type AudienceClause, type CreateStoryInput, type CtaKind } from './api'

export function useStudioStories() {
  const query = useQuery({ queryKey: qk.studioStories, queryFn: studioApi.list })
  return { ...query, stories: query.data ?? [] }
}

export function useStudioStory(id: string | undefined) {
  return useQuery({
    queryKey: qk.studioStory(id ?? 'none'),
    queryFn: () => studioApi.get(id!),
    enabled: Boolean(id),
  })
}

/** The time zone a day is counted in: the operator's own. */
export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export function useStoryAnalytics(id: string | undefined) {
  const tz = localTimeZone()
  return useQuery({
    queryKey: qk.storyAnalytics(id ?? 'none', tz),
    queryFn: () => studioApi.analytics(id!, tz),
    enabled: Boolean(id),
  })
}

/**
 * The viewer list -- who opened it, and who tapped. Fetched only when the
 * publisher opens the People panel: it is the most privacy-sensitive read in
 * the feature, so it is never prefetched alongside the numbers.
 */
export function useStoryViewers(id: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: qk.storyViewers(id ?? 'none'),
    queryFn: () => studioApi.viewers(id!),
    enabled: Boolean(id) && enabled,
  })
}

export function useAudienceFacts() {
  return useQuery({ queryKey: qk.storyAudienceFacts, queryFn: studioApi.facts, staleTime: 60_000 })
}

/**
 * A live "will reach N people" while the audience is being chosen. Debounced,
 * and keyed on the audience itself, so toggling a chip back returns the cached
 * number instantly.
 */
export function useAudienceEstimate(audiences: AudienceClause[] | null, ctaKind: CtaKind | null) {
  const key = useDebounced(JSON.stringify({ audiences, ctaKind }), 250)
  const parsed = JSON.parse(key) as { audiences: AudienceClause[] | null; ctaKind: CtaKind | null }
  return useQuery({
    queryKey: qk.storyEstimate(key),
    queryFn: () => studioApi.estimate(parsed.audiences ?? [], parsed.ctaKind),
    enabled: parsed.audiences !== null && parsed.audiences.length > 0,
    placeholderData: (previous) => previous,
  })
}

export function useFamilyAudienceData(params: { search: string; missing: boolean }) {
  const search = useDebounced(params.search.trim(), 250)
  return useQuery({
    queryKey: qk.storyFamilies({ search, missing: params.missing }),
    queryFn: () => studioApi.families({ search, missing: params.missing }),
  })
}

export function useSetFamilyAudienceData() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: { countryCode?: string | null; subscriptionPlanMonths?: number | null } }) =>
      studioApi.setFamily(id, input),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: qk.storyFamiliesAll })
      void client.invalidateQueries({ queryKey: qk.storyAudienceFacts })
      void client.invalidateQueries({ queryKey: qk.storyEstimateAll })
    },
  })
}

/** Create, and -- when asked -- publish in the same gesture. */
export function useCreateStory() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({ input, publish }: { input: CreateStoryInput; publish: boolean }) => {
      const draft = await studioApi.create(input)
      return publish ? studioApi.publish(draft.id) : draft
    },
    onSettled: () => void client.invalidateQueries({ queryKey: qk.studioAll }),
  })
}

export function usePublishStory() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => studioApi.publish(id),
    onSettled: () => void client.invalidateQueries({ queryKey: qk.studioAll }),
  })
}

export function useDeleteStory() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => studioApi.remove(id, reason),
    onSettled: () => void client.invalidateQueries({ queryKey: qk.studioAll }),
  })
}

/**
 * May this role read and edit family audience data? The super admin and
 * managers -- mirroring `canManageStoryAudienceData`. UX only: the server
 * decides every request on its own.
 */
export function useCanManageAudienceData(): boolean {
  const { staff } = useSession()
  return staff?.role === 'super_admin' || staff?.role === 'manager'
}
