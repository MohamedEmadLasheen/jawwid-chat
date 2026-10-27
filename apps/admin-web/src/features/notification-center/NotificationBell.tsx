import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRealtime } from '@/core/realtime/RealtimeProvider'
import { Icon } from '@/shared/components/Icon'
import { inboxApi, inboxKeys } from './api'
import { N, useCopy } from './copy'

/**
 * PD-34: the bell in the top bar, with the unread count. The server's
 * `notification.inbox_changed` hint (to this staff member's own room only)
 * refetches it; the count itself always comes from the REST route.
 */
export function NotificationBell() {
  const tx = useCopy()
  const queryClient = useQueryClient()
  const { socket } = useRealtime()
  const counts = useQuery({ queryKey: inboxKeys.counts, queryFn: inboxApi.counts, staleTime: 30_000 })
  const unread = counts.data?.unread ?? 0

  useEffect(() => {
    if (!socket) return
    const onChanged = () => void queryClient.invalidateQueries({ queryKey: inboxKeys.all })
    socket.on('notification.inbox_changed', onChanged)
    return () => {
      socket.off('notification.inbox_changed', onChanged)
    }
  }, [socket, queryClient])

  return (
    <Link
      to="/notifications"
      className="btn btn--ghost btn--icon nc-bell"
      aria-label={tx(N.bell, { n: unread })}
      title={tx(N.title)}
    >
      <Icon name="notifications" />
      {unread > 0 && (
        <span className="nc-bell__count" aria-hidden="true">
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </Link>
  )
}
