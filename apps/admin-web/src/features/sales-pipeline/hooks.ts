import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { trialKeys } from '@/features/trials/api'
import { profileKeys } from '@/features/profiles/api'
import { pipelineApi, pipelineKeys, type CreateLeadInput, type LeadDetail, type LeadQuery, type UpdateLeadInput } from './api'

export function useLeads(query: LeadQuery) {
  return useQuery({
    queryKey: pipelineKeys.list(query),
    queryFn: () => pipelineApi.list(query),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  })
}

/** The detail read returns the contact and is audited on the server: it runs only while a lead is open, and is never cached long. */
export function useLead(id: string | null) {
  return useQuery({
    queryKey: pipelineKeys.detail(id ?? ''),
    queryFn: () => pipelineApi.get(id!),
    enabled: !!id,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    // Each read of the contact is an audited event: only opening the lead reads it, never a focus, a
    // reconnect or a timer.
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
    refetchInterval: false,
  })
}

/**
 * Every change can move a lead between stages, so the list refreshes. A write answers with the new
 * lead, which is put straight into the detail query: refetching it would be a second audited read.
 */
function useRefresh() {
  const qc = useQueryClient()
  return (lead?: LeadDetail) => {
    void qc.invalidateQueries({ queryKey: ['sales-pipeline', 'leads'] })
    if (lead) qc.setQueryData(pipelineKeys.detail(lead.id), lead)
    void qc.invalidateQueries({ queryKey: trialKeys.prospects })
  }
}

/** A mutation's result can carry the contact: it is not kept in the cache once the caller has it. */
const NO_CACHE = { gcTime: 0 } as const

export function useCreateLead() {
  const refresh = useRefresh()
  return useMutation({ ...NO_CACHE, mutationFn: (b: CreateLeadInput) => pipelineApi.create(b), onSuccess: (lead) => refresh(lead) })
}

export function useUpdateLead(id: string) {
  const refresh = useRefresh()
  return useMutation({ ...NO_CACHE, mutationFn: (b: UpdateLeadInput) => pipelineApi.update(id, b), onSuccess: (lead) => refresh(lead) })
}

export function useMarkContacted(id: string) {
  const refresh = useRefresh()
  return useMutation({
    ...NO_CACHE,
    mutationFn: (b: { nextFollowUpOn?: string | null; followUpNote?: string | null }) => pipelineApi.contacted(id, b),
    onSuccess: (lead) => refresh(lead),
  })
}

export function useConvertLead(id: string) {
  const refresh = useRefresh()
  const qc = useQueryClient()
  return useMutation({
    ...NO_CACHE,
    mutationFn: () => pipelineApi.convert(id),
    onSuccess: (r) => {
      refresh()
      // Only a link changes the lead (its contact is gone): then, and only then, it is read again.
      if (r.outcome === 'linked') void qc.invalidateQueries({ queryKey: pipelineKeys.detail(id) })
      if (r.outcome === 'linked') void qc.invalidateQueries({ queryKey: profileKeys.all })
    },
  })
}
