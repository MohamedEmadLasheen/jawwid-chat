import { useMemo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Icon, type IconName } from '@/shared/components/Icon'
import { fill, useText, type Bilingual } from '@/features/admin/copy'
import {
  CHILD_BUCKETS,
  PLAN_MONTHS,
  type AudienceClause,
  type AudienceFacts,
  type SegmentWho,
} from './api'
import {
  allCountryCodes,
  CHILDREN_LABEL,
  flagOf,
  PLAN_LABEL,
  S,
  SUGGESTED_COUNTRIES,
  useCountryName,
} from './copy'

export interface AudienceDraft {
  who: SegmentWho | null
  planMonths: number[]
  children: number[]
  countries: string[]
}

export const EMPTY_AUDIENCE: AudienceDraft = { who: null, planMonths: [], children: [], countries: [] }

/**
 * The authored audience as the API takes it: ONE segment clause. Empty
 * dimensions are left out (they mean "any"), and the family dimensions only
 * travel with "families" -- the server refuses them anywhere else.
 */
export function toClauses(d: AudienceDraft): AudienceClause[] | null {
  if (!d.who) return null
  if (d.who !== 'families') return [{ kind: 'segment', filter: { who: d.who } }]
  return [
    {
      kind: 'segment',
      filter: {
        who: 'families',
        ...(d.planMonths.length ? { planMonths: [...d.planMonths].sort((a, b) => a - b) } : {}),
        ...(d.children.length ? { children: [...d.children].sort((a, b) => a - b) } : {}),
        ...(d.countries.length ? { countries: [...d.countries].sort() } : {}),
      },
    },
  ]
}

const WHO: Array<{ key: SegmentWho; icon: IconName; label: Bilingual; hint: Bilingual }> = [
  { key: 'everyone', icon: 'globe', label: S.whoEveryone, hint: S.whoEveryoneHint },
  { key: 'families', icon: 'users', label: S.whoFamilies, hint: S.whoFamiliesHint },
  { key: 'teachers', icon: 'academy', label: S.whoTeachers, hint: S.whoTeachersHint },
]

/**
 * Who a story goes to, chosen in two decisions: WHO (three cards), then --
 * for parents -- WHICH of them, as toggle chips. Each chip shows how many
 * families it covers, so the effect of a choice is visible before the
 * estimate even comes back.
 */
export function AudienceBuilder({
  value,
  onChange,
  facts,
  dataPath,
}: {
  value: AudienceDraft
  onChange: (next: AudienceDraft) => void
  facts: AudienceFacts | undefined
  /** Where the family data can be filled in; null when this role may not. */
  dataPath: string | null
}) {
  const tx = useText()
  const { number } = useI18n()
  const countryName = useCountryName()

  const planCount = (m: number) => facts?.plans.find((p) => p.months === m)?.families
  const childCount = (b: number) => facts?.children.find((c) => c.bucket === b)?.families

  const offeredCountries = useMemo(() => {
    const fromData = (facts?.countries ?? []).map((c) => c.code)
    const set = new Set<string>([...fromData, ...value.countries])
    if (set.size < 6) for (const c of SUGGESTED_COUNTRIES.slice(0, 6)) set.add(c)
    return [...set]
  }, [facts, value.countries])

  const addable = useMemo(() => {
    const known = new Set(offeredCountries)
    const suggested = SUGGESTED_COUNTRIES.filter((c) => !known.has(c))
    const rest = allCountryCodes()
      .filter((c) => !known.has(c) && !(SUGGESTED_COUNTRIES as readonly string[]).includes(c))
      .map((c) => [c, countryName(c)] as const)
      .filter(([c, name]) => name !== c)
      .sort((a, b) => a[1].localeCompare(b[1]))
    return { suggested, rest }
  }, [offeredCountries, countryName])

  const toggle = (list: number[] | string[], v: number | string) =>
    (list as Array<number | string>).includes(v)
      ? (list as Array<number | string>).filter((x) => x !== v)
      : [...list, v]

  const countryFacts = (code: string) => facts?.countries.find((c) => c.code === code)?.families ?? 0

  return (
    <div className="audience">
      <div className="who-cards" role="radiogroup" aria-label={tx(S.who)}>
        {WHO.map((w) => {
          const checked = value.who === w.key
          return (
            <label key={w.key} className={`who-card${checked ? ' is-selected' : ''}`}>
              <input
                type="radio"
                name="story-who"
                className="sr-only"
                checked={checked}
                onChange={() => onChange({ ...EMPTY_AUDIENCE, who: w.key })}
              />
              <span className="who-card__icon" aria-hidden="true">
                <Icon name={w.icon} size={20} />
              </span>
              <span className="who-card__text">
                <span className="who-card__label">{tx(w.label)}</span>
                <span className="who-card__hint">{tx(w.hint)}</span>
              </span>
              <span className="who-card__check" aria-hidden="true">
                <Icon name="check" size={14} />
              </span>
            </label>
          )
        })}
      </div>

      {value.who === 'families' && (
        <div className="audience__filters">
          <ChipGroup label={tx(S.plan)}>
            <AnyChip active={value.planMonths.length === 0} onClick={() => onChange({ ...value, planMonths: [] })} />
            {PLAN_MONTHS.map((m) => (
              <Chip
                key={m}
                pressed={value.planMonths.includes(m)}
                onClick={() => onChange({ ...value, planMonths: toggle(value.planMonths, m) as number[] })}
                label={tx(PLAN_LABEL[m]!)}
                count={planCount(m)}
              />
            ))}
          </ChipGroup>

          <ChipGroup label={tx(S.children)}>
            <AnyChip active={value.children.length === 0} onClick={() => onChange({ ...value, children: [] })} />
            {CHILD_BUCKETS.map((b) => (
              <Chip
                key={b}
                pressed={value.children.includes(b)}
                onClick={() => onChange({ ...value, children: toggle(value.children, b) as number[] })}
                label={tx(CHILDREN_LABEL[b]!)}
                count={childCount(b)}
              />
            ))}
          </ChipGroup>

          <ChipGroup label={tx(S.country)}>
            <AnyChip active={value.countries.length === 0} onClick={() => onChange({ ...value, countries: [] })} />
            {offeredCountries.map((c) => (
              <Chip
                key={c}
                pressed={value.countries.includes(c)}
                onClick={() => onChange({ ...value, countries: toggle(value.countries, c) as string[] })}
                label={`${flagOf(c)} ${countryName(c)}`}
                count={facts ? countryFacts(c) : undefined}
              />
            ))}
            <label className="add-country">
              <span className="sr-only">{tx(S.addCountry)}</span>
              <Icon name="plus" size={14} />
              <select
                className="add-country__select"
                value=""
                aria-label={tx(S.addCountry)}
                onChange={(e) => {
                  const c = e.target.value
                  if (c) onChange({ ...value, countries: [...value.countries, c] })
                }}
              >
                <option value="">{tx(S.addCountry)}</option>
                {addable.suggested.map((c) => (
                  <option key={c} value={c}>{`${flagOf(c)} ${countryName(c)}`}</option>
                ))}
                {addable.suggested.length > 0 && <option disabled>──────────</option>}
                {addable.rest.map(([c, name]) => (
                  <option key={c} value={c}>{`${flagOf(c)} ${name}`}</option>
                ))}
              </select>
            </label>
          </ChipGroup>

          <p className="field__hint">{tx(S.filtersHint)}</p>

          {facts && (value.countries.length > 0 || value.planMonths.length > 0) && (
            <MissingData
              facts={facts}
              country={value.countries.length > 0}
              plan={value.planMonths.length > 0}
              dataPath={dataPath}
              format={(n, what) => fill(tx(S.missingNote), { n: number(n), what })}
            />
          )}
        </div>
      )}
    </div>
  )
}

function MissingData({
  facts,
  country,
  plan,
  dataPath,
  format,
}: {
  facts: AudienceFacts
  country: boolean
  plan: boolean
  dataPath: string | null
  format: (n: number, what: string) => string
}) {
  const tx = useText()
  const notes: string[] = []
  if (country && facts.unknownCountry > 0) notes.push(format(facts.unknownCountry, tx(S.country).toLowerCase()))
  if (plan && facts.unknownPlan > 0) notes.push(format(facts.unknownPlan, tx(S.plan).toLowerCase()))
  if (notes.length === 0) return null
  return (
    <div className="audience__missing" role="note">
      <Icon name="info" size={16} />
      <span>
        {notes.join(' ')}{' '}
        {dataPath && <Link to={dataPath}>{tx(S.fillIn)}</Link>}
      </span>
    </div>
  )
}

function ChipGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="chip-group" role="group" aria-label={label}>
      <span className="chip-group__label">{label}</span>
      <div className="chip-group__chips">{children}</div>
    </div>
  )
}

function AnyChip({ active, onClick }: { active: boolean; onClick: () => void }) {
  const tx = useText()
  return (
    <button type="button" className="seg-chip seg-chip--any" aria-pressed={active} onClick={onClick}>
      {tx(S.anyValue)}
    </button>
  )
}

function Chip({
  pressed,
  onClick,
  label,
  count,
}: {
  pressed: boolean
  onClick: () => void
  label: string
  count?: number
}) {
  const { number } = useI18n()
  return (
    <button type="button" className="seg-chip" aria-pressed={pressed} onClick={onClick}>
      {pressed && <Icon name="check" size={13} />}
      <span>{label}</span>
      {count !== undefined && <span className="seg-chip__count">{number(count)}</span>}
    </button>
  )
}
