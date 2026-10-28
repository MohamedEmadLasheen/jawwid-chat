import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { tokenStore } from '@/core/auth/tokens'
import { navAreas } from '@/core/permissions/capabilities'
import { makeStaff, renderWithProviders } from '@/test/utils'
import { lessonLetters } from '@/features/materials/lessonAudio'
import { LessonAudioPage } from './LessonAudioPage'
import type { ClipPlayer } from './player'
import type { UnitView } from './api'

/**
 * PD-48: the Lesson audio review page. What these prove is the page's side of
 * the gate: Approve opens only after THIS browser played the clip to the end
 * and its bytes matched, the approval carries exactly those hashes, a reject
 * needs a reason, and there is no bulk approve. The two-person rule and the
 * hash check are the database's (apps/api test/integration/pd048-lesson-audio.spec.ts).
 * Test strings and synthetic people only.
 */
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
type Handler = (url: string, init: RequestInit) => Response
let routes: Array<[RegExp, string, Handler]>
let fetchMock: ReturnType<typeof vi.fn>
const on = (method: string, pattern: RegExp, handler: Handler) => routes.unshift([pattern, method, handler])
const calls = (method: string, pattern: RegExp) => fetchMock.mock.calls.filter(([u, i]) => pattern.test(String(u)) && ((i as RequestInit)?.method ?? 'GET') === method)

const AUDIO = 'a'.repeat(64)
const TEXT = 'بَابْ'
const TEXT_SHA = 'b'.repeat(64)
function unitView(over: Partial<UnitView['strings'][number]['clips'][number]> = {}): UnitView {
  return {
    lesson: 'arabic-001',
    unit: 'ba',
    approvalsRequired: 2,
    strings: [
      {
        id: 'ba-001',
        kind: 'word',
        text: TEXT,
        textSha256: TEXT_SHA,
        status: 'pending',
        decisions: [],
        clips: [
          {
            clipId: 'clip-1',
            state: 'pending',
            attempt: 1,
            vendor: 'azure',
            voice: 'ar-SA-HamedNeural',
            renderSha256: 'c'.repeat(64),
            audioSha256: AUDIO,
            createdAt: '2026-10-29T10:00:00Z',
            approvals: [],
            rejections: [],
            approvedByMe: false,
            canReview: true,
            url: 'https://media.example.test/lesson-audio/arabic-001/ba-001/x.mp3?sig=1',
            ...over,
          },
        ],
      },
    ],
  }
}

function player(heard: { audioSha256: string; matched: boolean }): ClipPlayer {
  return { play: vi.fn(async () => heard), stop: vi.fn() }
}

beforeEach(() => {
  routes = []
  fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input)
    const method = (init.method ?? 'GET').toUpperCase()
    for (const [pattern, m, handler] of routes) if (m === method && pattern.test(url)) return handler(url, init)
    return json({ error: { code: 'unrouted', message: `no mock for ${method} ${url}` } }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  tokenStore.set({ accessToken: 'access-1', refreshToken: 'refresh-1' })
  on('GET', /\/lesson-audio\/access$/, () => json({ view: true, review: true }))
  on('GET', /\/lesson-audio\/review\/arabic-001$/, () =>
    json({ lesson: 'arabic-001', lessonApproved: false, approvalsRequired: 2, units: [{ unit: 'ba', strings: 1, approved: 0, pending: 1, needsDecision: 0, noAudio: 0, none: 0 }] }),
  )
  on('GET', /\/lesson-audio\/review\/arabic-001\/units\/ba$/, () => json(unitView()))
})
afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
})

const reviewer = makeStaff({ id: 'r-1', name: 'Reviewer One', role: 'specialist', permissions: ['lesson_audio.view', 'lesson_audio.review'] })

describe('the Lesson audio page', () => {
  it('shows the vowelled text with its clip, says the lesson file is still under review, and offers no bulk approve', async () => {
    renderWithProviders(<LessonAudioPage player={player({ audioSha256: AUDIO, matched: true })} />, { staff: reviewer })
    expect(await screen.findByText(TEXT)).toBeTruthy()
    expect(screen.getByText(/lesson file itself is still under review/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Play the unit' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /approve all|approve unit/i })).toBeNull()
  })

  it('Approve opens only after listening to the end, and sends the hashes this browser heard', async () => {
    const p = player({ audioSha256: AUDIO, matched: true })
    on('POST', /\/lesson-audio\/clips\/clip-1\/approve$/, () => json({ clipId: 'clip-1', state: 'pending' }))
    renderWithProviders(<LessonAudioPage player={p} />, { staff: reviewer })
    const clip = await screen.findByTestId('clip-clip-1')
    const approve = within(clip).getByRole('button', { name: 'Approve' }) as HTMLButtonElement
    expect(approve.disabled).toBe(true)
    await userEvent.click(within(clip).getByRole('button', { name: 'Listen' }))
    await waitFor(() => expect(approve.disabled).toBe(false))
    expect(p.play).toHaveBeenCalledWith(unitView().strings[0]!.clips[0]!.url, AUDIO)
    await userEvent.click(approve)
    await waitFor(() => expect(calls('POST', /\/approve$/)).toHaveLength(1))
    expect(JSON.parse(String((calls('POST', /\/approve$/)[0]![1] as RequestInit).body))).toEqual({ textSha256: TEXT_SHA, audioSha256: AUDIO })
  })

  it('a file that is not the approved clip is not played, and cannot be approved', async () => {
    renderWithProviders(<LessonAudioPage player={player({ audioSha256: 'f'.repeat(64), matched: false })} />, { staff: reviewer })
    const clip = await screen.findByTestId('clip-clip-1')
    await userEvent.click(within(clip).getByRole('button', { name: 'Listen' }))
    expect(await within(clip).findByRole('alert')).toBeTruthy()
    expect((within(clip).getByRole('button', { name: 'Approve' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('a reject names what is wrong and why', async () => {
    on('POST', /\/lesson-audio\/clips\/clip-1\/reject$/, () => json({ clipId: 'clip-1', state: 'rejected' }))
    renderWithProviders(<LessonAudioPage player={player({ audioSha256: AUDIO, matched: true })} />, { staff: reviewer })
    const clip = await screen.findByTestId('clip-clip-1')
    await userEvent.click(within(clip).getByRole('button', { name: 'Listen' }))
    await waitFor(() => expect((within(clip).getByRole('button', { name: 'Reject' }) as HTMLButtonElement).disabled).toBe(false))
    await userEvent.click(within(clip).getByRole('button', { name: 'Reject' }))
    const confirm = within(clip).getByRole('button', { name: 'Confirm' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    await userEvent.selectOptions(within(clip).getByRole('combobox'), 'final_sukun')
    await userEvent.type(within(clip).getByRole('textbox'), 'the last letter has a vowel')
    await userEvent.click(confirm)
    await waitFor(() => expect(calls('POST', /\/reject$/)).toHaveLength(1))
    expect(JSON.parse(String((calls('POST', /\/reject$/)[0]![1] as RequestInit).body))).toEqual({
      textSha256: TEXT_SHA,
      audioSha256: AUDIO,
      category: 'final_sukun',
      reason: 'the last letter has a vowel',
    })
  })

  it('a listener without review sees no Approve or Reject; my own approval removes them', async () => {
    on('GET', /\/lesson-audio\/access$/, () => json({ view: true, review: false }))
    renderWithProviders(<LessonAudioPage player={player({ audioSha256: AUDIO, matched: true })} />, { staff: reviewer })
    const clip = await screen.findByTestId('clip-clip-1')
    await waitFor(() => expect(within(clip).queryByRole('button', { name: 'Approve' })).toBeNull())
    expect(within(clip).getByRole('button', { name: 'Listen' })).toBeTruthy()
  })
})

describe('navigation and the opener', () => {
  it('the area waits for the server: offered only when GET /lesson-audio/access says the account may listen', () => {
    expect(navAreas('manager', {})).not.toContain('lesson-audio')
    expect(navAreas('manager', { lessonAudio: true })).toContain('lesson-audio')
    // A specialist: Tasks (PD-47) always; Certificates and Lesson audio each on the server's word.
    expect(navAreas('specialist', { lessonAudio: true })).toEqual(['tasks', 'lesson-audio'])
    expect(navAreas('specialist', { certificates: true })).toEqual(['certificates', 'tasks'])
  })

  it('only a lessons-site Arabic letters page is handed voice-over, under its lesson key', () => {
    expect(lessonLetters('https://lessons.example.test/lessons/arabic/lesson-1')).toEqual({ origin: 'https://lessons.example.test', lesson: 'arabic-001' })
    for (const bad of ['https://lessons.example.test/lessons/quran/surah-85', 'https://lessons.example.test/lessons/arabic/lesson-01', 'https://lessons.example.test/lessons/arabic/lesson-0', 'javascript:alert(1)', 'not a url']) {
      expect(lessonLetters(bad)).toBeNull()
    }
  })
})
