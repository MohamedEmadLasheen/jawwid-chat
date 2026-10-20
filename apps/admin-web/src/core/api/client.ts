import { ApiError, NetworkError, fallbackMessages } from './errors'
import { tokenStore } from '@/core/auth/tokens'

const BASE_URL: string =
  (import.meta.env?.VITE_API_BASE_URL as string | undefined) ?? '/api/v1'

type Query = Record<string, string | number | boolean | null | undefined>

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  query?: Query
  body?: unknown
  signal?: AbortSignal
  /** Sent as Idempotency-Key so a double-submit cannot create two records. */
  idempotencyKey?: string
  /**
   * For `/auth/login` and `/auth/refresh` only: send no bearer token, and never
   * answer a 401 by refreshing -- a refresh that re-entered the refresh
   * machinery would wait on its own promise.
   */
  anonymous?: boolean
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

let refreshing: Promise<boolean> | null = null

/**
 * Rotate the session once, however many requests discover the expiry at once.
 *
 * SINGLE-FLIGHT IS A SECURITY PROPERTY HERE, not an optimization: the API
 * treats a refresh token presented twice as theft and revokes every session on
 * the account (auth.service.ts handleRefreshReuse). Ten parallel 401s must
 * produce one `/auth/refresh`, and the other nine wait for its answer.
 */
export function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    const refreshToken = tokenStore.refresh()
    if (!refreshToken) return false
    try {
      const pair = await request<{ accessToken: string; refreshToken: string }>('/auth/refresh', {
        method: 'POST',
        body: { refreshToken },
        anonymous: true,
      })
      tokenStore.set(pair)
      return true
    } catch {
      tokenStore.clear()
      return false
    }
  })().finally(() => {
    refreshing = null
  })
  return refreshing
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await send(path, options)

  // An expired access token is routine (15 minutes); rotate once and retry once.
  if (response.status === 401 && !options.anonymous && (await refreshSession())) {
    return parse<T>(await send(path, options), options)
  }
  return parse<T>(response, options)
}

async function send(path: string, options: RequestOptions): Promise<Response> {
  const { method = 'GET', query, body, signal, idempotencyKey, anonymous } = options

  const headers: Record<string, string> = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey
  const access = anonymous ? null : tokenStore.access()
  if (access) headers['Authorization'] = `Bearer ${access}`

  try {
    return await fetch(buildUrl(path, query), {
      method,
      headers,
      // The API sets no cookie; identity is the bearer token above, never ambient.
      credentials: 'omit',
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    })
  } catch (cause) {
    if (signal?.aborted) throw cause
    throw new NetworkError(cause)
  }
}

async function parse<T>(response: Response, options: RequestOptions): Promise<T> {
  if (response.status === 204) return undefined as T

  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    const fallback = fallbackMessages(response.status)
    const err = payload?.error ?? {}
    // The NestJS API sends one `message`; the legacy contract sent both
    // languages. Prefer the specific field, then the single message, then the
    // status fallback -- an operator always gets the server's own reason.
    const single = typeof err.message === 'string' ? err.message : null
    const apiError = new ApiError({
      status: response.status,
      code: typeof err.code === 'string' ? err.code : `http_${response.status}`,
      messageEn: typeof err.message_en === 'string' ? err.message_en : single ?? fallback.en,
      messageAr: typeof err.message_ar === 'string' ? err.message_ar : single ?? fallback.ar,
      detail: err.detail ?? payload?.detail ?? null,
    })
    if (apiError.isUnauthenticated && !options.anonymous) {
      tokenStore.clear()
      onUnauthenticated?.()
    }
    throw apiError
  }

  return payload as T
}

/**
 * A file the API streams (a chat export): its bytes and the server's file name.
 * Same bearer, same single refresh-and-retry as `request`; an error answer is
 * the usual JSON and throws the usual ApiError.
 */
export async function download(path: string): Promise<{ blob: Blob; fileName: string | null }> {
  let response = await send(path, {})
  if (response.status === 401 && (await refreshSession())) response = await send(path, {})
  if (!response.ok) return parse<never>(response, {})
  const disposition = response.headers.get('Content-Disposition') ?? ''
  return { blob: await response.blob(), fileName: /filename="([^"]+)"/.exec(disposition)?.[1] ?? null }
}

export const api = {
  get: <T>(path: string, query?: Query, signal?: AbortSignal) =>
    request<T>(path, { method: 'GET', query, signal }),
  post: <T>(path: string, body?: unknown, idempotencyKey?: string) =>
    request<T>(path, { method: 'POST', body, idempotencyKey }),
  patch: <T>(path: string, body?: unknown, idempotencyKey?: string) =>
    request<T>(path, { method: 'PATCH', body, idempotencyKey }),
  put: <T>(path: string, body?: unknown, idempotencyKey?: string) =>
    request<T>(path, { method: 'PUT', body, idempotencyKey }),
  delete: <T>(path: string, query?: Query) => request<T>(path, { method: 'DELETE', query }),
}

export function newIdempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
}
