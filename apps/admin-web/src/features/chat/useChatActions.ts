import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { chatApi, chatKeys, labelApi, type ChatConversation, type ChatLabel, type ChatViewerState } from './chatApi'
import { muteForeverUntil } from './chatView'

type Prefs = { archived?: boolean; pinned?: boolean; mutedUntil?: string | null; favorite?: boolean }

/**
 * Archive / pin / mute / favorite: the viewer's own preferences. Applied to the cached
 * list at once (they only ever affect this viewer), then confirmed by
 * re-reading the server's copy; a refusal rolls the list back.
 */
export function useConversationPreferences() {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: ({ id, prefs }: { id: string; prefs: Prefs }) => chatApi.setPreferences(id, prefs),
    onMutate: async ({ id, prefs }) => {
      await queryClient.cancelQueries({ queryKey: chatKeys.list })
      const before = queryClient.getQueryData<ChatConversation[]>(chatKeys.list)
      queryClient.setQueryData<ChatConversation[]>(chatKeys.list, (all) =>
        all?.map((c) => (c.id === id ? { ...c, viewerState: merge(c.viewerState, prefs) } : c)),
      )
      return { before }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.before) queryClient.setQueryData(chatKeys.list, ctx.before)
    },
    onSettled: (_d, _e, { id }) => {
      void queryClient.invalidateQueries({ queryKey: chatKeys.list })
      void queryClient.invalidateQueries({ queryKey: chatKeys.conversation(id) })
    },
  })
  return {
    pin: (id: string, pinned: boolean) => mutation.mutate({ id, prefs: { pinned } }),
    archive: (id: string, archived: boolean) => mutation.mutate({ id, prefs: { archived } }),
    favorite: (id: string, favorite: boolean) => mutation.mutate({ id, prefs: { favorite } }),
    mute: (id: string, muted: boolean) =>
      mutation.mutate({ id, prefs: { mutedUntil: muted ? muteForeverUntil() : null } }),
    error: mutation.error,
  }
}

function merge(state: ChatViewerState | undefined, prefs: Prefs): ChatViewerState {
  const base = state ?? { pinned: false, archived: false, mutedUntil: null, favorite: false }
  return {
    pinned: prefs.pinned ?? base.pinned,
    favorite: prefs.favorite ?? base.favorite ?? false,
    archived: prefs.archived ?? base.archived,
    mutedUntil: prefs.mutedUntil === undefined ? base.mutedUntil : prefs.mutedUntil,
  }
}

/**
 * The organization's chat labels (staff only). A refusal -- a server without
 * labels, or a viewer who may not use them -- reads as "no labels", so the
 * list never breaks over them.
 */
export function useChatLabels() {
  return useQuery({
    queryKey: chatKeys.labels,
    queryFn: () => labelApi.list().catch(() => [] as ChatLabel[]),
    staleTime: 60_000,
  })
}

/**
 * Apply or remove a label on a chat: shown on the cached list at once, then
 * confirmed by re-reading; a refusal rolls the list back.
 */
export function useLabelToggle() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ conversationId, labelId, on }: { conversationId: string; labelId: string; on: boolean }) =>
      on ? labelApi.apply(conversationId, labelId) : labelApi.unapply(conversationId, labelId),
    onMutate: async ({ conversationId, labelId, on }) => {
      await queryClient.cancelQueries({ queryKey: chatKeys.list })
      const before = queryClient.getQueryData<ChatConversation[]>(chatKeys.list)
      const patch = (c: ChatConversation) => {
        const ids = (c.labelIds ?? []).filter((x) => x !== labelId)
        return { ...c, labelIds: on ? [...ids, labelId] : ids }
      }
      queryClient.setQueryData<ChatConversation[]>(chatKeys.list, (all) =>
        all?.map((c) => (c.id === conversationId ? patch(c) : c)),
      )
      queryClient.setQueryData<ChatConversation>(chatKeys.conversation(conversationId), (c) => (c ? patch(c) : c))
      return { before }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.before) queryClient.setQueryData(chatKeys.list, ctx.before)
    },
    onSettled: (_d, _e, { conversationId }) => {
      void queryClient.invalidateQueries({ queryKey: chatKeys.list })
      void queryClient.invalidateQueries({ queryKey: chatKeys.conversation(conversationId) })
    },
  })
}
