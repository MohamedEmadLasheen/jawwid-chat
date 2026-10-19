import { useCallback, useMemo } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useSession } from '@/core/auth/SessionProvider'
import { chatApi, chatKeys, type ChatConversation } from '@/features/chat/chatApi'
import { chatCopyFor } from '@/features/chat/copy'
import { useCall } from '@/features/calls/CallProvider'
import { callsPageApi, callsPageKeys, type CreateScheduledCall } from './api'
import { callsPageCopyFor, type CallsPageCopy } from './copy'
import { conversationLabel, isGroupConversation } from './model'

export function useCallsCopy(): CallsPageCopy {
  const { locale } = useI18n()
  return callsPageCopyFor(locale)
}

/** The staff member's conversations: the same list (and cache) as the chat workspace. */
export function useConversations() {
  const query = useQuery({ queryKey: chatKeys.list, queryFn: chatApi.list, staleTime: 30_000 })
  const byId = useMemo(() => new Map((query.data ?? []).map((c) => [c.id, c])), [query.data])
  return { ...query, byId }
}

/** A conversation's display name and kind, the way every Calls surface shows it. */
export function useConversationNaming() {
  const { locale } = useI18n()
  const { staff } = useSession()
  const chat = chatCopyFor(locale)
  return useCallback(
    (c: ChatConversation | undefined, fallback = '') => (c ? conversationLabel(c, staff?.id, chat) : fallback),
    [chat, staff?.id],
  )
}

export function useUpcoming() {
  return useQuery({
    queryKey: callsPageKeys.upcoming,
    queryFn: callsPageApi.upcoming,
    // A call opens and closes on the clock: re-read so the badge follows.
    refetchInterval: 60_000,
  })
}

export function useScheduledCall(id: string) {
  return useQuery({ queryKey: callsPageKeys.scheduled(id), queryFn: () => callsPageApi.get(id), retry: false })
}

export function useAccountHistory() {
  return useInfiniteQuery({
    queryKey: callsPageKeys.history,
    queryFn: ({ pageParam }) => callsPageApi.history(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  })
}

export function useCreateScheduled() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateScheduledCall) => callsPageApi.create(input),
    onSuccess: (_saved, input) => {
      void queryClient.invalidateQueries({ queryKey: callsPageKeys.upcoming })
      // The card was posted in the chat: its thread and the list re-read.
      void queryClient.invalidateQueries({ queryKey: chatKeys.messages(input.conversationId) })
      void queryClient.invalidateQueries({ queryKey: chatKeys.list })
    },
  })
}

export function useCancelScheduled() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => callsPageApi.cancel(id),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: callsPageKeys.upcoming })
      void queryClient.invalidateQueries({ queryKey: chatKeys.messages(saved.conversationId) })
    },
  })
}

/**
 * The call actions every Calls surface shares: a plain voice call through the
 * existing `CallController.start`, and a Join through its additive
 * `joinScheduled`. The call window (CallOverlay) shows what happens next.
 */
export function useCallActions() {
  const { state, controller } = useCall()
  const name = useConversationNaming()
  const { byId } = useConversations()
  const busy = state.phase !== 'idle' && state.phase !== 'ended' && !(state.phase === 'failed' && !state.callId)

  const startCall = useCallback(
    (c: ChatConversation) =>
      controller?.start({ conversationId: c.id, peerLabel: name(c), isGroup: isGroupConversation(c) }),
    [controller, name],
  )

  const join = useCallback(
    (scheduled: { id: string; conversationId: string; title?: string | null }) => {
      const c = byId.get(scheduled.conversationId)
      return controller?.joinScheduled({
        scheduledCallId: scheduled.id,
        conversationId: scheduled.conversationId,
        peerLabel: name(c, scheduled.title ?? ''),
        isGroup: isGroupConversation(c),
      })
    },
    [byId, controller, name],
  )

  // The previous call's record is cleared before a new one, as "Call again" does.
  const prepare = useCallback(() => {
    if (state.phase === 'ended' || (state.phase === 'failed' && !state.callId)) controller?.dismiss()
  }, [controller, state.phase, state.callId])

  return {
    available: !!controller,
    busy,
    startCall: (c: ChatConversation) => {
      prepare()
      return startCall(c)
    },
    join: (s: { id: string; conversationId: string; title?: string | null }) => {
      prepare()
      return join(s)
    },
  }
}
