import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useI18n } from '@/core/i18n/I18nProvider'
import type { MessageKey } from '@/core/i18n/messages'
import { useSession } from '@/core/auth/SessionProvider'
import { ApiError } from '@/core/api/errors'
import { qk } from '@/core/api/queryKeys'
import { BrandLogo } from '@/shared/components/BrandLogo'
import type { Staff } from '@/shared/types/domain'
import { legalApi, type LegalBlock, type LegalDocument } from './legal'

const docKey = (d: LegalDocument) => `${d.documentKey}@${d.version}`

/** terms_family / terms_teacher / terms_staff share one title and one label. */
function titleKey(documentKey: string): MessageKey | null {
  if (documentKey.startsWith('terms_')) return 'legal.doc.terms'
  if (documentKey === 'code_of_conduct') return 'legal.doc.code_of_conduct'
  return null
}

function agreeKey(documentKey: string): MessageKey | null {
  if (documentKey.startsWith('terms_')) return 'legal.agree.terms'
  if (documentKey === 'code_of_conduct') return 'legal.agree.code_of_conduct'
  return null
}

type Problem = 'stale' | 'support' | 'generic' | null

/**
 * PD-58 (ENG-12): full-page Terms of Use gate, shown after authentication while
 * the account has documents to accept. One row per document; nothing pre-ticked;
 * "Agree" only once every box is ticked.
 *
 * Delete account and the Privacy Policy link are deliberately absent: Admin Web
 * has no self-service account deletion and no privacy-policy URL setting
 * (developer-implementation-guide §6.4: "Admin Web has no links").
 */
export function LegalGate({ staff }: { staff: Staff }) {
  const { t, locale, dir } = useI18n()
  const { signOut } = useSession()
  const queryClient = useQueryClient()
  const [ticked, setTicked] = useState<Record<string, boolean>>({})
  const [problem, setProblem] = useState<Problem>(null)

  // GET /me/legal is the freshest answer: write it into the session so the
  // guard decides from it (accepted in another tab -> the app; unavailable ->
  // the notice; a changed list -> the new rows). Same shape as /me's block.
  // Only an answer NEWER than the session's own is applied: a cached answer from
  // an earlier visit must never override a fresher /me or 403 (fail closed).
  // gcTime 0: nothing of this answer outlives the gate.
  const fresh = useQuery({ queryKey: ['me', 'legal'], queryFn: legalApi.state, retry: false, staleTime: 0, gcTime: 0 })
  useEffect(() => {
    const next = fresh.data
    if (!next || fresh.dataUpdatedAt <= (queryClient.getQueryState(qk.me)?.dataUpdatedAt ?? 0)) return
    const { state, required, unavailable } = next
    queryClient.setQueryData<Staff | null>(qk.me, (me) => (me ? { ...me, legal: { state, required, unavailable } } : me))
  }, [fresh.data, fresh.dataUpdatedAt, queryClient])
  const documents: LegalDocument[] = staff.legal?.required ?? []

  const allTicked = documents.length > 0 && documents.every((d) => ticked[docKey(d)])

  const reload = async () => {
    setTicked({})
    await Promise.allSettled([queryClient.invalidateQueries({ queryKey: qk.me, exact: true }), fresh.refetch()])
  }

  const accept = useMutation({
    mutationFn: () => legalApi.accept(documents, locale),
    onSuccess: async (legal: LegalBlock) => {
      setProblem(null)
      // A /me answer already in flight predates this acceptance: drop it, or it
      // would overwrite "accepted" and bring the gate back.
      await queryClient.cancelQueries({ queryKey: qk.me, exact: true })
      queryClient.setQueryData<Staff | null>(qk.me, (me) => (me ? { ...me, legal } : me))
    },
    onError: (error) => {
      const code = error instanceof ApiError ? error.code : null
      if (code === 'COMM.LEGAL_VERSION_STALE' || code === 'COMM.LEGAL_WRONG_DOCUMENTS') {
        // Never resend the same body: reload what is in force and ask again.
        setProblem('stale')
        void reload()
      } else if (code === 'COMM.SUPPORT_SESSION_FORBIDDEN') {
        setProblem('support')
      } else {
        // Includes 503 COMM.LEGAL_NOT_CONFIGURED: an operator's problem, shown generically.
        setProblem('generic')
      }
    },
  })

  const title = (d: LegalDocument) => {
    const key = titleKey(d.documentKey)
    return key ? t(key) : d.documentKey
  }
  const agreeLabel = (d: LegalDocument) => {
    const key = agreeKey(d.documentKey)
    return key ? t(key) : t('legal.agree.generic', { title: title(d) })
  }

  return (
    <main className="login legal-gate" dir={dir} lang={locale} aria-labelledby="legal-title">
      <form
        className="login__card legal-gate__card"
        onSubmit={(e) => {
          e.preventDefault()
          if (allTicked && !accept.isPending) accept.mutate()
        }}
      >
        <div className="login__brand">
          <BrandLogo />
        </div>
        <h1 className="login__title" id="legal-title">{t('legal.title')}</h1>
        <p className="login__subtitle">{t('legal.intro')}</p>

        <ul className="legal-gate__list">
          {documents.map((d) => (
            <li key={docKey(d)} className="legal-gate__row">
              <div className="legal-gate__head">
                <strong>{title(d)}</strong>
                <a
                  href={locale === 'ar' ? d.urlAr : d.urlEn}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={t('legal.openLabel', { title: title(d) })}
                >
                  {t('legal.open')}
                </a>
              </div>
              <label className="login__remember">
                <input
                  type="checkbox"
                  checked={ticked[docKey(d)] === true}
                  onChange={(e) => setTicked((prev) => ({ ...prev, [docKey(d)]: e.target.checked }))}
                />
                <span>{agreeLabel(d)}</span>
              </label>
            </li>
          ))}
        </ul>

        {problem && (
          <div className="field__error" role="alert">
            {problem === 'stale' ? t('legal.error.stale') : problem === 'support' ? t('legal.error.support') : t('legal.error.generic')}
          </div>
        )}

        <button type="submit" className="btn btn--primary btn--block" disabled={!allTicked || accept.isPending}>
          {accept.isPending ? t('legal.agreeing') : t('legal.agree')}
        </button>
        <button type="button" className="btn btn--ghost btn--block btn--sm" onClick={() => void signOut()}>
          {t('common.signOut')}
        </button>
      </form>
    </main>
  )
}

/** The server cannot decide which Terms apply: never treated as accepted. */
export function LegalUnavailable() {
  const { t, locale, dir } = useI18n()
  const { signOut } = useSession()
  const queryClient = useQueryClient()
  return (
    <main className="login legal-gate" dir={dir} lang={locale} aria-labelledby="legal-title">
      <div className="login__card legal-gate__card">
        <div className="login__brand">
          <BrandLogo />
        </div>
        <div role="alert">
          <h1 className="login__title" id="legal-title">{t('legal.unavailable.title')}</h1>
          <p className="login__subtitle">{t('legal.unavailable.body')}</p>
        </div>
        <button type="button" className="btn btn--primary btn--block" onClick={() => void queryClient.invalidateQueries({ queryKey: qk.me, exact: true })}>
          {t('common.retry')}
        </button>
        <button type="button" className="btn btn--ghost btn--block btn--sm" onClick={() => void signOut()}>
          {t('common.signOut')}
        </button>
      </div>
    </main>
  )
}
