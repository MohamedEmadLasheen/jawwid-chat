import { createContext, useContext, useEffect, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { sessionApi } from '@/core/api/endpoints'
import { qk } from '@/core/api/queryKeys'
import { setUnauthenticatedHandler, setTermsRequiredHandler } from '@/core/api/client'
import { parseLegal } from '@/features/legal/legal'
import { onSignedOutElsewhere, tokenStore } from './tokens'
import type { Staff } from '@/shared/types/domain'
import { accountLocale, rememberAccountLocale, useI18nIfAny } from '@/core/i18n/I18nProvider'

interface SessionValue {
  staff: Staff | null
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

  useEffect(() => {
    // A 401 from anywhere clears every cached page so a signed-out operator
    // cannot read another role's data out of the cache.
    setUnauthenticatedHandler(() => endSession(queryClient))
  }, [queryClient])

  // PD-58: a 403 COMM.TERMS_NOT_ACCEPTED from any request shows the gate at once
  // (from the error's own list when it has one), then refetches /me for the truth.
  useEffect(() => {
    setTermsRequiredHandler((required) => {
      const parsed = parseLegal({ state: 'required', required, unavailable: [] })
      if (parsed && parsed.state === 'required' && parsed.required.length > 0) {
        queryClient.setQueryData<Staff | null>(qk.me, (me) => (me ? { ...me, legal: parsed } : me))
      }
      void queryClient.invalidateQueries({ queryKey: qk.me, exact: true })
    })
  }, [queryClient])

  // PD-23: in "Keep me signed in" mode every tab shares one token; when another
  // tab signs out (or its refresh fails for good) it removes that token, and
  // this tab follows at once instead of at its next request.
  useEffect(() => onSignedOutElsewhere(() => endSession(queryClient)), [queryClient])

  // ADMIN-008: the interface speaks the signed-in account's language -- its own
  // pick on this browser, else its /me.locale -- and a pick made while signed in
  // is that account's, never the next person's on this browser.
  const i18n = useI18nIfAny()
  const locale = i18n?.locale ?? null
  const setLocale = i18n?.setLocale
  const meId = meQuery.data?.id ?? null
  const meLocale = meQuery.data?.locale
  const applied = useRef<{ id: string | null; locale: string | null }>({ id: null, locale: null })
  useEffect(() => {
    if (meId === applied.current.id) return
    applied.current = { id: meId, locale: null }
    if (!meId || !setLocale) return
    const want = accountLocale(meId, meLocale)
    applied.current.locale = want ?? locale
    if (want && want !== locale) setLocale(want)
    // Only when the person changes: a pick made afterwards is theirs (below).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meId])
  useEffect(() => {
    if (!meId || !locale || applied.current.id !== meId || applied.current.locale === locale) return
    applied.current.locale = locale
    rememberAccountLocale(meId, locale)
  }, [meId, locale])

  const value = useMemo<SessionValue>(
    () => ({
      staff: meQuery.data ?? null,
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
    [meQuery.data, meQuery.isLoading, queryClient],
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
