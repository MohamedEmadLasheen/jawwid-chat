import { useI18n } from '@/core/i18n/I18nProvider'

/**
 * "Ola Mahmoud, 25 Nov 2026, 11:00": who and when, each isolated so a Latin
 * name beside an Arabic date never reorders the line.
 */
export function By({ name, when, prefix }: { name?: string | null; when: string; prefix?: string }) {
  const { locale } = useI18n()
  const sep = locale === 'ar' ? '، ' : ', '
  return (
    <span className="tf-byline">
      {prefix}
      {name && (
        <>
          <bdi>{name}</bdi>
          {sep}
        </>
      )}
      <bdi>{when}</bdi>
    </span>
  )
}
