import { api } from '@/core/api/client'

/**
 * PD-58 (ENG-12): the Terms of Use block the API reports on `GET /me`, the token
 * pair and `GET /me/legal` (API-CONTRACT §1.1c).
 */
export interface LegalDocument {
  documentKey: string
  version: string
  urlAr: string
  urlEn: string
}

export interface LegalBlock {
  state: 'accepted' | 'required' | 'unavailable'
  required: LegalDocument[]
  unavailable: string[]
}

function isDocument(value: unknown): value is LegalDocument {
  if (typeof value !== 'object' || value === null) return false
  const d = value as Record<string, unknown>
  return (
    typeof d.documentKey === 'string' && typeof d.version === 'string' &&
    typeof d.urlAr === 'string' && typeof d.urlEn === 'string'
  )
}

/**
 * Read the `legal` field of an API answer.
 *
 * - Absent (`undefined`/`null`) -> `undefined`: today's API, no gate. The clients
 *   ship BEFORE the API gate, so this must keep working.
 * - Present but unreadable -> `state: 'unavailable'`. FAIL CLOSED: a block we
 *   cannot understand is never read as "accepted".
 */
export function parseLegal(raw: unknown): LegalBlock | undefined {
  if (raw === undefined || raw === null) return undefined
  const unreadable: LegalBlock = { state: 'unavailable', required: [], unavailable: [] }
  if (typeof raw !== 'object') return unreadable
  const r = raw as Record<string, unknown>
  const required = Array.isArray(r.required) ? r.required : []
  const documents = required.filter(isDocument)
  if (documents.length !== required.length) return unreadable
  const unavailable = Array.isArray(r.unavailable) ? r.unavailable.filter((k): k is string => typeof k === 'string') : []
  if (r.state !== 'accepted' && r.state !== 'required' && r.state !== 'unavailable') return unreadable
  return { state: r.state, required: documents, unavailable }
}

export type GateState = 'none' | 'gate' | 'unavailable'

/** What the app shows for a legal block. */
export function legalGateState(legal: LegalBlock | undefined): GateState {
  if (!legal) return 'none'
  if (legal.state === 'unavailable') return 'unavailable'
  if (legal.required.length > 0) return 'gate'
  // `required` with nothing to accept cannot be answered: do not guess.
  return legal.state === 'required' ? 'unavailable' : 'none'
}

export interface LegalStateResponse extends LegalBlock {
  documents?: unknown[]
}

export const legalApi = {
  state: async (): Promise<LegalBlock> =>
    parseLegal(await api.get<unknown>('/me/legal')) ?? { state: 'unavailable', required: [], unavailable: [] },
  accept: async (documents: LegalDocument[], locale: 'ar' | 'en'): Promise<LegalBlock> => {
    const answer = await api.post<{ legal?: unknown }>('/me/legal/accept', {
      documents: documents.map(({ documentKey, version }) => ({ documentKey, version })),
      client: 'admin_web',
      locale,
    })
    return parseLegal(answer?.legal) ?? { state: 'unavailable', required: [], unavailable: [] }
  },
}
