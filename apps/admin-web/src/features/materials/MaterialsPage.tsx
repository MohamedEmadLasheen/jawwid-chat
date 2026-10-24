import { useId, useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Badge, type Tone } from '@/shared/components/Badge'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import { FilterChips } from '@/shared/components/FilterChips'
import { PageHeader } from '@/shared/components/PageHeader'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import {
  AGE_GROUPS,
  KINDS,
  STRANDS,
  SUBJECTS,
  materialsApi,
  mimeOf,
  putToStorage,
  uploadOne,
  type AgeGroup,
  type ImportFileRef,
  type ImportReport,
  type ItemInput,
  type ItemStatus,
  type Kind,
  type MaterialItem,
  type OpenResult,
  type RecitationSource,
  type Strand,
  type Subject,
} from './api'
import {
  AGE_LABEL,
  KIND_LABEL,
  M,
  STATUS_LABEL,
  STRAND_LABEL,
  SUBJECT_LABEL,
  describeError,
  itemTitle,
  useCopy,
} from './copy'
import { useItems, useRecitationMutations, useRecitations, useSaveItem, useSurahs } from './hooks'
import './materials.css'

type Tab = 'library' | 'import' | 'recitations'
const TABS: readonly Tab[] = ['library', 'import', 'recitations']
const STATUS_TONE: Record<ItemStatus, Tone> = { draft: 'outline', published: 'ok', retired: 'warn' }

/**
 * PD-29: the Materials page -- the super admin's and the Teachers manager's.
 * Library: every item, its form, a sandboxed preview, publish / retire.
 * Import: a manifest and its files, checked row by row before anything is
 * written. Recitations: the authorized source and per-surah overrides.
 * The server decides each request again.
 */
export function MaterialsPage({ eyebrow }: { eyebrow?: string }) {
  const tx = useCopy()
  const [params, setParams] = useSearchParams()
  const asked = params.get('tab') as Tab | null
  const tab: Tab = asked && TABS.includes(asked) ? asked : 'library'
  const label: Record<Tab, string> = { library: tx(M.tabLibrary), import: tx(M.tabImport), recitations: tx(M.tabRecitations) }
  return (
    <div className="page">
      <div className="page__inner">
        <PageHeader eyebrow={eyebrow} title={tx(M.title)} subtitle={tx(M.subtitle)} />
        <div className="mt-tabs">
          <FilterChips<Tab>
            variant="tabs"
            label={tx(M.tabs)}
            value={tab}
            onChange={(next) => setParams(next === 'library' ? {} : { tab: next }, { replace: true })}
            options={TABS.map((t) => ({ value: t, label: label[t] }))}
          />
        </div>
        {tab === 'library' && <LibraryTab />}
        {tab === 'import' && <ImportTab />}
        {tab === 'recitations' && <RecitationsTab />}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Small parts
// ---------------------------------------------------------------------------

function Field({ label, hint, children }: { label: string; hint?: string; children: (id: string) => ReactNode }) {
  const id = useId()
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {children(id)}
      {hint && <span className="field__hint">{hint}</span>}
    </div>
  )
}

function ServerError({ error }: { error: unknown }) {
  const { locale } = useI18n()
  if (!error) return null
  return (
    <div className="banner banner--danger" role="alert">
      {describeError(error, locale)}
    </div>
  )
}

function SurahSelect({ id, value, onChange, allowNone = true }: { id?: string; value: number | null; onChange: (n: number | null) => void; allowNone?: boolean }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const surahs = useSurahs()
  return (
    <select id={id} className="select" value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
      {allowNone && <option value="">{tx(M.noSurah)}</option>}
      {surahs.data?.surahs.map((s) => (
        <option key={s.number} value={s.number}>
          {s.number}. {locale === 'ar' ? s.nameAr : s.nameEn}
        </option>
      ))}
    </select>
  )
}

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------

function LibraryTab() {
  const tx = useCopy()
  const { locale } = useI18n()
  const [subject, setSubject] = useState<Subject | ''>('')
  const [status, setStatus] = useState<ItemStatus | ''>('')
  const [ageGroup, setAgeGroup] = useState<AgeGroup | ''>('')
  const [q, setQ] = useState('')
  const query = useMemo(() => ({ subject, status, ageGroup, q }), [subject, status, ageGroup, q])
  const items = useItems(query)
  const save = useSaveItem()
  const [editing, setEditing] = useState<MaterialItem | 'new' | null>(null)
  const [previewing, setPreviewing] = useState<MaterialItem | null>(null)
  const filtered = subject !== '' || status !== '' || ageGroup !== '' || q.trim() !== ''

  return (
    <>
      <div className="mt-toolbar">
        <FilterChips<Subject | ''>
          label={tx(M.subject)}
          value={subject}
          onChange={setSubject}
          options={[{ value: '', label: tx(M.all) }, ...SUBJECTS.map((s) => ({ value: s, label: tx(SUBJECT_LABEL[s]) }))]}
        />
        <button type="button" className="btn btn--primary" onClick={() => setEditing('new')}>
          {tx(M.add)}
        </button>
      </div>
      <div className="mt-filters">
        <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tx(M.search)} aria-label={tx(M.search)} />
        <select className="select" value={status} onChange={(e) => setStatus(e.target.value as ItemStatus | '')} aria-label={tx(M.status)}>
          <option value="">{tx(M.status)}: {tx(M.all)}</option>
          {(['draft', 'published', 'retired'] as const).map((s) => (
            <option key={s} value={s}>
              {tx(STATUS_LABEL[s])}
            </option>
          ))}
        </select>
        <select className="select" value={ageGroup} onChange={(e) => setAgeGroup(e.target.value as AgeGroup | '')} aria-label={tx(M.ageGroup)}>
          <option value="">{tx(M.ageGroup)}: {tx(M.all)}</option>
          {AGE_GROUPS.map((a) => (
            <option key={a} value={a}>
              {tx(AGE_LABEL[a])}
            </option>
          ))}
        </select>
      </div>
      {save.error ? <ServerError error={save.error} /> : null}
      {items.error ? (
        <EmptyState icon="alert" title={describeError(items.error, locale)} />
      ) : (
        <QueryBoundary isLoading={items.isLoading} error={null} onRetry={() => void items.refetch()}>
          {!items.data || items.data.items.length === 0 ? (
            <EmptyState title={tx(filtered ? M.empty : M.emptyLibrary)} />
          ) : (
            <ul className="mt-items" aria-label={tx(M.tabLibrary)}>
              {items.data.items.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  busy={save.isPending}
                  onEdit={() => setEditing(item)}
                  onPreview={() => setPreviewing(item)}
                  onStatus={(next) => save.mutate({ id: item.id, body: { status: next } })}
                />
              ))}
            </ul>
          )}
        </QueryBoundary>
      )}
      {editing && <ItemDialog item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {previewing && <PreviewDialog item={previewing} onClose={() => setPreviewing(null)} />}
    </>
  )
}

function ItemRow({ item, busy, onEdit, onPreview, onStatus }: {
  item: MaterialItem
  busy: boolean
  onEdit: () => void
  onPreview: () => void
  onStatus: (s: ItemStatus) => void
}) {
  const tx = useCopy()
  const { locale } = useI18n()
  const surahs = useSurahs()
  const surah = item.surah ? surahs.data?.surahs.find((s) => s.number === item.surah) : undefined
  const title = itemTitle(item, locale)
  return (
    <li className="card panel mt-item" aria-label={title}>
      <div className="mt-item__body">
        <div className="mt-item__head">
          <Badge tone={STATUS_TONE[item.status]} dot>
            {tx(STATUS_LABEL[item.status])}
          </Badge>
          <strong dir="auto">{title}</strong>
        </div>
        <div className="mt-item__meta">
          <span>{tx(SUBJECT_LABEL[item.subject])}</span>
          {item.strand && <span>{tx(STRAND_LABEL[item.strand])}</span>}
          <span>{tx(KIND_LABEL[item.kind])}</span>
          {surah && <span>{tx(M.surah)}: {locale === 'ar' ? surah.nameAr : surah.nameEn}</span>}
          <span>{item.ageGroups.length ? item.ageGroups.map((a) => tx(AGE_LABEL[a])).join('، ') : tx(M.allAges)}</span>
          {item.externalRef && <span className="mt-ref" dir="ltr">{item.externalRef}</span>}
        </div>
      </div>
      <div className="mt-item__actions">
        <button type="button" className="btn btn--sm btn--ghost" onClick={onPreview}>
          {tx(M.preview)}
        </button>
        <button type="button" className="btn btn--sm" onClick={onEdit}>
          {tx(M.edit)}
        </button>
        {item.status !== 'published' && (
          <button type="button" className="btn btn--sm btn--primary" disabled={busy} onClick={() => onStatus('published')}>
            {tx(M.publish)}
          </button>
        )}
        {item.status === 'published' && (
          <button type="button" className="btn btn--sm" disabled={busy} onClick={() => onStatus('retired')}>
            {tx(M.retire)}
          </button>
        )}
      </div>
    </li>
  )
}

type SourceMode = 'keep' | 'link' | 'file'

function ItemDialog({ item, onClose }: { item: MaterialItem | null; onClose: () => void }) {
  const tx = useCopy()
  const { t } = useI18n()
  const save = useSaveItem()
  const [titleAr, setTitleAr] = useState(item?.titleAr ?? '')
  const [titleEn, setTitleEn] = useState(item?.titleEn ?? '')
  const [subject, setSubject] = useState<Subject>(item?.subject ?? 'quran')
  const [strand, setStrand] = useState<Strand | ''>(item?.strand ?? '')
  const [kind, setKind] = useState<Kind | ''>(item && item.source === 'url' ? item.kind : '')
  const [ageGroups, setAgeGroups] = useState<AgeGroup[]>(item?.ageGroups ?? [])
  const [surah, setSurah] = useState<number | null>(item?.surah ?? null)
  const [description, setDescription] = useState(item?.description ?? '')
  const [externalRef, setExternalRef] = useState(item?.externalRef ?? '')
  const [mode, setMode] = useState<SourceMode>(item ? 'keep' : 'link')
  const [url, setUrl] = useState(item?.source === 'url' ? item.url ?? '' : '')
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<unknown>(null)
  const [skipped, setSkipped] = useState<string[] | null>(null)

  const toggleAge = (a: AgeGroup) => setAgeGroups((cur) => (cur.includes(a) ? cur.filter((x) => x !== a) : [...cur, a]))

  const submit = async () => {
    setUploadError(null)
    const body: ItemInput = {
      titleAr: titleAr.trim() || null,
      titleEn: titleEn.trim() || null,
      subject,
      strand: subject === 'quran' && strand ? strand : null,
      ageGroups,
      surah,
      description: description.trim() || null,
      externalRef: externalRef.trim() || null,
    }
    try {
      if (mode === 'link') {
        body.url = url.trim()
        body.kind = kind || 'activity_link'
      } else if (mode === 'file' && file) {
        setUploading(true)
        body.uploadToken = await uploadOne(file)
      }
    } catch (e) {
      setUploading(false)
      setUploadError(e)
      return
    }
    setUploading(false)
    save.mutate(
      { id: item?.id, body },
      {
        onSuccess: (saved) => {
          if (saved.skipped?.length) setSkipped(saved.skipped)
          else onClose()
        },
      },
    )
  }

  if (skipped) {
    return (
      <Dialog title={tx(item ? M.editItem : M.newItem)} onClose={onClose} footer={<button type="button" className="btn btn--primary" onClick={onClose}>{t('common.close')}</button>}>
        <p className="field__hint">{tx(M.skipped, { files: skipped.join(', ') })}</p>
      </Dialog>
    )
  }

  const pending = uploading || save.isPending
  return (
    <Dialog
      title={tx(item ? M.editItem : M.newItem)}
      onClose={onClose}
      footer={
        <>
          <DialogCancelButton onClick={onClose} />
          <button type="button" className="btn btn--primary" disabled={pending || (mode === 'file' && !file)} onClick={() => void submit()}>
            {pending ? tx(M.saving) : tx(M.save)}
          </button>
        </>
      }
    >
      <div className="mt-form">
        <Field label={tx(M.titleAr)}>{(id) => <input id={id} className="input" dir="rtl" value={titleAr} onChange={(e) => setTitleAr(e.target.value)} />}</Field>
        <Field label={tx(M.titleEn)}>{(id) => <input id={id} className="input" dir="ltr" value={titleEn} onChange={(e) => setTitleEn(e.target.value)} />}</Field>
        <Field label={tx(M.subject)}>
          {(id) => (
            <select id={id} className="select" value={subject} onChange={(e) => setSubject(e.target.value as Subject)}>
              {SUBJECTS.map((s) => (
                <option key={s} value={s}>
                  {tx(SUBJECT_LABEL[s])}
                </option>
              ))}
            </select>
          )}
        </Field>
        {subject === 'quran' && (
          <Field label={tx(M.strand)}>
            {(id) => (
              <select id={id} className="select" value={strand} onChange={(e) => setStrand(e.target.value as Strand | '')}>
                <option value="">—</option>
                {STRANDS.map((s) => (
                  <option key={s} value={s}>
                    {tx(STRAND_LABEL[s])}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}
        <Field label={tx(M.surah)}>{(id) => <SurahSelect id={id} value={surah} onChange={setSurah} />}</Field>
        <fieldset className="mt-ages">
          <legend className="field__label">{tx(M.ageGroups)}</legend>
          {AGE_GROUPS.map((a) => (
            <label key={a}>
              <input type="checkbox" checked={ageGroups.includes(a)} onChange={() => toggleAge(a)} /> {tx(AGE_LABEL[a])}
            </label>
          ))}
          <span className="field__hint">{tx(M.allAgesHint)}</span>
        </fieldset>
        <Field label={tx(M.description)}>
          {(id) => <textarea id={id} className="input mt-textarea" dir="auto" value={description} onChange={(e) => setDescription(e.target.value)} />}
        </Field>
        <Field label={tx(M.ref)}>{(id) => <input id={id} className="input" dir="ltr" value={externalRef} onChange={(e) => setExternalRef(e.target.value)} />}</Field>
        <fieldset className="mt-mode">
          <legend className="field__label">{tx(M.source)}</legend>
          {item && (
            <label>
              <input type="radio" name="mt-source" checked={mode === 'keep'} onChange={() => setMode('keep')} /> {tx(M.sourceKeep)}
            </label>
          )}
          <label>
            <input type="radio" name="mt-source" checked={mode === 'link'} onChange={() => setMode('link')} /> {tx(M.sourceLink)}
          </label>
          <label>
            <input type="radio" name="mt-source" checked={mode === 'file'} onChange={() => setMode('file')} /> {tx(M.sourceFile)}
          </label>
        </fieldset>
        {mode === 'link' && (
          <>
            <Field label={tx(M.url)}>
              {(id) => <input id={id} className="input" dir="ltr" type="url" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} />}
            </Field>
            <Field label={tx(M.kind)}>
              {(id) => (
                <select id={id} className="select" value={kind} onChange={(e) => setKind(e.target.value as Kind | '')}>
                  {KINDS.filter((k) => k !== 'activity_package').map((k) => (
                    <option key={k} value={k}>
                      {tx(KIND_LABEL[k])}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </>
        )}
        {mode === 'file' && (
          <Field label={tx(M.file)} hint={tx(M.fileHint)}>
            {(id) => (
              <input
                id={id}
                type="file"
                accept=".zip,audio/*,video/*,application/pdf,image/*"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            )}
          </Field>
        )}
        <ServerError error={uploadError ?? save.error} />
      </div>
    </Dialog>
  )
}

/**
 * The preview plays exactly what a family would get, from `open`. A package
 * or a link runs in an <iframe sandbox="allow-scripts allow-forms"> -- never
 * allow-same-origin, so it is an opaque origin that cannot reach this page,
 * its storage or the session. (The package's own response carries the same
 * sandbox as a CSP header.)
 */
function PreviewDialog({ item, onClose }: { item: MaterialItem; onClose: () => void }) {
  const tx = useCopy()
  const { locale } = useI18n()
  // A fresh signed link each time the preview opens; never cached.
  const open = useQuery({ queryKey: ['materials', 'open', item.id], queryFn: () => materialsApi.open(item.id), gcTime: 0, staleTime: 0, retry: false })
  const opened: OpenResult | undefined = open.data
  const error = open.error
  return (
    <Dialog title={itemTitle(item, locale)} onClose={onClose} variant="sheet">
      <ServerError error={error} />
      {opened && <Player opened={opened} />}
      {opened && (opened.mode !== 'file' || opened.kind === 'pdf') && (
        <p className="field__hint">
          {tx(M.previewNote)}{' '}
          <a href={opened.url} target="_blank" rel="noopener noreferrer">
            {tx(M.open)}
          </a>
        </p>
      )}
    </Dialog>
  )
}

export function Player({ opened }: { opened: OpenResult }) {
  const tx = useCopy()
  if (opened.mode === 'package' || opened.mode === 'link' || opened.kind === 'pdf') {
    if (opened.mode === 'file' && opened.kind === 'pdf') {
      return (
        <a className="btn" href={opened.url} target="_blank" rel="noopener noreferrer">
          {tx(M.open)}
        </a>
      )
    }
    return (
      <iframe
        className="mt-frame"
        title={opened.itemId}
        src={opened.url}
        sandbox="allow-scripts allow-forms"
        referrerPolicy="no-referrer"
        allow="autoplay; fullscreen"
      />
    )
  }
  if (opened.kind === 'audio') return <audio className="mt-media" controls src={opened.url} />
  if (opened.kind === 'video') return <video className="mt-media" controls src={opened.url} />
  if (opened.kind === 'image') return <img className="mt-media" src={opened.url} alt="" />
  return <p className="field__hint">{tx(M.noPreview)}</p>
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

function ImportTab() {
  const tx = useCopy()
  const [manifest, setManifest] = useState<{ text: string; format: 'csv' | 'json'; name: string } | null>(null)
  const [files, setFiles] = useState<File[]>([])
  const [report, setReport] = useState<ImportReport | null>(null)
  const [phase, setPhase] = useState<'idle' | 'checking' | 'uploading' | 'committing'>('idle')
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [error, setError] = useState<unknown>(null)
  const [done, setDone] = useState<ImportReport | null>(null)

  const refs = (withTokens?: Map<string, string>): ImportFileRef[] =>
    files.map((f) => ({ name: f.name, mimeType: mimeOf(f), byteSize: f.size, ...(withTokens?.has(f.name) ? { uploadToken: withTokens.get(f.name) } : {}) }))

  const pickManifest = async (file: File | undefined) => {
    setReport(null)
    setDone(null)
    if (!file) return setManifest(null)
    const text = await readText(file)
    setManifest({ text, name: file.name, format: /\.json$/i.test(file.name) || /^\s*[[{]/.test(text) ? 'json' : 'csv' })
  }

  const check = async () => {
    if (!manifest) return
    setError(null)
    setDone(null)
    setPhase('checking')
    try {
      setReport(await materialsApi.import({ manifest: manifest.text, format: manifest.format, files: refs(), dryRun: true }))
    } catch (e) {
      setError(e)
    }
    setPhase('idle')
  }

  const run = async () => {
    if (!manifest || !report) return
    setError(null)
    const needed = files.filter((f) => report.rows.some((r) => r.file && r.file.toLowerCase() === f.name.toLowerCase()))
    const tokens = new Map<string, string>()
    try {
      if (needed.length) {
        setPhase('uploading')
        setProgress({ done: 0, total: needed.length })
        const { uploads } = await materialsApi.uploads(needed.map((f) => ({ name: f.name, mimeType: mimeOf(f), byteSize: f.size })))
        let n = 0
        for (const grant of uploads) {
          const file = needed.find((f) => f.name === grant.name)!
          const mime = mimeOf(file)
          await putToStorage(grant, file.type === mime ? file : new Blob([file], { type: mime }))
          tokens.set(file.name, grant.uploadToken)
          setProgress({ done: ++n, total: needed.length })
        }
      }
      setPhase('committing')
      const result = await materialsApi.import({ manifest: manifest.text, format: manifest.format, files: refs(tokens), dryRun: false })
      setReport(result)
      if (result.committed) setDone(result)
    } catch (e) {
      setError(e)
    }
    setPhase('idle')
  }

  const busy = phase !== 'idle'
  const download = async () => {
    try {
      const { blob, fileName } = await materialsApi.template()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = fileName ?? 'materials-manifest.csv'
      a.click()
      URL.revokeObjectURL(a.href)
    } catch (e) {
      setError(e)
    }
  }

  return (
    <div className="mt-import">
      <p className="mt-intro">{tx(M.importIntro)}</p>
      <div>
        <button type="button" className="btn btn--sm btn--ghost" onClick={() => void download()}>
          {tx(M.template)}
        </button>
      </div>
      <Field label={tx(M.manifest)}>
        {(id) => <input id={id} type="file" accept=".csv,.json,text/csv,application/json" onChange={(e) => void pickManifest(e.target.files?.[0])} />}
      </Field>
      <Field label={tx(M.files)} hint={files.length ? tx(M.filesChosen, { n: files.length }) : tx(M.fileHint)}>
        {(id) => (
          <input
            id={id}
            type="file"
            multiple
            accept=".zip,audio/*,video/*,application/pdf,image/*"
            onChange={(e) => {
              setFiles(Array.from(e.target.files ?? []))
              setReport(null)
              setDone(null)
            }}
          />
        )}
      </Field>
      <div className="mt-actions">
        <button type="button" className="btn" disabled={!manifest || busy} onClick={() => void check()}>
          {phase === 'checking' ? tx(M.checking) : tx(M.check)}
        </button>
        <button
          type="button"
          className="btn btn--primary"
          disabled={!report || report.summary.errors > 0 || report.committed || busy}
          onClick={() => void run()}
        >
          {phase === 'uploading' ? tx(M.importing, progress) : phase === 'committing' ? tx(M.committing) : tx(M.runImport)}
        </button>
      </div>
      <ServerError error={error} />
      {done && (
        <div className="banner banner--success" role="status">
          {tx(M.imported, { create: done.summary.create, update: done.summary.update })}
        </div>
      )}
      {report && !report.dryRun && !report.committed && (
        <div className="banner banner--danger" role="alert">
          {tx(M.notImported)}
        </div>
      )}
      {report && <ImportReportView report={report} />}
    </div>
  )
}

/** A picked file's text, via FileReader (every browser, and the test DOM). */
function readText(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('could not read the file'))
    reader.readAsText(file)
  })
}

function ImportReportView({ report }: { report: ImportReport }) {
  const tx = useCopy()
  const actionLabel = { create: tx(M.actionCreate), update: tx(M.actionUpdate), error: tx(M.actionError) }
  const actionTone: Record<'create' | 'update' | 'error', Tone> = { create: 'info', update: 'outline', error: 'danger' }
  return (
    <section className="card panel mt-report" aria-label={tx(M.details)}>
      <p>{tx(M.summary, { create: report.summary.create, update: report.summary.update, errors: report.summary.errors })}</p>
      {report.summary.errors > 0 && <p className="field__error">{tx(M.fixFirst)}</p>}
      {report.unmatchedFiles.length > 0 && <p className="field__hint">{tx(M.unmatched, { files: report.unmatchedFiles.join(', ') })}</p>}
      <table className="mt-table">
        <thead>
          <tr>
            <th scope="col">{tx(M.row)}</th>
            <th scope="col">{tx(M.ref)}</th>
            <th scope="col">{tx(M.titleAr)}</th>
            <th scope="col">{tx(M.action)}</th>
            <th scope="col">{tx(M.details)}</th>
          </tr>
        </thead>
        <tbody>
          {report.rows.map((r) => (
            <tr key={r.row} className={r.action === 'error' ? 'mt-table__error' : undefined}>
              <td>{r.row}</td>
              <td dir="ltr">{r.ref ?? '—'}</td>
              <td dir="auto">{r.title ?? '—'}</td>
              <td>
                <Badge tone={actionTone[r.action]}>{actionLabel[r.action]}</Badge>
              </td>
              <td>
                {[...r.errors, ...r.warnings].map((m, i) => (
                  <div key={i} className={i < r.errors.length ? 'field__error' : 'field__hint'} dir="ltr" lang="en">
                    {m}
                  </div>
                ))}
                {r.file && <div className="field__hint" dir="ltr">{r.file}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Recitations
// ---------------------------------------------------------------------------

function RecitationsTab() {
  const tx = useCopy()
  const { locale } = useI18n()
  const list = useRecitations()
  const m = useRecitationMutations()
  const [name, setName] = useState('')
  const [template, setTemplate] = useState('')
  const add = () =>
    m.create.mutate(
      { name: name.trim(), urlTemplate: template.trim() || null, isDefault: (list.data?.sources.length ?? 0) === 0 },
      { onSuccess: () => { setName(''); setTemplate('') } },
    )
  return (
    <div className="mt-recitations">
      <p className="mt-intro">{tx(M.recitationIntro)}</p>
      <QueryBoundary isLoading={list.isLoading} error={list.error ? new Error(describeError(list.error, locale)) : null} onRetry={() => void list.refetch()}>
        {list.data && list.data.sources.length === 0 && <EmptyState title={tx(M.noSources)} />}
        <ul className="mt-items">
          {list.data?.sources.map((s) => <SourceCard key={s.id} source={s} />)}
        </ul>
      </QueryBoundary>
      <section className="card panel mt-add-source" aria-label={tx(M.addSource)}>
        <Field label={tx(M.sourceName)}>{(id) => <input id={id} className="input" dir="auto" value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label={tx(M.urlTemplate)}>
          {(id) => <input id={id} className="input" dir="ltr" placeholder="https://…/{surah3}.mp3" value={template} onChange={(e) => setTemplate(e.target.value)} />}
        </Field>
        <button type="button" className="btn btn--primary" disabled={!name.trim() || m.create.isPending} onClick={add}>
          {tx(M.addSource)}
        </button>
        <ServerError error={m.create.error} />
      </section>
    </div>
  )
}

function SourceCard({ source }: { source: RecitationSource }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const surahs = useSurahs()
  const m = useRecitationMutations()
  const [surah, setSurah] = useState<number | null>(null)
  const [url, setUrl] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<unknown>(null)
  const name = (n: number) => {
    const s = surahs.data?.surahs.find((x) => x.number === n)
    return s ? `${n}. ${locale === 'ar' ? s.nameAr : s.nameEn}` : String(n)
  }
  const setOverride = async () => {
    if (!surah) return
    setError(null)
    try {
      const body = file ? { uploadToken: await uploadOne(file, 'recitation') } : { url: url.trim() }
      m.setTrack.mutate({ id: source.id, surah, body }, { onSuccess: () => { setUrl(''); setFile(null) }, onError: setError })
    } catch (e) {
      setError(e)
    }
  }
  return (
    <li className="card panel mt-source" aria-label={source.name}>
      <div className="mt-item__head">
        {source.isDefault && <Badge tone="ok" dot>{tx(M.isDefault)}</Badge>}
        {!source.isActive && <Badge tone="outline">{tx(M.inactive)}</Badge>}
        <strong dir="auto">{source.name}</strong>
      </div>
      {source.urlTemplate && <p className="mt-ref" dir="ltr">{source.urlTemplate}</p>}
      <div className="mt-item__actions">
        {!source.isDefault && source.isActive && (
          <button type="button" className="btn btn--sm" onClick={() => m.update.mutate({ id: source.id, body: { isDefault: true } })}>
            {tx(M.useSource)}
          </button>
        )}
        <button type="button" className="btn btn--sm btn--ghost" onClick={() => m.update.mutate({ id: source.id, body: { isActive: !source.isActive } })}>
          {source.isActive ? tx(M.retireSource) : tx(M.restoreSource)}
        </button>
      </div>
      {(source.tracks?.length ?? 0) > 0 && (
        <>
          <h4 className="mt-subhead">{tx(M.overrides)}</h4>
          <ul className="mt-tracks">
            {source.tracks!.map((t) => (
              <li key={t.surah}>
                <span>{name(t.surah)}</span>
                <span className="mt-ref" dir="ltr">{t.url ?? tx(M.file)}</span>
                <button type="button" className="btn btn--sm btn--ghost" onClick={() => m.setTrack.mutate({ id: source.id, surah: t.surah, body: { clear: true } })}>
                  {tx(M.clear)}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="mt-override">
        <SurahSelect value={surah} onChange={setSurah} allowNone />
        <input className="input" dir="ltr" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} aria-label={tx(M.url)} disabled={file !== null} />
        <input type="file" accept="audio/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} aria-label={tx(M.file)} />
        <button type="button" className="btn btn--sm btn--primary" disabled={!surah || (!url.trim() && !file) || m.setTrack.isPending} onClick={() => void setOverride()}>
          {tx(M.setOverride)}
        </button>
      </div>
      <ServerError error={error ?? m.update.error} />
    </li>
  )
}
