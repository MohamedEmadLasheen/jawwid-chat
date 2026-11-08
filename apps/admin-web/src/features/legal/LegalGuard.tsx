import type { ReactNode } from 'react'
import { useSession } from '@/core/auth/SessionProvider'
import { LegalGate, LegalUnavailable } from './LegalGate'
import { legalGateState } from './legal'

/**
 * PD-58: sits after the authentication check. No `legal` field (today's API) or
 * `accepted` -> the app; `required` -> the gate; `unavailable` -> the notice.
 */
export function LegalGuard({ children }: { children: ReactNode }) {
  const { staff } = useSession()
  if (!staff) return null
  const state = legalGateState(staff.legal)
  if (state === 'gate') return <LegalGate staff={staff} />
  if (state === 'unavailable') return <LegalUnavailable />
  return <>{children}</>
}
