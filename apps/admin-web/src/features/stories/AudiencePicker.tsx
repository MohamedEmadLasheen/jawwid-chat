import { useState } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import type { StoryAudienceClause, StoryAudienceKind } from '@/core/api/endpoints'

/**
 * Who a story goes to, authored as INTENT.
 *
 * This picker emits audience CLAUSES — "all families", "this teacher" — and never
 * a list of people. The server resolves the clauses into recipients, so nothing
 * this component could get wrong can widen an audience: a clause outside the
 * author's own scope is refused server-side, and there is no field through which
 * a recipient could be named directly.
 *
 * The vocabulary is deliberately this schema's. There is no "label" option,
 * because `chat.family_label` does not exist (labels are Phase 2 and unbuilt),
 * and offering one would be a control that only fails when used. The group option
 * addresses a conversation, because on this schema a group IS a conversation.
 */
const UNSCOPED: readonly StoryAudienceKind[] = ['all_families', 'all_teachers', 'assigned_families']

const SCOPED: readonly StoryAudienceKind[] = ['family', 'teacher', 'contact', 'conversation']

export function AudiencePicker({
  value,
  onChange,
  disabled,
}: {
  value: StoryAudienceClause[]
  onChange: (next: StoryAudienceClause[]) => void
  disabled?: boolean
}) {
  const { t } = useI18n()
  const [kind, setKind] = useState<StoryAudienceKind>('family')
  const [refId, setRefId] = useState('')

  const has = (k: StoryAudienceKind, id?: string | null) =>
    value.some((c) => c.kind === k && (c.refId ?? null) === (id ?? null))

  function toggleUnscoped(k: StoryAudienceKind) {
    onChange(has(k) ? value.filter((c) => c.kind !== k) : [...value, { kind: k, refId: null }])
  }

  function addScoped() {
    const id = refId.trim()
    if (!id || has(kind, id)) return
    onChange([...value, { kind, refId: id }])
    setRefId('')
  }

  return (
    <fieldset className="card" disabled={disabled}>
      <legend>{t('story.audience')}</legend>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {UNSCOPED.map((k) => (
          <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input
              type="checkbox"
              checked={has(k)}
              onChange={() => toggleUnscoped(k)}
              aria-label={t(`story.audience.${k}` as 'story.audience.all_families')}
            />
            <span>{t(`story.audience.${k}` as 'story.audience.all_families')}</span>
          </label>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as StoryAudienceKind)}
          aria-label={t('story.audience.kind')}
        >
          {SCOPED.map((k) => (
            <option key={k} value={k}>
              {t(`story.audience.${k}` as 'story.audience.family')}
            </option>
          ))}
        </select>
        <input
          value={refId}
          onChange={(e) => setRefId(e.target.value)}
          placeholder={t('story.audience.id')}
          aria-label={t('story.audience.id')}
        />
        <button type="button" onClick={addScoped} disabled={!refId.trim()}>
          {t('story.audience.add')}
        </button>
      </div>

      {value.length > 0 && (
        <ul aria-label={t('story.audience.selected')} style={{ marginTop: 8 }}>
          {value.map((c) => (
            <li key={`${c.kind}:${c.refId ?? ''}`}>
              <span>
                {t(`story.audience.${c.kind}` as 'story.audience.family')}
                {c.refId ? ` · ${c.refId}` : ''}
              </span>
              <button
                type="button"
                onClick={() =>
                  onChange(
                    value.filter(
                      (x) => !(x.kind === c.kind && (x.refId ?? null) === (c.refId ?? null)),
                    ),
                  )
                }
                aria-label={`${t('story.audience.remove')} ${c.kind}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  )
}
