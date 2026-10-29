import { useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { sessionApi } from '@/core/api/endpoints'
import { ApiError } from '@/core/api/errors'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useCopy, type Pair } from '@/features/organization/copy'
import { PASSWORD_MIN_LENGTH } from './passwordPolicy'


export const R = {
  open: { en: 'Forgot your password? I have a reset code', ar: 'نسيت كلمة المرور؟ لديّ رمز إعادة تعيين' },
  title: { en: 'Set a new password', ar: 'تعيين كلمة مرور جديدة' },
  explain: {
    en: 'Ask an administrator for a one-time code, then choose a new password. Nobody else will know it.',
    ar: 'اطلب رمزًا لمرة واحدة من أحد المسؤولين، ثم اختر كلمة مرور جديدة. لن يعرفها أحد غيرك.',
  },
  code: { en: 'One-time code', ar: 'الرمز لمرة واحدة' },
  password: { en: 'New password', ar: 'كلمة المرور الجديدة' },
  confirm: { en: 'Repeat the new password', ar: 'أعد كتابة كلمة المرور الجديدة' },
  tooShort: { en: `At least ${PASSWORD_MIN_LENGTH} characters.`, ar: `${PASSWORD_MIN_LENGTH} أحرف على الأقل.` },
  mismatch: { en: 'The two passwords differ.', ar: 'كلمتا المرور غير متطابقتين.' },
  submit: { en: 'Set password', ar: 'تعيين كلمة المرور' },
  saving: { en: 'Saving…', ar: 'جارٍ الحفظ…' },
  back: { en: 'Back to sign in', ar: 'العودة إلى تسجيل الدخول' },
  done: {
    en: 'Your password is set, and you were signed out everywhere. Sign in with the new password.',
    ar: 'تم تعيين كلمة المرور، وتم تسجيل خروجك من كل الأجهزة. سجّل الدخول بكلمة المرور الجديدة.',
  },
} satisfies Record<string, Pair>

const BY_CODE: Record<string, Pair> = {
  'AUTH.RESET_CODE_INVALID': {
    en: 'This code is not valid, has expired or was already used. Ask your administrator for a new one.',
    ar: 'هذا الرمز غير صالح أو منتهي أو مستخدم من قبل. اطلب رمزًا جديدًا من المسؤول.',
  },
  'AUTH.PASSWORD_TOO_WEAK': {
    en: `Choose a password of at least ${PASSWORD_MIN_LENGTH} characters.`,
    ar: `اختر كلمة مرور من ${PASSWORD_MIN_LENGTH} أحرف على الأقل.`,
  },
  'COMMON.RATE_LIMITED': { en: 'Too many attempts. Try again in a few minutes.', ar: 'محاولات كثيرة. حاول مرة أخرى بعد دقائق.' },
}

/**
 * PD-21: the person finishes a password reset an administrator issued. The
 * administrator handed over a one-time code; the password is the person's own
 * and goes to the server only. Nothing here opens a session.
 */
export function PasswordResetForm({ initialEmail, onDone, onBack }: { initialEmail: string; onDone: (email: string) => void; onBack: () => void }) {
  const tx = useCopy()
  const { locale, t } = useI18n()
  const [email, setEmail] = useState(initialEmail)
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [touched, setTouched] = useState(false)

  const complete = useMutation({
    mutationFn: () => sessionApi.completePasswordReset(email.trim(), code.trim(), password),
    onSuccess: () => onDone(email.trim()),
  })

  const problem = password.length < PASSWORD_MIN_LENGTH ? R.tooShort : password !== confirm ? R.mismatch : null

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    setTouched(true)
    if (problem || complete.isPending) return
    complete.mutate()
  }

  const error = complete.error
  const message =
    error instanceof ApiError ? (BY_CODE[error.code] ? tx(BY_CODE[error.code]!) : error.localized(locale)) : error ? t('common.offline') : null

  return (
    <form className="login__card" onSubmit={onSubmit} aria-labelledby="reset-title">
      <h1 className="login__title" id="reset-title">
        {tx(R.title)}
      </h1>
      <p className="login__subtitle">{tx(R.explain)}</p>

      <label className="field">
        <span className="field__label">{t('auth.email')}</span>
        <input className="input" type="email" value={email} autoComplete="username" required onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="field">
        <span className="field__label">{tx(R.code)}</span>
        <input
          className="input"
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          dir="ltr"
          value={code}
          autoComplete="one-time-code"
          required
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
        />
      </label>
      <label className="field">
        <span className="field__label">{tx(R.password)}</span>
        <input className="input" type="password" value={password} autoComplete="new-password" required onChange={(e) => setPassword(e.target.value)} />
        <span className="field__hint">{tx(R.tooShort)}</span>
      </label>
      <label className="field">
        <span className="field__label">{tx(R.confirm)}</span>
        <input className="input" type="password" value={confirm} autoComplete="new-password" required onChange={(e) => setConfirm(e.target.value)} />
      </label>

      {touched && problem && (
        <div className="field__error" role="alert">
          {tx(problem)}
        </div>
      )}
      {message && (
        <div className="field__error" role="alert">
          {message}
        </div>
      )}

      <button type="submit" className="btn btn--primary btn--block" disabled={complete.isPending} style={{ marginBlockStart: 'var(--space-2)' }}>
        {complete.isPending ? tx(R.saving) : tx(R.submit)}
      </button>
      <button type="button" className="btn btn--ghost btn--block" onClick={onBack}>
        {tx(R.back)}
      </button>
    </form>
  )
}
