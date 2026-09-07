import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  MATCH_TYPES,
  MODERATION_CATEGORIES,
  SEVERITIES,
  ruleApi,
  severityTone,
  type MatchType,
  type ModerationCategory,
  type ModerationRule,
  type ModerationSeverity,
  type RuleDraft,
} from '@/core/api/phase6'
import { qk } from '@/core/api/queryKeys'
import { useSession } from '@/core/auth/SessionProvider'
import { hasPermission } from '@/core/permissions/capabilities'
import { QueryBoundary } from '@/shared/components/States'
import { Badge } from '@/shared/components/Badge'

const EMPTY: RuleDraft = {
  name: '',
  category: 'custom',
  severity: 'medium',
  matchType: 'phrase',
  pattern: '',
  notes: '',
}

/**
 * RULE MANAGEMENT.
 *
 * ## Two permissions, and this page shows both states honestly
 *
 * `messages.moderate` (admin and above) READS. An approver deciding a held
 * message has to be able to see the rule that held it, or the queue's "reason"
 * is a name they cannot check. So an admin reaches this page and sees the
 * catalogue, with every control disabled and a line saying why -- rather than
 * being bounced to a forbidden page for information they legitimately need.
 *
 * `moderation_rules.manage` (manager and above) WRITES. A rule applies to every
 * conversation in the organization, so an admin who could disable the
 * phone-number rule would be disabling it for families that are not theirs.
 *
 * The server enforces both. Everything here is an affordance.
 *
 * ## There is no delete, and that is deliberate
 *
 * A rule is DISABLED. The flags recording why past messages were held point at
 * it, and deleting it would make "which rule held this message" unanswerable.
 * The API serves no delete route and `chat_app` holds no DELETE privilege on
 * the table, so this is a property of the system rather than a missing button.
 *
 * ## An invalid pattern is refused HERE, with the reason
 *
 * Patterns are validated when they are written, where a human is present to be
 * told what is wrong -- not when they are applied, where the only available
 * response would be to fail a teacher's message for something they did not do.
 */
export function RulesPage() {
  const qc = useQueryClient()
  const { permissions } = useSession()
  const canManage = hasPermission(permissions, 'moderation_rules.manage')

  const rules = useQuery({ queryKey: qk.moderationRules, queryFn: () => ruleApi.list() })

  const [draft, setDraft] = useState<RuleDraft>(EMPTY)
  const [editing, setEditing] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = () => void qc.invalidateQueries({ queryKey: qk.moderationAll })
  const fail = (e: Error) => setError(e.message)

  const create = useMutation({
    mutationFn: () => ruleApi.create(draft),
    onSuccess: () => {
      setDraft(EMPTY)
      setError(null)
      refresh()
    },
    onError: fail,
  })

  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<RuleDraft> }) =>
      ruleApi.update(id, patch),
    onSuccess: () => {
      setEditing(null)
      setError(null)
      refresh()
    },
    onError: fail,
  })

  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      ruleApi.setEnabled(id, enabled),
    onSuccess: () => {
      setError(null)
      refresh()
    },
    onError: fail,
  })

  const byCategory = groupByCategory(rules.data ?? [])

  return (
    <div className="page">
      <h1 className="page__title">Moderation rules</h1>

      {!canManage && (
        <div className="banner banner--info">
          You can see the rules so that you can explain a held message. Changing them is a
          manager&apos;s action, because a rule applies to every family in the academy.
        </div>
      )}

      {error && (
        <div className="banner banner--warn" role="alert">
          {error}
        </div>
      )}

      {canManage && (
        <section className="card" style={{ marginBlockEnd: 'var(--space-4)' }}>
          <h2 className="panel__title">Add a rule</h2>
          <RuleFields draft={draft} onChange={setDraft} />
          <div className="row" style={{ gap: 'var(--space-2)', marginBlockStart: 'var(--space-3)' }}>
            <button
              type="button"
              className="btn btn--primary"
              disabled={create.isPending || draft.name.trim() === '' || draft.pattern.trim() === ''}
              onClick={() => create.mutate()}
            >
              Add rule
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => setDraft(EMPTY)}>
              Clear
            </button>
          </div>
        </section>
      )}

      <QueryBoundary
        isLoading={rules.isLoading}
        error={rules.error}
        isEmpty={(rules.data ?? []).length === 0}
        emptyTitle="No moderation rules are configured."
        onRetry={() => void rules.refetch()}
      >
        {byCategory.map(([category, list]) => (
          <section className="card" key={category} style={{ marginBlockEnd: 'var(--space-4)' }}>
            <h2 className="panel__title">{categoryLabel(category)}</h2>
            <table className="table">
              <thead>
                <tr>
                  <th>Rule</th>
                  <th>Severity</th>
                  <th>Match</th>
                  <th>Pattern</th>
                  <th>State</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((rule) =>
                  editing === rule.id ? (
                    <tr key={rule.id}>
                      <td colSpan={6}>
                        <EditRow
                          rule={rule}
                          busy={update.isPending}
                          onCancel={() => setEditing(null)}
                          onSave={(patch) => update.mutate({ id: rule.id, patch })}
                        />
                      </td>
                    </tr>
                  ) : (
                    <tr key={rule.id} style={{ opacity: rule.isEnabled ? 1 : 0.55 }}>
                      <td>
                        {rule.name}{' '}
                        {rule.isBuiltin && <Badge tone="neutral">built-in</Badge>}
                        {rule.notes && <div className="muted">{rule.notes}</div>}
                      </td>
                      <td>
                        <Badge tone={severityTone(rule.severity)}>{rule.severity}</Badge>
                      </td>
                      <td>{rule.matchType}</td>
                      <td>
                        <code style={{ wordBreak: 'break-all' }}>{rule.pattern}</code>
                      </td>
                      <td>
                        {/* Words, never colour alone. */}
                        <Badge tone={rule.isEnabled ? 'ok' : 'neutral'}>
                          {rule.isEnabled ? 'enabled' : 'disabled'}
                        </Badge>
                      </td>
                      <td>
                        <div className="row" style={{ gap: 'var(--space-2)' }}>
                          <button
                            type="button"
                            className="btn btn--sm"
                            disabled={!canManage || toggle.isPending}
                            onClick={() =>
                              toggle.mutate({ id: rule.id, enabled: !rule.isEnabled })
                            }
                          >
                            {rule.isEnabled ? 'Disable' : 'Enable'}
                          </button>
                          <button
                            type="button"
                            className="btn btn--sm btn--ghost"
                            disabled={!canManage}
                            onClick={() => setEditing(rule.id)}
                          >
                            Edit
                          </button>
                        </div>
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </section>
        ))}
      </QueryBoundary>
    </div>
  )
}

function RuleFields({
  draft,
  onChange,
}: {
  draft: RuleDraft
  onChange: (d: RuleDraft) => void
}) {
  const set = <K extends keyof RuleDraft>(k: K, v: RuleDraft[K]) =>
    onChange({ ...draft, [k]: v })

  return (
    <div className="column" style={{ gap: 'var(--space-2)' }}>
      <input
        type="text"
        placeholder="Name, e.g. Competitor mention"
        value={draft.name}
        onChange={(e) => set('name', e.target.value)}
      />

      <div className="row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <label>
          Category{' '}
          <select
            value={draft.category}
            onChange={(e) => set('category', e.target.value as ModerationCategory)}
          >
            {MODERATION_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {categoryLabel(c)}
              </option>
            ))}
          </select>
        </label>

        <label>
          Severity{' '}
          <select
            value={draft.severity}
            onChange={(e) => set('severity', e.target.value as ModerationSeverity)}
          >
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <label>
          Match{' '}
          <select
            value={draft.matchType}
            onChange={(e) => set('matchType', e.target.value as MatchType)}
          >
            {MATCH_TYPES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
      </div>

      <input
        type="text"
        placeholder={patternHint(draft.matchType)}
        value={draft.pattern}
        style={{ unicodeBidi: 'plaintext' }}
        onChange={(e) => set('pattern', e.target.value)}
      />
      <p className="muted">{patternHelp(draft.matchType)}</p>

      <input
        type="text"
        placeholder="Why this rule exists — shown to moderators beside the match"
        value={draft.notes ?? ''}
        onChange={(e) => set('notes', e.target.value)}
      />
    </div>
  )
}

function EditRow({
  rule,
  busy,
  onCancel,
  onSave,
}: {
  rule: ModerationRule
  busy: boolean
  onCancel: () => void
  onSave: (patch: Partial<RuleDraft>) => void
}) {
  const [draft, setDraft] = useState<RuleDraft>({
    name: rule.name,
    category: rule.category,
    severity: rule.severity,
    matchType: rule.matchType,
    pattern: rule.pattern,
    notes: rule.notes ?? '',
  })

  return (
    <div className="column" style={{ gap: 'var(--space-2)' }}>
      <RuleFields draft={draft} onChange={setDraft} />
      <div className="row" style={{ gap: 'var(--space-2)' }}>
        <button
          type="button"
          className="btn btn--primary btn--sm"
          disabled={busy}
          onClick={() => onSave(draft)}
        >
          Save
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}

function groupByCategory(rules: ModerationRule[]): Array<[ModerationCategory, ModerationRule[]]> {
  const map = new Map<ModerationCategory, ModerationRule[]>()
  for (const r of rules) map.set(r.category, [...(map.get(r.category) ?? []), r])
  // Catalogue order, so the list does not reshuffle as rules are added.
  return MODERATION_CATEGORIES.filter((c) => map.has(c)).map((c) => [c, map.get(c)!])
}

function categoryLabel(c: ModerationCategory): string {
  return {
    phone_number: 'Phone numbers',
    email_address: 'E-mail addresses',
    url: 'Links',
    forbidden_word: 'Forbidden words',
    forbidden_phrase: 'Forbidden phrases',
    cancellation: 'Cancellation',
    resignation: 'Resignation',
    custom: 'Custom',
  }[c]
}

function patternHint(m: MatchType): string {
  return {
    word: 'One word, e.g. competitor',
    phrase: 'Several words, e.g. contact me directly',
    regex: 'A regular expression, e.g. refund (you|your money)',
  }[m]
}

function patternHelp(m: MatchType): string {
  return {
    word: 'Matched as a whole word, ignoring case and Arabic diacritics.',
    phrase: 'Matched as a sequence, however it was spaced — including across a line break.',
    regex:
      'JavaScript syntax. Checked when you save: a pattern that will not compile, or that ' +
      'nests one repetition inside another, is refused with the reason.',
  }[m]
}
