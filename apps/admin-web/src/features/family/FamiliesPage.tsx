import { useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { familyApi } from '@/core/api/endpoints'
import { qk } from '@/core/api/queryKeys'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useDebounced } from '@/shared/hooks/useDebounced'
import { QueryBoundary } from '@/shared/components/States'
import { Badge, BucketDot } from '@/shared/components/Badge'
import type { AttentionBucket } from '@/shared/types/domain'

const BUCKETS: AttentionBucket[] = ['now', 'today', 'waiting_family', 'quiet']

/**
 * Operational family search and filtering.
 *
 * Filtering and paging are server-side: the result set is scoped by the
 * backend to what this operator may see, so client-side filtering would both
 * leak nothing useful and lie about totals.
 */
export function FamiliesPage() {
  const { t, number } = useI18n()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [bucket, setBucket] = useState<AttentionBucket | ''>('')
  const debouncedSearch = useDebounced(search, 300)

  const filters = { q: debouncedSearch || undefined, bucket: bucket || undefined }

  const query = useInfiniteQuery({
    queryKey: qk.families(filters),
    queryFn: ({ pageParam }) =>
      familyApi.list({ ...filters, cursor: pageParam as string | undefined }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  })

  const rows = query.data?.pages.flatMap((page) => page.items) ?? []

  return (
    <div className="page">
      <h1 className="page__title">{t('nav.families')}</h1>

      <div className="card" style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
        <label className="field" style={{ flex: 1, minInlineSize: 220, marginBlockEnd: 0 }}>
          <span className="field__label">{t('common.search')}</span>
          <input
            className="input"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>

        <label className="field" style={{ marginBlockEnd: 0 }}>
          <span className="field__label">{t('bucket.now')}</span>
          <select
            className="select"
            value={bucket}
            onChange={(event) => setBucket(event.target.value as AttentionBucket | '')}
          >
            <option value="">{t('common.none')}</option>
            {BUCKETS.map((value) => (
              <option key={value} value={value}>
                {t(`bucket.${value}` as const)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <QueryBoundary
        isLoading={query.isLoading}
        error={query.error}
        isEmpty={rows.length === 0}
        emptyTitle={t('inbox.empty.quiet')}
        onRetry={() => void query.refetch()}
      >
        <table className="table">
          <thead>
            <tr>
              <th>{t('nav.families')}</th>
              <th>{t('family.state')}</th>
              <th>{t('family.owner')}</th>
              <th>{t('family.onDuty')}</th>
              <th className="num">{t('inbox.openCases', { count: '' })}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.family_id}
                onClick={() => navigate(`/inbox/${row.family_id}`)}
                style={{ cursor: 'pointer' }}
              >
                <td>
                  <BucketDot bucket={row.bucket} /> {row.display_name}
                </td>
                <td>
                  <Badge tone={row.state === 'at_risk' ? 'danger' : 'neutral'}>{row.state}</Badge>
                </td>
                <td>{row.owner_id}</td>
                <td>{row.on_duty_id ?? t('handling.none')}</td>
                <td className="num">{number(row.open_case_count)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {query.hasNextPage && (
          <button
            type="button"
            className="btn"
            style={{ marginBlockStart: 12 }}
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {t('common.loadMore')}
          </button>
        )}
      </QueryBoundary>
    </div>
  )
}
