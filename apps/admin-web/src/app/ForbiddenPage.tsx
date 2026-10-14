import { Link } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { TEXT, useText } from '@/features/admin/copy'
import { Icon } from '@/shared/components/Icon'

/**
 * A route this role may not open. It says so, says why in one line, and offers
 * the one way out that always works: "/" redirects to this role's own home.
 */
export function ForbiddenPage() {
  const { t } = useI18n()
  const tx = useText()
  return (
    <div className="page">
      <div className="state state--forbidden" role="alert">
        <span className="state__icon" aria-hidden="true">
          <Icon name="lock" size={22} />
        </span>
        <div className="state__title">{t('common.forbidden')}</div>
        <div className="state__body">{tx(TEXT.forbiddenHint)}</div>
        <Link to="/" className="btn btn--sm">
          {tx(TEXT.goToStart)}
        </Link>
      </div>
    </div>
  )
}
