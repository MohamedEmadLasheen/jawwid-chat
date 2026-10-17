import { QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { useState } from 'react'
import { createQueryClient } from './queryClient'
import { I18nProvider } from '@/core/i18n/I18nProvider'
import { SessionProvider } from '@/core/auth/SessionProvider'
import { RealtimeProvider } from '@/core/realtime/RealtimeProvider'
import { AppRoutes } from './AppRoutes'
import { CallProvider } from '@/features/calls/CallProvider'
import { CallOverlay } from '@/features/calls/CallOverlay'

export function App() {
  const [queryClient] = useState(createQueryClient)

  return (
    <I18nProvider>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <RealtimeProvider>
            {/* One call per signed-in admin; the call window rings on every page. */}
            <CallProvider>
              <BrowserRouter>
                <AppRoutes />
                {/* Inside the router: the call window opens the call's conversation. */}
                <CallOverlay />
              </BrowserRouter>
            </CallProvider>
          </RealtimeProvider>
        </SessionProvider>
      </QueryClientProvider>
    </I18nProvider>
  )
}
