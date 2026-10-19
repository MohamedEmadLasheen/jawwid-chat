import { useMutation, useQueryClient } from '@tanstack/react-query'
import { chatApi, chatKeys, type ChatConversation, type ChatViewerState } from './chatApi'
import { muteForeverUntil } from './chatView'

type Prefs = { archived?: boolean; pinned?: boolean; mutedUntil?: string | null }

/**
 * Archive / pin / mute: the viewer's own preferences. Applied to the cached
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
    mute: (id: string, muted: boolean) =>
      mutation.mutate({ id, prefs: { mutedUntil: muted ? muteForeverUntil() : null } }),
    error: mutation.error,
  }
}

function merge(state: ChatViewerState | undefined, prefs: Prefs): ChatViewerState {
  const base = state ?? { pinned: false, archived: false, mutedUntil: null }
  return {
    pinned: prefs.pinned ?? base.pinned,
    archived: prefs.archived ?? base.archived,
    mutedUntil: prefs.mutedUntil === undefined ? base.mutedUntil : prefs.mutedUntil,
  }
}
