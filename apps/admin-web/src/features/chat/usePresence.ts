import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRealtime } from '@/core/realtime/RealtimeProvider'
import { chatApi, chatKeys, type ChatMember, type PresenceEntry } from './chatApi'

/**
 * PD-37: online / last seen of the staff and teachers among `members`, as the
 * server lets this viewer see them. Families are never asked about (nobody sees
 * a family's presence), and anyone the server leaves out is simply absent --
 * not "offline". `presence.changed` re-reads, as every chat event does.
 */
export function usePresence(members: readonly ChatMember[], selfId: string | undefined): Map<string, PresenceEntry> {
  const { socket } = useRealtime()
  const queryClient = useQueryClient()
  const staff = members.filter((m) => m.actorKind === 'staff' && m.actorId !== selfId).map((m) => m.actorId)
  const teachers = members.filter((m) => m.actorKind === 'teacher').map((m) => m.actorId)
  const key = [...staff].sort().join(',') + '|' + [...teachers].sort().join(',')
  const asked = staff.length + teachers.length > 0

  const presence = useQuery({
    queryKey: chatKeys.presence(key),
    queryFn: () => chatApi.presence({ staff: staff.slice(0, 100), teachers: teachers.slice(0, 100 - Math.min(staff.length, 100)) }),
    enabled: asked,
    staleTime: 30_000,
  })

  useEffect(() => {
    if (!socket || !asked) return
    const watched = new Set([...staff, ...teachers])
    const onChange = (p: { actorId?: unknown } | undefined) => {
      if (typeof p?.actorId === 'string' && watched.has(p.actorId)) {
        void queryClient.invalidateQueries({ queryKey: chatKeys.presence(key) })
      }
    }
    socket.on('presence.changed', onChange)
    return () => {
      socket.off('presence.changed', onChange)
    }
    // `key` is the membership; the arrays are rebuilt from it each render.
  }, [socket, queryClient, key, asked])

  return new Map((presence.data ?? []).map((p) => [p.actorId, p]))
}
