import { useId, useMemo, type ReactNode } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { SearchableSelect, type SelectOption } from '@/shared/components/SearchableSelect'
import { useCountries, useSubdivisions, type GeoCountry, type GeoSubdivision, type Names } from './api'

/**
 * PD-45 PR-2b (plan §5.1): the one location picker of the Admin Web, built on
 * SearchableSelect (never a native <select>).
 *
 *  - Country: pinned markets first (Egypt, the Gulf, Jordan -- owner Q3), a
 *    divider, then every other country A-Z in the interface language. Each row
 *    shows a flag and the name, with the other language and the ISO code muted
 *    beside it; search matches all of them (Arabic folded: "جيزه" finds "الجيزة").
 *  - Subdivision: a second list filtered by the chosen country and labelled
 *    for it (Governorate, Emirate, State ...). Changing the country clears it;
 *    it is disabled until a country is chosen and absent when the country has none.
 *  - `countryOnly`: the country list alone (Stories' audience data).
 *
 * It holds no state of its own: `value` in, `onChange` out, so a form decides
 * when to save. PR-3b (trials) reuses it unchanged.
 */
export interface LocationValue {
  countryCode: string | null
  subdivisionCode: string | null
}

export interface LocationPickerProps {
  value: LocationValue
  onChange: (next: LocationValue) => void
  countryOnly?: boolean
  disabled?: boolean
  /** No visible labels (a table cell); the country list is then named by `ariaLabel`. */
  hideLabels?: boolean
  ariaLabel?: string
  /** The picker saves as soon as it changes: one stray click must not clear the value. */
  clearable?: boolean
  /** A small select for a table cell. */
  compact?: boolean
}

/** A flag from its ISO code (regional indicator symbols). Decorative. */
export function flagOf(code: string): string {
  if (!/^[A-Z]{2}$/.test(code)) return ''
  return String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
}

const nameOf = (n: Names, locale: 'ar' | 'en') => (locale === 'ar' ? n.ar : n.en)
const otherOf = (n: Names, locale: 'ar' | 'en') => (locale === 'ar' ? n.en : n.ar)

/** Pinned first (in their pinned order), a divider, the rest A-Z in `locale`. */
export function countryOptions(countries: readonly GeoCountry[], locale: 'ar' | 'en'): SelectOption[] {
  const toOption = (c: GeoCountry): SelectOption => ({
    value: c.code,
    label: `${flagOf(c.code)} ${nameOf(c, locale)}`.trim(),
    hint: `${otherOf(c, locale)} · ${c.code}`,
  })
  const pinned = countries.filter((c) => c.pinned !== null).sort((a, b) => a.pinned! - b.pinned!)
  const rest = countries.filter((c) => c.pinned === null).sort((a, b) => nameOf(a, locale).localeCompare(nameOf(b, locale), locale))
  return [...pinned.map(toOption), ...(pinned.length > 0 && rest.length > 0 ? [{ value: '', label: '', separator: true }] : []), ...rest.map(toOption)]
}

/** A country's subdivisions, A-Z in `locale`. */
export function subdivisionOptions(subdivisions: readonly GeoSubdivision[], locale: 'ar' | 'en'): SelectOption[] {
  return [...subdivisions]
    .sort((a, b) => nameOf(a, locale).localeCompare(nameOf(b, locale), locale))
    .map((s) => ({ value: s.code, label: nameOf(s, locale), hint: `${otherOf(s, locale)} · ${s.code}` }))
}

export function LocationPicker({ value, onChange, countryOnly = false, disabled, hideLabels = false, ariaLabel, clearable = true, compact = false }: LocationPickerProps) {
  const { locale, t } = useI18n()
  const countries = useCountries()
  const country = value.countryCode ? countries.data?.countries.find((c) => c.code === value.countryCode) : undefined
  const showSubdivision = !countryOnly && (!value.countryCode || !country || country.hasSubdivisions)
  const subdivisions = useSubdivisions(value.countryCode, showSubdivision && !!country?.hasSubdivisions)
  const countryId = useId()
  const subdivisionId = useId()
  const className = compact ? 'select select--sm' : 'select'

  const countryList = useMemo(() => {
    const options = countryOptions(countries.data?.countries ?? [], locale)
    // A stored code that is not a country of the list (the old "other" box) stays visible, so staff can replace it.
    if (value.countryCode && countries.data && !country) {
      options.unshift({ value: value.countryCode, label: t('common.location.notInList', { code: value.countryCode }), disabled: true })
    }
    return [{ value: '', label: t('common.location.notSet') }, ...options]
  }, [countries.data, country, locale, t, value.countryCode])

  const subdivisionList = useMemo(
    () => [{ value: '', label: t('common.location.notSet') }, ...subdivisionOptions(subdivisions.data?.subdivisions ?? [], locale)],
    [subdivisions.data, locale, t],
  )

  const subdivisionLabel = nameOf(country?.label ?? countries.data?.defaultLabel ?? { en: 'Region', ar: 'المنطقة' }, locale)
  const countryLabel = t('common.location.country')

  return (
    <>
      <Row id={countryId} label={countryLabel} hidden={hideLabels}>
        <SearchableSelect
          id={countryId}
          className={className}
          clearable={clearable}
          disabled={disabled}
          value={value.countryCode ?? ''}
          options={countryList}
          aria-label={hideLabels ? (ariaLabel ?? countryLabel) : undefined}
          onValueChange={(v) => onChange({ countryCode: v === '' ? null : v, subdivisionCode: null })}
        />
      </Row>
      {showSubdivision && (
        <Row id={subdivisionId} label={subdivisionLabel} hidden={hideLabels}>
          <SearchableSelect
            id={subdivisionId}
            className={className}
            clearable={clearable}
            disabled={disabled || !value.countryCode || !country}
            value={value.subdivisionCode ?? ''}
            options={subdivisionList}
            aria-label={hideLabels ? `${ariaLabel ? `${ariaLabel}: ` : ''}${subdivisionLabel}` : undefined}
            onValueChange={(v) => onChange({ countryCode: value.countryCode, subdivisionCode: v === '' ? null : v })}
          />
        </Row>
      )}
    </>
  )
}

function Row({ id, label, hidden, children }: { id: string; label: string; hidden: boolean; children: ReactNode }) {
  if (hidden) return <>{children}</>
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {children}
    </div>
  )
}

/**
 * A location as it reads: "Egypt · Giza" / "مصر · الجيزة", the country alone,
 * or a dash. Names come from the same lists as the picker (cached for the
 * session), so a table of many rows fetches each country's list once.
 */
export function LocationText({ value }: { value: LocationValue }) {
  const { locale } = useI18n()
  const countries = useCountries()
  const country = value.countryCode ? countries.data?.countries.find((c) => c.code === value.countryCode) : undefined
  const subdivisions = useSubdivisions(value.countryCode, !!value.subdivisionCode && !!country?.hasSubdivisions)
  if (!value.countryCode) return <>—</>
  const countryName = country ? nameOf(country, locale) : value.countryCode
  const sub = value.subdivisionCode ? subdivisions.data?.subdivisions.find((s) => s.code === value.subdivisionCode) : undefined
  return <bdi>{sub ? `${countryName} · ${nameOf(sub, locale)}` : countryName}</bdi>
}
