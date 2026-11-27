import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Badge } from '@/shared/components/Badge'
import type { MenuItem } from '@/shared/components/Menu'
import { RowActions } from '@/shared/components/RowActions'
import { EmptyState } from '@/shared/components/States'
import { FilterChips, type FilterOption } from '@/shared/components/FilterChips'
import { parentPath } from '@/features/profiles/api'
import { formatWhen } from '@/features/trials/copy'
import { useCopy } from './copy'
import { OP } from './opsCopy'
import { useEnteredFamilies } from './hooks'
import { SupervisorDialog } from './OpsDialogs'
import type { EnteredFamily, EnteredList } from './api'
import './entered-families.css'

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
 *
 * Its own headed sheet under the board: the filter belongs to the sheet, and
 * each family is one row with the one thing it needs.
 */
export function EnteredFamilies() {
  const q = useEnteredFamilies()
  // With none entered there is nothing to head: the page's own empty line says where families come from.
  if (!q.data || q.data.families.length === 0) return null
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
    <section className="sheet ef" aria-labelledby="ns-entered-title">
      <header className="sheet__head">
        <h2 className="sheet__title" title={tx(OP.enteredHint)}>
          <span id="ns-entered-title">{tx(OP.enteredTitle)}</span>
          <span className="sheet__count">{number(data.families.length)}</span>
        </h2>
      </header>
      <div className="sheet-bar">
        <FilterChips options={options} value={filter} onChange={setFilter} label={tx(OP.filterLabel)} formatCount={(n) => number(n)} />
      </div>
      {shown.length === 0 ? (
        <EmptyState title={tx(OP.noneHere)} compact />
      ) : (
        <div className="ef__rows">
          {/* The columns' names, once, where there is room for columns; each row carries its own labels for a screen reader. */}
          <div className="ef__cols" aria-hidden="true">
            <span>{tx(OP.family)}</span>
            <span>{tx(OP.supervisor)}</span>
            <span>{tx(OP.salesOwner)}</span>
            <span>{tx(OP.signIn)}</span>
            <span />
          </div>
          {shown.map((f) => (
            <EnteredRow key={f.enrolmentId} f={f} canAssign={data.canAssignSupervisor} canSuggest={f.canSuggestSupervisor === true} />
          ))}
        </div>
      )}
    </section>
  )
}

/** One entered family: who and since when, who owns it, where the parent's sign-in stands, and its one action. */
function EnteredRow({ f, canAssign, canSuggest }: { f: EnteredFamily; canAssign: boolean; canSuggest: boolean }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const navigate = useNavigate()
  const [dialog, setDialog] = useState<'assign' | 'suggest' | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const headingId = `ns-e-${f.enrolmentId}`
  const signup = f.parentSignup
  const name = f.parentName ?? '—'
  // What the family needs first is its action; with nothing to decide, the row leads to the parent's file.
  const act = f.needsOperationsSupervisor && canAssign ? 'assign' : f.needsOperationsSupervisor && canSuggest ? 'suggest' : null
  const more: MenuItem[] = [
    ...(act ? [{ key: 'parent', label: tx(OP.openParent), icon: 'user' as const, onSelect: () => navigate(parentPath(f.contactId)) }] : []),
    ...(f.groupConversationId
      ? [{ key: 'group', label: tx(OP.openGroup), icon: 'conversations' as const, onSelect: () => navigate(`/chat/${encodeURIComponent(f.groupConversationId!)}`) }]
      : []),
  ]
  return (
    <article className="ef-row" aria-labelledby={headingId}>
      <div className="ef-row__who">
        <div className="ef-row__title">
          <h3 id={headingId} className="ef-row__name"><bdi>{name}</bdi></h3>
          {f.kind === 'added_children' && <Badge tone="info">{tx(OP.childAdded)}</Badge>}
          {f.needsOperationsSupervisor && <Badge tone="gold">{tx(OP.needs)}</Badge>}
        </div>
        <ul className="ef-row__children" aria-label={tx(OP.children)}>
          {f.children.map((c) => (
            <li key={c.id}><bdi>{c.name ?? '—'}</bdi></li>
          ))}
        </ul>
        <p className="ef-row__byline">
          {tx(OP.enteredBy)} {f.enteredBy.name ?? '—'} · <time dateTime={f.enteredAt}>{formatWhen(f.enteredAt, locale)}</time>
        </p>
      </div>
      <dl className="ef-row__facts">
        <div>
          <dt>{tx(OP.supervisor)}</dt>
          <dd>
            {f.supervisor ? <bdi>{f.supervisor.name}</bdi> : !f.needsOperationsSupervisor ? <span className="ts-muted">{tx(OP.none)}</span> : null}
            {f.needsOperationsSupervisor && f.suggestion && (
              <span className="ts-muted ef-row__note"> {tx(OP.suggested)} <bdi>{f.suggestion.name}</bdi></span>
            )}
            {f.needsOperationsSupervisor && !f.supervisor && !f.suggestion && <span className="ts-muted">—</span>}
          </dd>
        </div>
        <div>
          <dt>{tx(OP.salesOwner)}</dt>
          <dd>{f.salesOwner ? <bdi>{f.salesOwner.name}</bdi> : <span className="ts-muted">{tx(OP.none)}</span>}</dd>
        </div>
        <div>
          <dt>{tx(OP.signIn)}</dt>
          <dd>
            {signup.state === 'signed_up' && <Badge tone="ok">{tx(OP.signedUp)}</Badge>}
            {signup.state === 'no_email' && <span className="ts-muted">{tx(OP.noEmail)}</span>}
            {signup.state === 'not_started' && <span className="ts-muted">{tx(OP.notStarted)}</span>}
            {signup.state === 'code_waiting' && (
              <span className="ef-row__code">
                <span>{tx(OP.codeWaiting)}</span>
                {signup.code && <strong className="ef-row__code-value" dir="ltr">{signup.code}</strong>}
              </span>
            )}
          </dd>
        </div>
      </dl>
      <div className="ef-row__actions">
        <RowActions
          label={`${tx(OP.moreActions)}: ${name}`}
          primary={
            act === 'assign' ? (
              <button type="button" className="btn btn--sm" onClick={() => setDialog('assign')}>{tx(OP.choose)}</button>
            ) : act === 'suggest' ? (
              <button type="button" className="btn btn--sm" onClick={() => setDialog('suggest')}>{tx(OP.suggest)}</button>
            ) : (
              <Link className="btn btn--sm" to={parentPath(f.contactId)}>{tx(OP.openParent)}</Link>
            )
          }
          more={more}
        />
      </div>
      {done && <p className="banner banner--info ef-row__done" role="status">{done}</p>}
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
