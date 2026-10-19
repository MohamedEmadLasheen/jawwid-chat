import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Badge, type Tone } from '@/shared/components/Badge'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import { Icon } from '@/shared/components/Icon'
import { PageHeader } from '@/shared/components/PageHeader'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import { fill, useText } from '@/features/admin/copy'
import { useDocumentTitle } from '@/features/admin/common'
import type { StoryAnalytics, StudioStory } from './api'
import { CTA_DEFAULT_TEXT, CTA_LABEL, KIND_LABEL, S, STATE_LABEL, flagOf, useCountryName } from './copy'
import { useDeleteStory, usePublishStory, useStoryAnalytics, useStoryViewers, useStudioStory } from './hooks'
import { effectiveState, storyName, useAudienceSummary } from './StoriesStudio'
import { StoryPreview } from './StoryPreview'
import './stories.css'

const STATE_TONE: Record<string, Tone> = { published: 'ok', draft: 'neutral', expired: 'outline', deleted: 'danger' }

/**
 * One story's dedicated performance page: how many it reached, how many
 * opened it, how many acted on its button -- as numbers, as a funnel, by day,
 * by audience and by country -- and, on request, who.
 */
export function StoryInsights({ basePath }: { basePath: string }) {
  const { storyId } = useParams<{ storyId: string }>()
  const tx = useText()
  const story = useStudioStory(storyId)
  const analytics = useStoryAnalytics(storyId)
  useDocumentTitle(story.data ? storyName(story.data, tx(S.untitled)) : tx(S.insights))

  return (
    <div className="page stories-studio">
      <div className="page__inner">
        <Link to={basePath} className="back-link">
          <Icon name="arrowBack" size={16} />
          {tx(S.back)}
        </Link>
        <QueryBoundary isLoading={story.isLoading} error={story.error} onRetry={() => void story.refetch()}>
          {story.data && <InsightsBody story={story.data} analytics={analytics.data} analyticsError={analytics.error as Error | null} basePath={basePath} />}
        </QueryBoundary>
      </div>
    </div>
  )
}

function InsightsBody({
  story: s,
  analytics: a,
  analyticsError,
  basePath,
}: {
  story: StudioStory
  analytics: StoryAnalytics | undefined
  analyticsError: Error | null
  basePath: string
}) {
  const tx = useText()
  const { number, dateTime } = useI18n()
  const navigate = useNavigate()
  const summary = useAudienceSummary()
  const publish = usePublishStory()
  const [deleting, setDeleting] = useState(false)
  const [showPeople, setShowPeople] = useState(false)
  const state = effectiveState(s)
  const pct = (r: number | null | undefined) => (r == null ? '—' : fill(tx(S.pct), { n: number(Math.round(r * 100)) }))

  return (
    <>
      <PageHeader
        title={storyName(s, tx(S.untitled))}
        status={<Badge tone={STATE_TONE[state] ?? 'neutral'} dot>{tx(STATE_LABEL[state])}</Badge>}
        subtitle={summary(s)}
        actions={
          <>
            {s.state === 'draft' && (
              <button type="button" className="btn btn--primary" disabled={publish.isPending} onClick={() => publish.mutate(s.id)}>
                <Icon name="send" size={16} />
                {tx(S.publishNow)}
              </button>
            )}
            {s.state !== 'deleted' && (
              <button type="button" className="btn btn--ghost" onClick={() => setDeleting(true)}>
                <Icon name="trash" size={16} />
                {tx(S.delete)}
              </button>
            )}
          </>
        }
      />
      {publish.error && <p className="field__error" role="alert">{(publish.error as Error).message}</p>}

      <div className="insights">
        <aside className="insights__aside">
          <StoryPreview
            story={{
              kind: s.kind,
              body: s.kind === 'text' ? s.body : null,
              background: s.background,
              mediaUrl: s.mediaUrl,
              mediaDurationMs: s.mediaDurationMs,
              cta: s.cta ? { kind: s.cta.kind, label: s.cta.label } : null,
            }}
          />
          <dl className="details-list">
            <div><dt>{tx(S.storyType)}</dt><dd>{tx(KIND_LABEL[s.kind])}</dd></div>
            <div>
              <dt>{tx(S.button)}</dt>
              <dd>
                {s.cta ? (
                  <>
                    {tx(CTA_LABEL[s.cta.kind])} · <span dir="auto">{s.cta.label || tx(CTA_DEFAULT_TEXT[s.cta.kind])}</span>
                    {s.cta.url && (
                      <a className="details-list__link" href={s.cta.url} target="_blank" rel="noreferrer noopener" dir="ltr">
                        {s.cta.phone ? `+${s.cta.phone}` : s.cta.url}
                      </a>
                    )}
                  </>
                ) : (
                  tx(S.noButton)
                )}
              </dd>
            </div>
            <div><dt>{tx(S.colAudience)}</dt><dd>{summary(s)}</dd></div>
            <div><dt>{tx(S.createdBy)}</dt><dd>{s.creatorName}</dd></div>
            {s.publishedAt && (
              <div>
                <dt>{tx(S.publishedOn)}</dt>
                <dd>
                  {dateTime(s.publishedAt)}
                  {!s.expiresAt && state === 'published' && <span className="details-list__note">{tx(S.neverExpires)}</span>}
                </dd>
              </div>
            )}
          </dl>
        </aside>

        <div className="insights__main">
          {s.state === 'draft' ? (
            <div className="card">
              <EmptyState compact icon="chart" title={tx(S.notPublished)} />
            </div>
          ) : analyticsError ? (
            <p className="field__error" role="alert">{analyticsError.message}</p>
          ) : !a ? (
            <div className="kpi-strip kpi-strip--loading" aria-busy="true" />
          ) : (
            <>
              <section className="kpi-strip" aria-label={tx(S.insights)}>
                <Kpi label={tx(S.reached)} value={number(a.reach.total)} />
                <Kpi label={tx(S.viewed)} value={number(a.views.total)} sub={fill(tx(S.ofReach), { pct: pct(a.rates.view) })} />
                <Kpi
                  label={tx(S.tapped)}
                  value={a.cta.kind ? number(a.cta.tappers) : '—'}
                  sub={a.cta.kind ? fill(tx(S.ofViews), { pct: pct(a.rates.tapOfViews) }) : tx(S.noButton)}
                />
                <Kpi label={tx(S.totalTapsLabel)} value={a.cta.kind ? number(a.cta.taps) : '—'} />
              </section>

              <section className="card insight-card">
                <h2 className="card__title card__title--sm">{tx(S.funnel)}</h2>
                <Funnel
                  steps={[
                    { label: tx(S.reached), value: a.reach.total },
                    { label: tx(S.viewed), value: a.views.total },
                    ...(a.cta.kind ? [{ label: tx(S.tapped), value: a.cta.tappers }] : []),
                  ]}
                />
              </section>

              <section className="card insight-card">
                <h2 className="card__title card__title--sm">{tx(S.overTime)}</h2>
                <DailyChart daily={a.daily} showTaps={Boolean(a.cta.kind)} />
                {(a.firstViewAt || a.lastViewAt) && (
                  <p className="insight-card__foot">
                    {a.firstViewAt && <span>{tx(S.firstView)}: {dateTime(a.firstViewAt)}</span>}
                    {a.lastViewAt && <span>{tx(S.lastView)}: {dateTime(a.lastViewAt)}</span>}
                  </p>
                )}
              </section>

              <div className="insight-grid">
                <section className="card insight-card">
                  <h2 className="card__title card__title--sm">{tx(S.byAudience)}</h2>
                  <Breakdown
                    rows={[
                      ...(a.reach.contacts > 0 ? [{ key: 'p', label: tx(S.parents), reach: a.reach.contacts, views: a.views.contacts }] : []),
                      ...(a.reach.teachers > 0 ? [{ key: 't', label: tx(S.teachers), reach: a.reach.teachers, views: a.views.teachers }] : []),
                    ]}
                  />
                </section>
                {a.byCountry.length > 0 && (
                  <section className="card insight-card">
                    <h2 className="card__title card__title--sm">{tx(S.byCountry)}</h2>
                    <CountryBreakdown rows={a.byCountry} />
                  </section>
                )}
              </div>

              <section className="card insight-card">
                <div className="card__header card__header--tight">
                  <h2 className="card__title card__title--sm">{tx(S.people)}</h2>
                  {!showPeople && (
                    <button type="button" className="btn btn--sm" onClick={() => setShowPeople(true)}>
                      <Icon name="eye" size={16} />
                      {tx(S.people)}
                    </button>
                  )}
                </div>
                {showPeople && <PeopleList storyId={s.id} hasCta={Boolean(s.cta)} />}
              </section>
            </>
          )}
        </div>
      </div>

      {deleting && (
        <DeleteDialog
          storyId={s.id}
          onClose={() => setDeleting(false)}
          onDeleted={() => navigate(basePath)}
        />
      )}
    </>
  )
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="kpi">
      <span className="kpi__label">{label}</span>
      <span className="kpi__value">{value}</span>
      {sub && <span className="kpi__sub">{sub}</span>}
    </div>
  )
}

/** Each step as a bar against the first, so the drop-off is visible at a glance. */
function Funnel({ steps }: { steps: Array<{ label: string; value: number }> }) {
  const tx = useText()
  const { number } = useI18n()
  const base = steps[0]?.value ?? 0
  return (
    <ol className="funnel">
      {steps.map((st) => {
        const ratio = base > 0 ? st.value / base : 0
        return (
          <li key={st.label} className="funnel__step">
            <span className="funnel__label">{st.label}</span>
            <span className="funnel__track" aria-hidden="true">
              <span className="funnel__fill" style={{ inlineSize: `${Math.max(ratio * 100, st.value > 0 ? 2 : 0)}%` }} />
            </span>
            <span className="funnel__value">
              {number(st.value)}
              {base > 0 && <small> · {fill(tx(S.pct), { n: number(Math.round(ratio * 100)) })}</small>}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

/**
 * Views (teal) and taps (gold) per day. The bars are decoration; the same
 * numbers are in a table for anyone who cannot see them.
 */
function DailyChart({ daily, showTaps }: { daily: StoryAnalytics['daily']; showTaps: boolean }) {
  const tx = useText()
  const { number, locale } = useI18n()
  const days = daily.slice(-30)
  const max = Math.max(1, ...days.map((d) => Math.max(d.views, showTaps ? d.taps : 0)))
  const fmt = (iso: string) =>
    new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
      new Date(`${iso}T00:00:00Z`),
    )
  return (
    <div className="daily">
      <div className="daily__legend" aria-hidden="true">
        <span className="daily__key daily__key--views">{tx(S.totalViews)}</span>
        {showTaps && <span className="daily__key daily__key--taps">{tx(S.totalTaps)}</span>}
      </div>
      <div className="daily__bars" aria-hidden="true" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
        {days.map((d) => (
          <div key={d.date} className="daily__day" title={`${fmt(d.date)} · ${d.views} / ${d.taps}`}>
            <span className="daily__bar daily__bar--views" style={{ blockSize: `${(d.views / max) * 100}%` }} />
            {showTaps && <span className="daily__bar daily__bar--taps" style={{ blockSize: `${(d.taps / max) * 100}%` }} />}
          </div>
        ))}
      </div>
      <div className="daily__axis" aria-hidden="true">
        <span>{days[0] && fmt(days[0].date)}</span>
        <span>{days.length > 1 && fmt(days[days.length - 1]!.date)}</span>
      </div>
      <table className="sr-only">
        <caption>{tx(S.overTime)}</caption>
        <thead>
          <tr>
            <th>{tx(S.dayAxis)}</th>
            <th>{tx(S.totalViews)}</th>
            {showTaps && <th>{tx(S.totalTaps)}</th>}
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={d.date}>
              <td>{fmt(d.date)}</td>
              <td>{number(d.views)}</td>
              {showTaps && <td>{number(d.taps)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Breakdown({ rows }: { rows: Array<{ key: string; label: string; reach: number; views: number }> }) {
  const tx = useText()
  const { number } = useI18n()
  return (
    <table className="table table--compact">
      <thead>
        <tr>
          <th>{tx(S.colAudience)}</th>
          <th className="col-num">{tx(S.reached)}</th>
          <th className="col-num">{tx(S.viewed)}</th>
          <th className="col-num">{fill(tx(S.pct), { n: '' }).trim()}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <td>{r.label}</td>
            <td className="col-num">{number(r.reach)}</td>
            <td className="col-num">{number(r.views)}</td>
            <td className="col-num">{r.reach > 0 ? number(Math.round((r.views / r.reach) * 100)) : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function CountryBreakdown({ rows }: { rows: StoryAnalytics['byCountry'] }) {
  const tx = useText()
  const { number } = useI18n()
  const countryName = useCountryName()
  return (
    <table className="table table--compact">
      <thead>
        <tr>
          <th>{tx(S.country)}</th>
          <th className="col-num">{tx(S.reached)}</th>
          <th className="col-num">{tx(S.viewed)}</th>
          <th className="col-num">{tx(S.tapped)}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.code ?? 'none'}>
            <td>{r.code ? `${flagOf(r.code)} ${countryName(r.code)}` : <span className="cell-muted">{tx(S.notSet)}</span>}</td>
            <td className="col-num">{number(r.reach)}</td>
            <td className="col-num">{number(r.views)}</td>
            <td className="col-num">{number(r.tappers)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** Names and times only: the server returns no phone or email, so none can appear. */
function PeopleList({ storyId, hasCta }: { storyId: string; hasCta: boolean }) {
  const tx = useText()
  const { number, dateTime } = useI18n()
  const viewers = useStoryViewers(storyId, true)
  return (
    <QueryBoundary
      isLoading={viewers.isLoading}
      error={viewers.error}
      onRetry={() => void viewers.refetch()}
      isEmpty={(viewers.data ?? []).length === 0}
      emptyTitle={tx(S.noViewersYet)}
    >
      <table className="table table--compact">
        <thead>
          <tr>
            <th>{tx(S.people)}</th>
            <th>{tx(S.viewedAt)}</th>
            {hasCta && <th className="col-num">{tx(S.totalTaps)}</th>}
          </tr>
        </thead>
        <tbody>
          {(viewers.data ?? []).map((v) => (
            <tr key={v.actorId}>
              <td>
                <span dir="auto">{v.displayName}</span>{' '}
                <span className="cell-muted">· {v.actorKind === 'teacher' ? tx(S.teachers) : tx(S.parents)}</span>
              </td>
              <td className="cell-nowrap">{dateTime(v.viewedAt)}</td>
              {hasCta && <td className="col-num">{number(v.ctaTaps)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </QueryBoundary>
  )
}

/** Deleting needs a reason: the server requires one and keeps it in the audit log. */
function DeleteDialog({ storyId, onClose, onDeleted }: { storyId: string; onClose: () => void; onDeleted: () => void }) {
  const tx = useText()
  const remove = useDeleteStory()
  const [reason, setReason] = useState('')
  return (
    <Dialog
      title={tx(S.deleteTitle)}
      onClose={onClose}
      footer={
        <>
          <DialogCancelButton onClick={onClose} />
          <button
            type="button"
            className="btn btn--danger"
            disabled={reason.trim().length === 0 || remove.isPending}
            onClick={() => remove.mutate({ id: storyId, reason: reason.trim() }, { onSuccess: onDeleted })}
          >
            {tx(S.delete)}
          </button>
        </>
      }
    >
      <p>{tx(S.deleteBody)}</p>
      <div className="field">
        <label className="field__label" htmlFor="story-delete-reason">{tx(S.deleteReason)}</label>
        <input id="story-delete-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} dir="auto" />
      </div>
      {remove.error && <p className="field__error" role="alert">{(remove.error as Error).message}</p>}
    </Dialog>
  )
}
