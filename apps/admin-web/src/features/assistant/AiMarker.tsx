import type { ReactNode } from 'react'

/**
 * The AI marker (Phase 7 §34).
 *
 * Everything a model produced is wrapped in one of these, and nothing a human
 * wrote ever is. The requirement is that AI output must not read as a verified
 * human statement -- so the marking is structural (a labelled container with
 * its own border and tint) rather than a word somebody might delete while
 * editing the copy.
 */
export function AiBlock({
  kind,
  children,
  footer,
}: {
  kind: 'suggestion' | 'summary' | 'attention'
  children: ReactNode
  footer?: ReactNode
}) {
  const label =
    kind === 'suggestion' ? '✨ Suggested response'
    : kind === 'summary' ? '✨ AI summary'
    : '⚠ Attention'

  return (
    <section className={`ai-block ai-block--${kind}`} aria-label={label}>
      <header className="ai-block__label">
        <span>{label}</span>
        {/* Stated on every block rather than once per page: a manager scanning
            a long thread should never have to remember which parts to trust. */}
        <span className="ai-block__caveat">AI-generated · check before sending</span>
      </header>
      <div className="ai-block__body">{children}</div>
      {footer ? <footer className="ai-block__actions">{footer}</footer> : null}
    </section>
  )
}
