import { QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { useState } from 'react'
import { createQueryClient } from './queryClient'
import { I18nProvider } from '@/core/i18n/I18nProvider'
import { SessionProvider } from '@/core/auth/SessionProvider'
import { RealtimeProvider } from '@/core/realtime/RealtimeProvider'
import { AppRoutes } from './AppRoutes'

export function App() {
  const [queryClient] = useState(createQueryClient)

  return (
    <I18nProvider>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <RealtimeProvider>
            <BrowserRouter>
              <AppRoutes />
            </BrowserRouter>
          </RealtimeProvider>
        </SessionProvider>
      </QueryClientProvider>
    </I18nProvider>
  )
}
