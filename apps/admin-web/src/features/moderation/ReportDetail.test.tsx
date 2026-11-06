import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { tokenStore } from '@/core/auth/tokens'
import { makeStaff, renderWithProviders } from '@/test/utils'
import { chooseOption, optionsOf } from '@/test/select'
import { ReportDetail } from './ReportDetail'
import { MOD, RESOLUTION_HELP, SUBJECT_KIND } from './copy'
import type { ReportDetail as Detail } from './api'

/**
 * PD-57 closure plan §3/§4: the report detail against the amended contract
 * (subject, canAct, attachment metadata, the signed-URL endpoint, required
 * notes, scoped 404s). The API is mocked, the clock fixed (Date only).
 * Synthetic ids and text only.
 */
const NOW = Date.UTC(2026, 10, 3, 12, 0, 0)
const H = 3_600_000
const iso = (ms: number) => new Date(ms).toISOString()
const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
let fetchMock: ReturnType<typeof vi.fn>
let detail: Detail
let detailStatus: number
let resolveReply: { status: number; body: unknown }
let urlSeq: number
let openSpy: ReturnType<typeof vi.fn>
const calls = (method: string, pattern: RegExp) =>
  fetchMock.mock.calls.filter(([u, i]) => pattern.test(String(u)) && ((i as RequestInit)?.method ?? 'GET') === method)

const MANAGER = makeStaff({ id: 'm1', role: 'manager', permissions: ['moderation.view', 'moderation.act'] })

const base = (over: Partial<Detail> = {}): Detail => ({
  id: 'r1',
  targetKind: 'message',
  reason: 'harassment',
  priority: 'normal',
  status: 'open',
  createdAt: iso(NOW - 2 * H),
  dueAt: iso(NOW + 22 * H),
  subject: { kind: 'teacher', id: 'sub-1', name: 'Subject Teacher' },
  canAct: true,
  evidence: {
    body: 'some words',
    author: { name: 'Subject Teacher' },
    attachments: [
      { index: 0, kind: 'image', mime: 'image/jpeg', name: 'photo.jpg', size: 2048 },
      { index: 1, kind: 'file', mime: 'application/pdf', name: 'doc.pdf', size: 500 },
    ],
  },
  ...over,
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  detail = base()
  detailStatus = 200
  resolveReply = { status: 200, body: {} }
  urlSeq = 0
  openSpy = vi.fn(() => null)
  vi.stubGlobal('open', openSpy)
  fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input)
    const method = (init.method ?? 'GET').toUpperCase()
    if (method === 'GET' && /\/moderation\/reports\/[^/?]+$/.test(url)) {
      return detailStatus === 200 ? json(detail) : json({ error: { code: 'COMM.REPORT_NOT_FOUND', message: 'x' } }, detailStatus)
    }
    if (method === 'POST' && /\/attachments\/\d+\/url$/.test(url)) {
      urlSeq += 1
      return json({ url: `https://files.example.test/signed-${urlSeq}`, expiresAt: iso(NOW + 5 * 60_000) })
    }
    if (method === 'POST' && /\/take$/.test(url)) return json({})
    if (method === 'POST' && /\/resolve$/.test(url)) return json(resolveReply.body, resolveReply.status)
    return json({ error: { code: 'unrouted', message: url } }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  tokenStore.set({ accessToken: 'access-1', refreshToken: 'refresh-1' })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function renderDetail(locale: 'ar' | 'en', over: { canAct?: boolean } = {}) {
  const onClose = vi.fn()
  const onGone = vi.fn()
  const utils = renderWithProviders(<ReportDetail id="r1" canAct={over.canAct ?? true} onClose={onClose} onGone={onGone} />, { locale, staff: MANAGER })
  return { ...utils, onClose, onGone }
}

describe.each([['en'], ['ar']] as const)('The report detail (%s)', (locale) => {
  const L = (p: { ar: string; en: string }) => p[locale]
  const LV = (p: { ar: string; en: string }, v: Record<string, string | number>) => L(p).replace(/\{(\w+)\}/g, (_, k: string) => String(v[k]))
  const user = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

  it('shows the reported person (name and kind) on a message report, and never the reporter', async () => {
    detail = { ...base(), reporterId: 'rep-1', reporterAccountId: 'acc-1', reporter: { name: 'Reporter Name' } } as Detail
    renderDetail(locale)
    const subject = await screen.findByTestId('report-subject')
    expect(subject).toHaveTextContent('Subject Teacher')
    expect(subject).toHaveTextContent(L(SUBJECT_KIND.teacher))
    const text = document.body.textContent ?? ''
    expect(text).not.toContain('Reporter Name')
    expect(text).not.toContain('rep-1')
    expect(text).not.toContain('acc-1')
  })

  it('shows the reported person on a person report too', async () => {
    detail = base({ targetKind: 'person', evidence: null, subject: { kind: 'contact', id: 'sub-2', name: 'Parent P' } })
    renderDetail(locale)
    const subject = await screen.findByTestId('report-subject')
    expect(subject).toHaveTextContent('Parent P')
    expect(subject).toHaveTextContent(L(SUBJECT_KIND.contact))
  })

  it('hides Take and Resolve when the server says canAct is false', async () => {
    detail = base({ canAct: false })
    renderDetail(locale)
    await screen.findByTestId('report-subject')
    expect(screen.queryByRole('form', { name: L(MOD.resolve) })).toBeNull()
    expect(screen.queryByRole('button', { name: L(MOD.take) })).toBeNull()
  })

  it('offers Take and Resolve when canAct is true and the report is open', async () => {
    const u = user()
    renderDetail(locale)
    await u.click(await screen.findByRole('button', { name: L(MOD.take) }))
    await waitFor(() => expect(calls('POST', /\/moderation\/reports\/r1\/take$/)).toHaveLength(1))
    expect(screen.getByRole('form', { name: L(MOD.resolve) })).toBeInTheDocument()
  })

  it('lists attachment metadata and asks for a fresh signed URL on every View, opening it with noopener', async () => {
    const u = user()
    const { queryClient } = renderDetail(locale)
    const view = await screen.findByRole('button', { name: LV(MOD.viewAttachment, { name: 'photo.jpg' }) })
    expect(screen.getByTestId('evidence')).toHaveTextContent('doc.pdf')
    // Nothing is prefetched.
    expect(calls('POST', /\/url$/)).toHaveLength(0)
    await u.click(view)
    await waitFor(() => expect(openSpy).toHaveBeenCalledTimes(1))
    expect(calls('POST', /\/moderation\/reports\/r1\/attachments\/0\/url$/)).toHaveLength(1)
    expect(openSpy).toHaveBeenLastCalledWith('https://files.example.test/signed-1', '_blank', 'noopener,noreferrer')
    await u.click(view)
    await waitFor(() => expect(openSpy).toHaveBeenCalledTimes(2))
    expect(calls('POST', /\/attachments\/0\/url$/)).toHaveLength(2)
    expect(openSpy).toHaveBeenLastCalledWith('https://files.example.test/signed-2', '_blank', 'noopener,noreferrer')
    // The signed URL is never kept in the query or mutation cache.
    const cached = JSON.stringify([
      queryClient.getQueryCache().getAll().map((q) => q.state.data),
      queryClient.getMutationCache().getAll().map((m) => m.state.data),
    ])
    expect(cached).not.toContain('signed-')
  })

  it('shows a warning before opening a child-safety attachment', async () => {
    const u = user()
    detail = base({ reason: 'child_safety', priority: 'urgent' })
    renderDetail(locale)
    await u.click(await screen.findByRole('button', { name: LV(MOD.viewAttachment, { name: 'photo.jpg' }) }))
    const warn = await screen.findByRole('alertdialog')
    expect(warn).toHaveTextContent(L(MOD.childSafetyWarnBody))
    expect(calls('POST', /\/url$/)).toHaveLength(0)
    await u.click(within(warn).getByRole('button', { name: L(MOD.cancel) }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(calls('POST', /\/url$/)).toHaveLength(0)
    expect(openSpy).not.toHaveBeenCalled()

    await u.click(screen.getByRole('button', { name: LV(MOD.viewAttachment, { name: 'doc.pdf' }) }))
    await u.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: L(MOD.childSafetyContinue) }))
    await waitFor(() => expect(openSpy).toHaveBeenCalledTimes(1))
    expect(calls('POST', /\/attachments\/1\/url$/)).toHaveLength(1)
    expect(openSpy).toHaveBeenLastCalledWith('https://files.example.test/signed-1', '_blank', 'noopener,noreferrer')
  })

  it.each([['reassigned'], ['account_suspended']] as const)('requires a note for %s', async (resolution) => {
    const u = user()
    renderDetail(locale)
    const form = await screen.findByRole('form', { name: L(MOD.resolve) })
    await chooseOption(u, within(form).getByRole('combobox'), resolution)
    expect(within(form).getByTestId('resolution-help')).toHaveTextContent(L(RESOLUTION_HELP[resolution]))
    await u.type(within(form).getByRole('textbox', { name: new RegExp(esc(L(MOD.answerLabel))) }), 'Thanks.')
    await u.click(within(form).getByRole('button', { name: L(MOD.submitResolve) }))
    expect(await within(form).findByText(L(MOD.noteRequired))).toBeInTheDocument()
    expect(calls('POST', /\/resolve$/)).toHaveLength(0)

    await u.type(within(form).getByRole('textbox', { name: new RegExp(esc(L(MOD.resolutionNoteRequired))) }), 'why')
    await u.click(within(form).getByRole('button', { name: L(MOD.submitResolve) }))
    await waitFor(() => expect(calls('POST', /\/moderation\/reports\/r1\/resolve$/)).toHaveLength(1))
    const init = calls('POST', /\/resolve$/)[0]![1] as RequestInit
    expect(JSON.parse(String(init.body))).toEqual({ resolution, note: 'why', answer: 'Thanks.' })
  })

  it('explains each resolution under the picker', async () => {
    const u = user()
    renderDetail(locale)
    const form = await screen.findByRole('form', { name: L(MOD.resolve) })
    expect(within(form).getByTestId('resolution-help')).toHaveTextContent(L(RESOLUTION_HELP.no_action))
    for (const r of ['message_removed', 'warned'] as const) {
      await chooseOption(u, within(form).getByRole('combobox'), r)
      expect(within(form).getByTestId('resolution-help')).toHaveTextContent(L(RESOLUTION_HELP[r]))
    }
  })

  it('does not offer removing a message on a person report', async () => {
    const u = user()
    detail = base({ targetKind: 'person', evidence: null })
    renderDetail(locale)
    const form = await screen.findByRole('form', { name: L(MOD.resolve) })
    const values = (await optionsOf(u, within(form).getByRole('combobox'))).map((o) => o.value)
    expect(values).not.toContain('message_removed')
    expect(values).toContain('account_suspended')
  })

  it('says calmly when suspension is refused for lack of accounts.administer (403)', async () => {
    const u = user()
    resolveReply = { status: 403, body: { error: { code: 'PERMISSION_DENIED', message: 'Forbidden resource' } } }
    renderDetail(locale)
    const form = await screen.findByRole('form', { name: L(MOD.resolve) })
    await chooseOption(u, within(form).getByRole('combobox'), 'account_suspended')
    await u.type(within(form).getByRole('textbox', { name: new RegExp(esc(L(MOD.resolutionNoteRequired))) }), 'why')
    await u.type(within(form).getByRole('textbox', { name: new RegExp(esc(L(MOD.answerLabel))) }), 'Thanks.')
    await u.click(within(form).getByRole('button', { name: L(MOD.submitResolve) }))
    expect(await within(form).findByText(L(MOD.noSuspendPermission))).toBeInTheDocument()
  })

  it('treats a 404 on the detail as "not available to you" and hands the row back to the page', async () => {
    detailStatus = 404
    const { onGone } = renderDetail(locale)
    await waitFor(() => expect(onGone).toHaveBeenCalledWith('r1'))
  })

  it('treats a 404 on resolve as "not available to you"', async () => {
    const u = user()
    resolveReply = { status: 404, body: { error: { code: 'COMM.REPORT_NOT_FOUND', message: 'x' } } }
    const { onGone } = renderDetail(locale)
    const form = await screen.findByRole('form', { name: L(MOD.resolve) })
    await u.type(within(form).getByRole('textbox', { name: new RegExp(esc(L(MOD.answerLabel))) }), 'Thanks.')
    await u.click(within(form).getByRole('button', { name: L(MOD.submitResolve) }))
    await waitFor(() => expect(onGone).toHaveBeenCalledWith('r1'))
  })

  it('treats a 404 on an attachment URL as "not available to you" and opens nothing', async () => {
    const u = user()
    const { onGone } = renderDetail(locale)
    const view = await screen.findByRole('button', { name: LV(MOD.viewAttachment, { name: 'photo.jpg' }) })
    const inner = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (i: RequestInfo | URL, init?: RequestInit) =>
      /\/url$/.test(String(i)) ? json({ error: { code: 'COMM.REPORT_NOT_FOUND', message: 'x' } }, 404) : inner(i, init),
    )
    await u.click(view)
    await waitFor(() => expect(onGone).toHaveBeenCalledWith('r1'))
    expect(openSpy).not.toHaveBeenCalled()
  })
})
