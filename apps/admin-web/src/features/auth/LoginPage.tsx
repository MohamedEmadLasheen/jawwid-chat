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
 * ONE column: the card, centred, on the same page ground as the rest of the
 * app. There is no brand panel beside it. The genuine lockup at the top of the
 * card is the whole brand statement here — a half-screen field of teal beside
 * it competed with the artwork rather than framing it, and on a phone it was
 * a band the account holder had to scroll past to reach the only thing they
 * came for. Removing it leaves the ground the product already uses; nothing
 * was substituted in its place.
 *
 * Behaviour is unchanged — same `signIn(subject, password)` mutation, same
 * opaque-subject identifier, same error surface, same fields in the same
 * order.
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
      <main className="auth__main">
        <div className="auth__card">
          <div className="auth__logo">
            <Brand size="lg" />
          </div>
          <h1 className="auth__title">{t('auth.welcome')}</h1>

          <form onSubmit={onSubmit} noValidate>
            {/*
              The login identifier is an opaque SUBJECT, not an e-mail address:
              chat.account carries no contact channel by design (BR-2). Typed as
              plain text so a browser does not validate it as an address.
            */}
            <Field label={t('auth.username')} required>
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
