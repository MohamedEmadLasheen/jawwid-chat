import { createContext, useContext, useEffect, useMemo } from 'react'
import type { ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { sessionApi, type Me } from '@/core/api/endpoints'
import { qk } from '@/core/api/queryKeys'
import { hasAccessToken, setAccessToken, setUnauthenticatedHandler } from '@/core/api/client'
import type { Staff } from '@/shared/types/domain'

interface SessionValue {
  /**
   * The signed-in operator, in the shape the rest of the app already speaks.
   *
   * Derived from `/me`, which is the SERVER's answer to "who is this". The app
   * never infers a role, a department or a permission from anything it stored
   * itself -- the previous session's cached copy is cleared on every 401.
   */
  staff: Staff | null
  /** Effective permission keys, overrides already applied. UX only. */
  permissions: string[]
  isLoading: boolean
  isAuthenticated: boolean
  signIn: (subject: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

/** `/me` describes an actor; the app's pages are written against Staff. */
function toStaff(me: Me | undefined): Staff | null {
  if (!me || me.kind !== 'staff' || !me.staffRole) return null
  return {
    id: me.actorId,
    name: me.displayName,
    role: me.staffRole,
    department: me.department,
    presence: 'online',
    is_active: true,
  }
}

const SessionContext = createContext<SessionValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()

  const meQuery = useQuery({
    queryKey: qk.me,
    queryFn: () => sessionApi.me(),
    // Without a token there is nothing to ask, and asking would produce a 401
    // that clears a cache that is already empty.
    enabled: hasAccessToken(),
    retry: false,
    staleTime: 60_000,
  })

  // `/me/duty` is gone. Shift state was never a client concern: the operator
  // who is currently responsible for a conversation arrives per conversation as
  // `handlerId`, and whether THIS operator may reply is answered by the send
  // endpoint's own refusal — not by a duty flag the client interprets.

  useEffect(() => {
    // A 401 from anywhere ends the session once: the token is dropped and every
    // cached page is cleared, so a signed-out operator cannot read another
    // role's data out of the cache.
    setUnauthenticatedHandler(() => {
      setAccessToken(null)
      queryClient.clear()
    })
  }, [queryClient])

  const value = useMemo<SessionValue>(
    () => ({
      staff: toStaff(meQuery.data),
      permissions: meQuery.data?.permissions ?? [],
      isLoading: hasAccessToken() && meQuery.isLoading,
      isAuthenticated: Boolean(meQuery.data),
      signIn: async (subject: string, password: string) => {
        const result = await sessionApi.login(subject, password)
        setAccessToken(result.accessToken)
        queryClient.setQueryData(qk.me, result.actor)
        await queryClient.invalidateQueries()
      },
      signOut: async () => {
        // Ask the server to revoke the session first; drop the token either
        // way, so a failed request never strands somebody signed in.
        await sessionApi.logout().catch(() => undefined)
        setAccessToken(null)
        queryClient.clear()
      },
    }),
    [meQuery.data, meQuery.isLoading, queryClient],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>')
  return ctx
}
