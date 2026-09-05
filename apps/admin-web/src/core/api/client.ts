import { ApiError, NetworkError, fallbackMessages } from './errors'

const BASE_URL: string =
  (import.meta.env?.VITE_API_BASE_URL as string | undefined) ?? '/api/v1'

type Query = Record<string, string | number | boolean | null | undefined>

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  query?: Query
  body?: unknown
  signal?: AbortSignal
  /** Sent as Idempotency-Key so a double-submit cannot create two records. */
  idempotencyKey?: string
}

function buildUrl(path: string, query?: Query): string {
  const url = `${BASE_URL}${path}`
  if (!query) return url
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined || value === '') continue
    params.append(key, String(value))
  }
  const qs = params.toString()
  return qs ? `${url}?${qs}` : url
}

let onUnauthenticated: (() => void) | null = null

/** Registered by the auth layer so a 401 anywhere ends the session once. */
export function setUnauthenticatedHandler(handler: () => void): void {
  onUnauthenticated = handler
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', query, body, signal, idempotencyKey } = options

  const headers: Record<string, string> = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey

  let response: Response
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      headers,
      // Session is a cookie set by the backend; no token is stored in JS.
      credentials: 'include',
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    })
  } catch (cause) {
    if (signal?.aborted) throw cause
    throw new NetworkError(cause)
  }

  if (response.status === 204) return undefined as T

  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    const fallback = fallbackMessages(response.status)
    const err = payload?.error ?? {}
    const apiError = new ApiError({
      status: response.status,
      code: typeof err.code === 'string' ? err.code : `http_${response.status}`,
      messageEn: typeof err.message_en === 'string' ? err.message_en : fallback.en,
      messageAr: typeof err.message_ar === 'string' ? err.message_ar : fallback.ar,
      detail: err.detail ?? payload?.detail ?? null,
    })
    if (apiError.isUnauthenticated) onUnauthenticated?.()
    throw apiError
  }

  return payload as T
}

export const api = {
  get: <T>(path: string, query?: Query, signal?: AbortSignal) =>
    request<T>(path, { method: 'GET', query, signal }),
  post: <T>(path: string, body?: unknown, idempotencyKey?: string) =>
    request<T>(path, { method: 'POST', body, idempotencyKey }),
  patch: <T>(path: string, body?: unknown, idempotencyKey?: string) =>
    request<T>(path, { method: 'PATCH', body, idempotencyKey }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
}

export function newIdempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
}
