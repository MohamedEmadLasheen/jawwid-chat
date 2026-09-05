import { createContext, useContext, useEffect, useMemo } from 'react'
import type { ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { sessionApi, type DutyState } from '@/core/api/endpoints'
import { qk } from '@/core/api/queryKeys'
import { setUnauthenticatedHandler } from '@/core/api/client'
import type { Staff } from '@/shared/types/domain'

interface SessionValue {
  staff: Staff | null
  duty: DutyState | null
  isLoading: boolean
  isAuthenticated: boolean
  signOut: () => Promise<void>
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
    enabled: Boolean(meQuery.data),
    // Duty state changes on shift boundaries; a minute of staleness is enough
    // because coverage.changed events invalidate it as well.
    refetchInterval: 60_000,
  })

  useEffect(() => {
    // A 401 from anywhere clears every cached page so a signed-out operator
    // cannot read another role's data out of the cache.
    setUnauthenticatedHandler(() => queryClient.clear())
  }, [queryClient])

  const value = useMemo<SessionValue>(
    () => ({
      staff: meQuery.data ?? null,
      duty: dutyQuery.data ?? null,
      isLoading: meQuery.isLoading,
      isAuthenticated: Boolean(meQuery.data),
      signOut: async () => {
        await sessionApi.logout().catch(() => undefined)
        queryClient.clear()
      },
    }),
    [meQuery.data, meQuery.isLoading, dutyQuery.data, queryClient],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>')
  return ctx
}
