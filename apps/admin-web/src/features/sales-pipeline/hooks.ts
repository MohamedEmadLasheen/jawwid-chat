import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { trialKeys } from '@/features/trials/api'
import { profileKeys } from '@/features/profiles/api'
import { pipelineApi, pipelineKeys, type CreateLeadInput, type LeadQuery, type UpdateLeadInput } from './api'

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
  })
}

/** Every change can move a lead between stages, so the list refreshes; the detail answers with the new lead. */
function useRefresh() {
  const qc = useQueryClient()
  return (id?: string) => {
    void qc.invalidateQueries({ queryKey: ['sales-pipeline', 'leads'] })
    if (id) void qc.invalidateQueries({ queryKey: pipelineKeys.detail(id) })
    void qc.invalidateQueries({ queryKey: trialKeys.prospects })
  }
}

export function useCreateLead() {
  const refresh = useRefresh()
  return useMutation({ mutationFn: (b: CreateLeadInput) => pipelineApi.create(b), onSuccess: (lead) => refresh(lead.id) })
}

export function useUpdateLead(id: string) {
  const refresh = useRefresh()
  return useMutation({ mutationFn: (b: UpdateLeadInput) => pipelineApi.update(id, b), onSuccess: () => refresh(id) })
}

export function useMarkContacted(id: string) {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (b: { nextFollowUpOn?: string | null; followUpNote?: string | null }) => pipelineApi.contacted(id, b),
    onSuccess: () => refresh(id),
  })
}

export function useConvertLead(id: string) {
  const refresh = useRefresh()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => pipelineApi.convert(id),
    onSuccess: (r) => {
      refresh(id)
      if (r.outcome === 'linked') void qc.invalidateQueries({ queryKey: profileKeys.all })
    },
  })
}
