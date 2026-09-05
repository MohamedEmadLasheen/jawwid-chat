import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { caseApi, familyApi } from '@/core/api/endpoints'
import { newIdempotencyKey } from '@/core/api/client'
import { qk } from '@/core/api/queryKeys'
import type { Case, Message } from '@/shared/types/domain'

export function useFamily(familyId: string) {
  return useQuery({
    queryKey: qk.family(familyId),
    queryFn: () => familyApi.detail(familyId),
    enabled: Boolean(familyId),
  })
}

export function useFamilyMessages(familyId: string) {
  const query = useInfiniteQuery({
    queryKey: qk.familyMessages(familyId),
    queryFn: ({ pageParam }) => familyApi.messages(familyId, pageParam as string | undefined),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled: Boolean(familyId),
  })

  const messages: Message[] = query.data?.pages.flatMap((page) => page.items) ?? []
  return { ...query, messages }
}

export function useFamilyCases(familyId: string) {
  return useQuery({
    queryKey: qk.familyCases(familyId),
    queryFn: () => familyApi.cases(familyId),
    enabled: Boolean(familyId),
  })
}

/**
 * Sending is idempotent: the key is minted once per composed message, so a
 * double click or a retried request cannot post the same reply twice.
 * `on_behalf_mode` is not passed — the server derives it from on_duty().
 */
export function useSendMessage(familyId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      body: string
      visibility: 'customer' | 'internal'
      case_id?: string | null
      idempotencyKey: string
    }) =>
      familyApi.sendMessage(
        familyId,
        { body: input.body, visibility: input.visibility, case_id: input.case_id ?? null },
        input.idempotencyKey,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.familyMessages(familyId) })
      void queryClient.invalidateQueries({ queryKey: qk.family(familyId) })
      void queryClient.invalidateQueries({ queryKey: qk.inboxAll })
    },
  })
}

export function useUpdateCase(familyId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof caseApi.update>[1] }) =>
      caseApi.update(id, patch),
    // Whether the update succeeded or lost a race, the answer is the same:
    // refetch server truth rather than keep a local guess (role brief §50).
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.familyCases(familyId) })
      void queryClient.invalidateQueries({ queryKey: qk.family(familyId) })
      void queryClient.invalidateQueries({ queryKey: qk.inboxAll })
    },
  })
}

export function useEscalateCase(familyId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ caseId, reason }: { caseId: string; reason: string }) =>
      caseApi.escalate(caseId, reason),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.familyCases(familyId) })
      void queryClient.invalidateQueries({ queryKey: qk.dashboardAll })
    },
  })
}

/** One action: pick a date, the follow-up exists and lands in the inbox. */
export function useCreateFollowUp(familyId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ caseId, dueAt, reason }: { caseId: string; dueAt: string; reason: string }) =>
      caseApi.followUp(caseId, dueAt, reason),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.familyCases(familyId) })
      void queryClient.invalidateQueries({ queryKey: qk.inboxAll })
    },
  })
}

export function useAddNote(familyId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ body, pinned }: { body: string; pinned: boolean }) =>
      familyApi.addNote(familyId, body, pinned),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.family(familyId) })
      void queryClient.invalidateQueries({ queryKey: qk.familyMessages(familyId) })
    },
  })
}

export function useCreateCase(familyId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      type: Case['type']
      severity?: Case['severity']
      is_blocking?: boolean
      due_at?: string | null
    }) => familyApi.createCase(familyId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.familyCases(familyId) })
      void queryClient.invalidateQueries({ queryKey: qk.family(familyId) })
    },
  })
}

/** "I'll keep this" and "For owner" — thread handling, never ownership. */
export function useHandlingActions(familyId: string) {
  const queryClient = useQueryClient()
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: qk.family(familyId) })
    void queryClient.invalidateQueries({ queryKey: qk.inboxAll })
  }

  return {
    pinHandler: useMutation({
      mutationFn: () => familyApi.pinHandler(familyId),
      onSettled: invalidate,
    }),
    deferToOwner: useMutation({
      mutationFn: () => familyApi.deferToOwner(familyId),
      onSettled: invalidate,
    }),
  }
}

export function useTransferImpact(familyId: string, toStaffId: string | null) {
  return useQuery({
    queryKey: qk.transferImpact(familyId, toStaffId ?? ''),
    queryFn: () => familyApi.transferImpact(familyId, toStaffId!),
    enabled: Boolean(familyId && toStaffId),
  })
}

/**
 * The only path that changes family.owner_id. `reason` is required by the
 * server and written to audit_log in the same transaction (brief §3, §12).
 */
export function useTransferOwnership(familyId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ toStaffId, reason }: { toStaffId: string; reason: string }) =>
      familyApi.transferOwnership(familyId, toStaffId, reason),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.family(familyId) })
      void queryClient.invalidateQueries({ queryKey: qk.inboxAll })
      void queryClient.invalidateQueries({ queryKey: qk.dashboardAll })
    },
  })
}

export { newIdempotencyKey }
