import { useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useSession } from '@/core/auth/SessionProvider'
import { useI18n } from '@/core/i18n/I18nProvider'
import { ApiError } from '@/core/api/errors'
import { Brand } from '@/shared/components/Brand'
import { Button } from '@/shared/components/Button'
import { Field } from '@/shared/components/Field'
import { Icon } from '@/shared/components/Icon'

/**
 * THE FRONT DOOR.
 *
 * Two panels: the brand on the reading-start side, the form on the other. The
 * brand panel is the one deep-teal surface in the product — everywhere else
 * teal is an accent on a warm neutral ground, and reserving the saturated
 * version for the unauthenticated screen is what makes signing in feel like
 * arriving somewhere rather than unlocking a tool.
 *
 * Below 900px the panel becomes a compact band above the card: on a phone the
 * form is the only thing the operator came for, and a half-screen of brand is
 * a half-screen they have to scroll past.
 *
 * Behaviour is unchanged from the previous revision — same `signIn(subject,
 * password)` mutation, same opaque-subject identifier, same error surface.
 * What changed is that the labels are now translated (they were hard-coded
 * English on an Arabic-first product) and the submit button says "Sign in"
 * rather than repeating the application's own title.
 */
export function LoginPage() {
  const { t, locale } = useI18n()
  const { signIn } = useSession()
  const [subject, setSubject] = useState('')
  const [password, setPassword] = useState('')
  const [revealed, setRevealed] = useState(false)

  const login = useMutation({
    mutationFn: () => signIn(subject, password),
  })

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (login.isPending) return
    login.mutate()
  }

  const errorText =
    login.error instanceof ApiError ? login.error.localized(locale) : t('common.offline')

  return (
    <div className="auth">
      {/*
        The teal panel carries a typographic brand statement, not the logo.
        The supplied asset is a JPEG with an opaque white background, so on this
        surface it would render as a white rectangle. The genuine lockup sits on
        the light card instead, where its own white ground is invisible.
      */}
      <section className="auth__brand">
        <div className="auth__brandInner">
          <p className="auth__brandName">{t('app.title')}</p>
          <p className="auth__tagline">{t('auth.tagline')}</p>
        </div>
      </section>

      <main className="auth__main">
        <div className="auth__card">
          <div className="auth__logo">
            <Brand size="lg" />
          </div>
          <h1 className="auth__title">{t('auth.welcome')}</h1>
          <p className="auth__subtitle">{t('auth.staffOnly')}</p>

          <form onSubmit={onSubmit} noValidate>
            {/*
              The login identifier is an opaque SUBJECT, not an e-mail address:
              chat.account carries no contact channel by design (BR-2). Typed as
              plain text so a browser does not validate it as an address.
            */}
            <Field label={t('auth.username')} hint={t('auth.usernameHint')} required>
              <input
                className="input"
                type="text"
                value={subject}
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                required
                aria-invalid={login.isError || undefined}
                onChange={(e) => setSubject(e.target.value)}
              />
            </Field>

            <Field label={t('auth.password')} required>
              {/*
                The reveal control sits INSIDE the field box rather than beside
                it, so the input keeps the full column width in both scripts —
                `inset-inline-end` puts it on the correct side automatically.
              */}
              <span className="input-affix">
                <input
                  className="input"
                  type={revealed ? 'text' : 'password'}
                  value={password}
                  autoComplete="current-password"
                  required
                  aria-invalid={login.isError || undefined}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  className="input-affix__btn"
                  aria-pressed={revealed}
                  aria-label={revealed ? t('auth.hidePassword') : t('auth.showPassword')}
                  onClick={() => setRevealed((v) => !v)}
                >
                  <Icon name={revealed ? 'eye-off' : 'eye'} size={16} />
                </button>
              </span>
            </Field>

            {login.error && (
              <div className="alert alert--danger" role="alert">
                <Icon name="attention" size={16} />
                <span className="alert__body">{errorText}</span>
              </div>
            )}

            <Button
              type="submit"
              variant="primary"
              size="lg"
              block
              loading={login.isPending}
              className="auth__submit"
            >
              {login.isPending ? t('auth.signingIn') : t('auth.signIn')}
            </Button>
          </form>
        </div>
      </main>
    </div>
  )
}
