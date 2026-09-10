import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent'

/**
 * THE BUTTON.
 *
 * A thin wrapper over the `.btn` classes rather than a new abstraction: the
 * CSS in `app.css` is still where a button's appearance is decided, and this
 * exists so that "primary, loading, full width" is a set of props instead of a
 * hand-assembled class string that every caller spells slightly differently.
 *
 * Two things it does that a class string cannot:
 *
 *   - `type` defaults to `button`. The HTML default is `submit`, which is how
 *     a Cancel control inside a form ends up submitting it.
 *   - `loading` keeps the label mounted and hides it visually, so the button
 *     does not change width while it works, and sets `aria-busy` and
 *     `disabled` together so the state reaches assistive tech and the pointer
 *     at the same time.
 *
 * Gold (`accent`) is a brand moment, not a second primary — see §26 and the
 * note on `.btn--accent`.
 */
export function Button({
  variant = 'secondary',
  size,
  loading = false,
  block = false,
  iconOnly = false,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: {
  variant?: Variant
  size?: 'sm' | 'lg'
  loading?: boolean
  block?: boolean
  iconOnly?: boolean
  children?: ReactNode
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> & { className?: string }) {
  const classes = [
    'btn',
    `btn--${variant}`,
    size ? `btn--${size}` : '',
    block ? 'btn--block' : '',
    iconOnly ? 'btn--icon' : '',
    loading ? 'is-loading' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button
      type={type}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {children}
    </button>
  )
}
