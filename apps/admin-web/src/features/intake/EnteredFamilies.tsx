import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Badge } from '@/shared/components/Badge'
import { EmptyState } from '@/shared/components/States'
import { FilterChips, type FilterOption } from '@/shared/components/FilterChips'
import { parentPath } from '@/features/profiles/api'
import { formatWhen } from '@/features/trials/copy'
import { useCopy } from './copy'
import { OP } from './opsCopy'
import { useEnteredFamilies } from './hooks'
import { SupervisorDialog } from './OpsDialogs'
import type { EnteredFamily, EnteredList } from './api'

type Filter = 'all' | 'needs' | 'waiting' | 'signed_up' | 'recent'

const RECENT_DAYS = 14
const MANAGERS = new Set(['operations_manager', 'sales_manager', 'super_admin'])

function matches(f: EnteredFamily, filter: Filter, now: number): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'needs':
      return f.needsOperationsSupervisor
    case 'waiting':
      return f.parentSignup.state !== 'signed_up'
    case 'signed_up':
      return f.parentSignup.state === 'signed_up'
    case 'recent':
      return now - Date.parse(f.enteredAt) <= RECENT_DAYS * 24 * 60 * 60 * 1000
  }
}

/**
 * PD-42 PR-3: New Students' families entered by hand (plan §10.3) -- who
 * entered them and when, who owns them, who is still waiting for an
 * Operations supervisor, and the parent's sign-up. Shown only when the server
 * answers; a viewer it refuses sees nothing here.
 */
export function EnteredFamilies() {
  const q = useEnteredFamilies()
  if (!q.data) return null
  return <EnteredFamiliesList data={q.data} />
}

function EnteredFamiliesList({ data }: { data: EnteredList }) {
  const tx = useCopy()
  const { number } = useI18n()
  const [filter, setFilter] = useState<Filter>('all')
  const [now] = useState(() => Date.now())
  const filters: Filter[] = ['all', 'needs', 'waiting', 'signed_up', ...(MANAGERS.has(data.viewer) ? (['recent'] as const) : [])]
  const label: Record<Filter, string> = {
    all: tx(OP.all), needs: tx(OP.needs), waiting: tx(OP.waiting), signed_up: tx(OP.signedUp), recent: tx(OP.recent),
  }
  const options: Array<FilterOption<Filter>> = filters.map((f) => ({
    value: f, label: label[f], count: data.families.filter((x) => matches(x, f, now)).length,
  }))
  const shown = data.families.filter((x) => matches(x, filter, now))
  return (
    <section className="ns-entered" aria-labelledby="ns-entered-title">
      <h2 id="ns-entered-title" className="ns-entered__title">{tx(OP.enteredTitle)}</h2>
      <p className="field__hint">{tx(OP.enteredHint)}</p>
      {data.families.length > 0 && (
        <div className="ns-toolbar">
          <FilterChips options={options} value={filter} onChange={setFilter} label={tx(OP.filterLabel)} formatCount={(n) => number(n)} />
        </div>
      )}
      {shown.length === 0 ? (
        <EmptyState title={tx(OP.noneHere)} />
      ) : (
        <div className="ns-list">
          {shown.map((f) => (
            <EnteredCard key={f.enrolmentId} f={f} canAssign={data.canAssignSupervisor} canSuggest={f.canSuggestSupervisor === true} />
          ))}
        </div>
      )}
    </section>
  )
}

function EnteredCard({ f, canAssign, canSuggest }: { f: EnteredFamily; canAssign: boolean; canSuggest: boolean }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const [dialog, setDialog] = useState<'assign' | 'suggest' | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const headingId = `ns-e-${f.enrolmentId}`
  const signup = f.parentSignup
  return (
    <article className="card ns-card" aria-labelledby={headingId}>
      <header className="ns-card__head">
        <div className="ns-card__who">
          <div className="ns-card__title-row">
            <h3 id={headingId} className="ns-card__title" dir="auto">{f.parentName ?? '—'}</h3>
            {f.kind === 'added_children' && <Badge tone="info">{tx(OP.childAdded)}</Badge>}
            {f.needsOperationsSupervisor && <Badge tone="waiting" dot>{tx(OP.needs)}</Badge>}
          </div>
          <p className="ns-card__byline">
            {tx(OP.enteredBy)} {f.enteredBy.name ?? '—'} · <time dateTime={f.enteredAt}>{formatWhen(f.enteredAt, locale)}</time>
          </p>
        </div>
        <div className="ns-card__actions">
          {f.needsOperationsSupervisor && canAssign && (
            <button type="button" className="btn btn--sm btn--primary" onClick={() => setDialog('assign')}>{tx(OP.choose)}</button>
          )}
          {f.needsOperationsSupervisor && !canAssign && canSuggest && (
            <button type="button" className="btn btn--sm" onClick={() => setDialog('suggest')}>{tx(OP.suggest)}</button>
          )}
          <Link className="btn btn--sm btn--ghost" to={parentPath(f.contactId)}>{tx(OP.openParent)}</Link>
        </div>
      </header>
      <dl className="ns-pairs">
        <div>
          <dt>{tx(OP.children)}</dt>
          <dd>
            <ul className="ns-slots">
              {f.children.map((c) => (
                <li key={c.id} dir="auto">{c.name ?? '—'}</li>
              ))}
            </ul>
          </dd>
        </div>
        <div>
          <dt>{tx(OP.supervisor)}</dt>
          <dd>
            {f.supervisor ? <span dir="auto">{f.supervisor.name}</span> : !f.needsOperationsSupervisor ? <span className="ts-muted">{tx(OP.none)}</span> : null}
            {f.needsOperationsSupervisor && f.suggestion && (
              <span className="ts-muted ns-note"> {tx(OP.suggested)} <bdi>{f.suggestion.name}</bdi></span>
            )}
          </dd>
        </div>
        <div>
          <dt>{tx(OP.salesOwner)}</dt>
          <dd>{f.salesOwner ? <span dir="auto">{f.salesOwner.name}</span> : <span className="ts-muted">{tx(OP.none)}</span>}</dd>
        </div>
        <div>
          <dt>{tx(OP.signIn)}</dt>
          <dd>
            {signup.state === 'signed_up' && <Badge tone="ok">{tx(OP.signedUp)}</Badge>}
            {signup.state === 'no_email' && <span className="ts-muted">{tx(OP.noEmail)}</span>}
            {signup.state === 'not_started' && <span className="ts-muted">{tx(OP.notStarted)}</span>}
            {signup.state === 'code_waiting' && (
              <span className="ns-code">
                <span className="ns-note">{tx(OP.codeWaiting)}</span>
                {signup.code && <strong className="ns-code__value" dir="ltr">{signup.code}</strong>}
              </span>
            )}
          </dd>
        </div>
      </dl>
      {done && <p className="banner banner--info" role="status">{done}</p>}
      {dialog && (
        <SupervisorDialog
          mode={dialog}
          familyId={f.familyId}
          name={f.parentName}
          suggestedId={f.suggestion?.id ?? null}
          onClose={() => setDialog(null)}
          onDone={(m) => {
            setDialog(null)
            setDone(m)
          }}
        />
      )}
    </article>
  )
}
