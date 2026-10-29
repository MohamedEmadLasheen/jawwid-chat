import { useMemo, useState } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Icon } from '@/shared/components/Icon'
import { SearchField } from '@/shared/components/SearchField'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import { useText } from '@/features/admin/copy'
import { PLAN_MONTHS, type FamilyAudienceRow } from './api'
import { allCountryCodes, flagOf, PLAN_LABEL, S, SUGGESTED_COUNTRIES, useCountryName } from './copy'
import { useAudienceFacts, useFamilyAudienceData, useSetFamilyAudienceData } from './hooks'
import { SearchableSelect } from '@/shared/components/SearchableSelect'

/**
 * Each family's country and subscription plan -- the two facts targeting
 * reads that Chat does not own. Jawwid Core will write them; until it does,
 * the super admin and managers set them here, one change at a time, each one
 * audited server-side. Number of children is shown, never edited: it is
 * counted from the family's children.
 */
export function AudienceDataPanel() {
  const tx = useText()
  const { number } = useI18n()
  const [search, setSearch] = useState('')
  const [missing, setMissing] = useState(false)
  const query = useFamilyAudienceData({ search, missing })
  const facts = useAudienceFacts()
  const rows = query.data?.families ?? []
  const countries = useCountryOptions()

  return (
    <div className="audience-data">
      <div className="audience-data__intro" role="note">
        <Icon name="info" size={18} />
        <p>{tx(S.audienceDataIntro)}</p>
      </div>

      {facts.data && (
        <section className="kpi-strip kpi-strip--compact" aria-label={tx(S.tabAudience)}>
          <div className="kpi">
            <span className="kpi__label">{tx(S.family)}</span>
            <span className="kpi__value">{number(facts.data.families)}</span>
          </div>
          <div className="kpi">
            <span className="kpi__label">{`${tx(S.country)} · ${tx(S.notSet)}`}</span>
            <span className="kpi__value">{number(facts.data.unknownCountry)}</span>
          </div>
          <div className="kpi">
            <span className="kpi__label">{`${tx(S.plan)} · ${tx(S.notSet)}`}</span>
            <span className="kpi__value">{number(facts.data.unknownPlan)}</span>
          </div>
        </section>
      )}

      <div className="toolbar">
        <SearchField value={search} onChange={setSearch} label={tx(S.searchFamilies)} clearLabel={tx(S.clearSearch)} />
        <div className="toolbar__end">
          <button
            type="button"
            className="seg-chip"
            aria-pressed={missing}
            onClick={() => setMissing((m) => !m)}
          >
            {missing && <Icon name="check" size={13} />}
            {tx(S.onlyMissing)}
          </button>
        </div>
      </div>

      <QueryBoundary isLoading={query.isLoading} error={query.error} onRetry={() => void query.refetch()}>
        {rows.length === 0 ? (
          <div className="table-wrap">
            <EmptyState compact icon="search" title={tx(S.noFamilies)} />
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table audience-table">
              <thead>
                <tr>
                  <th>{tx(S.family)}</th>
                  <th>{tx(S.country)}</th>
                  <th>{tx(S.plan)}</th>
                  <th className="col-num">{tx(S.childCount)}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((f) => (
                  <FamilyRow key={f.id} family={f} countries={countries} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        {query.data?.truncated && <p className="list-footnote">{tx(S.truncatedFamilies)}</p>}
      </QueryBoundary>
    </div>
  )
}

interface CountryOptions {
  suggested: ReadonlyArray<readonly [string, string]>
  rest: ReadonlyArray<readonly [string, string]>
}

/** Built once per locale for the whole table, never per row. */
function useCountryOptions(): CountryOptions {
  const countryName = useCountryName()
  return useMemo(() => {
    const suggested = SUGGESTED_COUNTRIES as readonly string[]
    return {
      suggested: suggested.map((c) => [c, countryName(c)] as const),
      rest: allCountryCodes()
        .filter((c) => !suggested.includes(c))
        .map((c) => [c, countryName(c)] as const)
        .filter(([c, name]) => name !== c)
        .sort((a, b) => a[1].localeCompare(b[1])),
    }
  }, [countryName])
}

function FamilyRow({ family: f, countries }: { family: FamilyAudienceRow; countries: CountryOptions }) {
  const tx = useText()
  const { number } = useI18n()
  const save = useSetFamilyAudienceData()
  const [saved, setSaved] = useState(false)

  const commit = (input: { countryCode?: string | null; subscriptionPlanMonths?: number | null }) => {
    setSaved(false)
    save.mutate({ id: f.id, input }, { onSuccess: () => setSaved(true) })
  }

  return (
    <tr>
      <td>
        <span className="audience-table__name" dir="auto">{f.displayName}</span>
        {f.segmentSource === 'core' && <span className="audience-table__source">{tx(S.fromCore)}</span>}
        {saved && !save.isPending && (
          <span className="audience-table__saved" role="status">
            <Icon name="check" size={12} /> {tx(S.saved)}
          </span>
        )}
        {save.error && <span className="field__error" role="alert">{(save.error as Error).message}</span>}
      </td>
      <td>
        <SearchableSelect
          className="select select--sm"
          value={f.countryCode ?? ''}
          disabled={save.isPending}
          aria-label={`${tx(S.country)}: ${f.displayName}`}
          onValueChange={(v) => commit({ countryCode: v || null })}
        >
          <option value="">{tx(S.notSet)}</option>
          {countries.suggested.map(([c, name]) => (
            <option key={c} value={c}>{`${flagOf(c)} ${name}`}</option>
          ))}
          <option disabled>──────────</option>
          {countries.rest.map(([c, name]) => (
            <option key={c} value={c}>{`${flagOf(c)} ${name}`}</option>
          ))}
        </SearchableSelect>
      </td>
      <td>
        <SearchableSelect
          className="select select--sm"
          value={f.subscriptionPlanMonths ?? ''}
          disabled={save.isPending}
          aria-label={`${tx(S.plan)}: ${f.displayName}`}
          onValueChange={(v) => commit({ subscriptionPlanMonths: v ? Number(v) : null })}
        >
          <option value="">{tx(S.notSet)}</option>
          {PLAN_MONTHS.map((m) => (
            <option key={m} value={m}>{tx(PLAN_LABEL[m]!)}</option>
          ))}
        </SearchableSelect>
      </td>
      <td className="col-num">{number(f.childCount)}</td>
    </tr>
  )
}
