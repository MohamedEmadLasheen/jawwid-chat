import { QueryClient } from '@tanstack/react-query'
import { ApiError } from '@/core/api/errors'

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Realtime carries the freshness burden, so we do not poll. Where an
        // event stream does not exist for a value, that query opts into its own
        // refetchInterval explicitly.
        refetchOnWindowFocus: true,
        staleTime: 15_000,
        retry: (failureCount, error) => {
          // Retrying a 401/403/404 is pointless and, for 403, is exactly the
          // "fallback access attempt" the role brief forbids.
          if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false
          return failureCount < 2
        },
      },
      mutations: { retry: false },
    },
  })
}
