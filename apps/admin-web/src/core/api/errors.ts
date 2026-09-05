/** Locale-aware API error. Never surfaces a stack trace to an operator. */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly messageEn: string
  readonly messageAr: string
  /** Server-supplied detail, e.g. coverage schedule conflicts on a 409. */
  readonly detail: unknown

  constructor(args: {
    status: number
    code: string
    messageEn: string
    messageAr: string
    detail?: unknown
  }) {
    super(args.messageEn)
    this.name = 'ApiError'
    this.status = args.status
    this.code = args.code
    this.messageEn = args.messageEn
    this.messageAr = args.messageAr
    this.detail = args.detail
  }

  localized(locale: 'ar' | 'en'): string {
    return locale === 'ar' ? this.messageAr : this.messageEn
  }

  /** The backend refused on authorization grounds. Never work around this. */
  get isForbidden(): boolean {
    return this.status === 403
  }

  get isUnauthenticated(): boolean {
    return this.status === 401
  }

  get isNotFound(): boolean {
    return this.status === 404
  }

  /** Another actor won the race (e.g. two admins resolving one case). */
  get isConflict(): boolean {
    return this.status === 409
  }
}

const FALLBACK: Record<number, { en: string; ar: string }> = {
  401: { en: 'Your session has expired. Please sign in again.', ar: 'انتهت جلستك. يرجى تسجيل الدخول مرة أخرى.' },
  403: { en: "You don't have permission to do this.", ar: 'ليس لديك صلاحية للقيام بذلك.' },
  404: { en: 'This item no longer exists.', ar: 'هذا العنصر لم يعد موجودًا.' },
  409: { en: 'Someone else changed this first. Refreshing.', ar: 'قام شخص آخر بتغيير هذا أولاً. يتم التحديث.' },
  500: { en: 'Something went wrong on our side.', ar: 'حدث خطأ من جانبنا.' },
}

export function fallbackMessages(status: number): { en: string; ar: string } {
  return (
    FALLBACK[status] ?? {
      en: 'Something went wrong.',
      ar: 'حدث خطأ ما.',
    }
  )
}

/** Network failure / server unreachable, as distinct from an HTTP error. */
export class NetworkError extends ApiError {
  constructor(cause?: unknown) {
    super({
      status: 0,
      code: 'network_unavailable',
      messageEn: 'Connection lost. Check your network.',
      messageAr: 'انقطع الاتصال. تحقق من الشبكة.',
      detail: cause,
    })
    this.name = 'NetworkError'
  }
}
