import { useI18n } from '@/core/i18n/I18nProvider'

export function ForbiddenPage() {
  const { t } = useI18n()
  return (
    <div className="page">
      <div className="state" role="alert">
        <div className="state__title">{t('common.forbidden')}</div>
      </div>
    </div>
  )
}
