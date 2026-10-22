import { createContext, useContext, useEffect, useMemo } from 'react'
import type { ReactNode } from 'react'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { sessionApi, type DutyState } from '@/core/api/endpoints'
import { qk } from '@/core/api/queryKeys'
import { setUnauthenticatedHandler } from '@/core/api/client'
import { onSignedOutElsewhere, tokenStore } from './tokens'
import type { Staff } from '@/shared/types/domain'

interface SessionValue {
  staff: Staff | null
  duty: DutyState | null
  isLoading: boolean
  isAuthenticated: boolean
  signOut: () => Promise<void>
  /**
   * PD-23: end the session on THIS side only, sending nothing -- for when the
   * server has already ended it (signing out "this browser" from My devices).
   * Calling /auth/logout or refreshing with a revoked token would only earn a
   * 401, or worse, look like a replayed refresh token.
   */
  signOutLocally: () => void
}

const SessionContext = createContext<SessionValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()

  const meQuery = useQuery({
    queryKey: qk.me,
    queryFn: () => sessionApi.me(),
    retry: false,
    staleTime: 60_000,
  })

  const dutyQuery = useQuery({
    queryKey: qk.duty,
    queryFn: () => sessionApi.duty(),
    // super_admin has no shift and no duty: it is not a family-facing role.
    enabled: Boolean(meQuery.data) && meQuery.data?.role !== 'super_admin',
    // Duty state changes on shift boundaries; a minute of staleness is enough
    // because coverage.changed events invalidate it as well.
    refetchInterval: 60_000,
  })

  useEffect(() => {
    // A 401 from anywhere clears every cached page so a signed-out operator
    // cannot read another role's data out of the cache.
    setUnauthenticatedHandler(() => endSession(queryClient))
  }, [queryClient])

  // PD-23: in "Keep me signed in" mode every tab shares one token; when another
  // tab signs out (or its refresh fails for good) it removes that token, and
  // this tab follows at once instead of at its next request.
  useEffect(() => onSignedOutElsewhere(() => endSession(queryClient)), [queryClient])

  const value = useMemo<SessionValue>(
    () => ({
      staff: meQuery.data ?? null,
      duty: dutyQuery.data ?? null,
      isLoading: meQuery.isLoading,
      isAuthenticated: Boolean(meQuery.data),
      signOut: async () => {
        await sessionApi.logout().catch(() => undefined)
        endSession(queryClient)
      },
      signOutLocally: () => {
        tokenStore.clear()
        endSession(queryClient)
      },
    }),
    [meQuery.data, meQuery.isLoading, dutyQuery.data, queryClient],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

/**
 * Forget every cached page AND tell the mounted session query that nobody is
 * signed in.
 *
 * `queryClient.clear()` alone did the first and not the second: it drops the
 * cache without notifying the observer that is already rendering, so after
 * Sign out the shell stayed on screen -- server session revoked, tokens gone,
 * last page still visible. Setting `me` to null is what re-renders the login.
 */
function endSession(queryClient: QueryClient): void {
  const me = JSON.stringify(qk.me)
  queryClient.removeQueries({ predicate: (query) => JSON.stringify(query.queryKey) !== me })
  queryClient.setQueryData(qk.me, null)
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>')
  return ctx
}
