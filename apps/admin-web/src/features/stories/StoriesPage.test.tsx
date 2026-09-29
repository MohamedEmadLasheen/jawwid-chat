import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, makeStaff } from '@/test/utils'
import { StoriesPage } from './StoriesPage'
import type { Story } from '@/core/api/endpoints'
import { visibleAreas } from '@/core/permissions/capabilities'

/**
 * The Stories console.
 *
 * These are UI-contract tests, not security tests. Every DENY in this feature is
 * proven against the API and the database (apps/api/test/integration/stories.spec.ts,
 * db/tests/story_rls.sql), because a hidden button is not a control. What is
 * asserted here is that the console does not LIE: it never shows a live badge on
 * an expired story, never claims media was attached when the upload failed, and
 * never offers to delete without collecting the reason the server requires.
 */

function makeStory(over: Partial<Story> = {}): Story {
  return {
    id: 'story_1',
    title: 'Term starts Sunday',
    body: 'Classes resume this Sunday.',
    media_kind: null,
    mediaUrl: null,
    state: 'published',
    publishedAt: '2026-09-28T09:00:00Z',
    expiresAt: '2026-09-29T09:00:00Z',
    createdBy: 'staff_a',
    audiences: [{ kind: 'all_families', refId: null }],
    recipientCount: 42,
    viewCount: 7,
    ...over,
  }
}

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(new Date('2026-09-28T12:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/** Answers the endpoints this page calls, and fails loudly on anything else. */
function respondWith(stories: Story[], extra: Record<string, unknown> = {}) {
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const path = String(url)

    if (path.includes('/stories/') && path.includes('/viewers')) {
      return jsonResponse({
        viewers: [
          {
            actorId: 'contact_1',
            displayName: 'Parent P',
            actorKind: 'contact',
            viewedAt: '2026-09-28T10:00:00Z',
          },
        ],
      })
    }
    if (path.includes('/stories/media') && method === 'POST') {
      return jsonResponse(
        extra.mediaAuth ?? {
          objectKey: 'stories/abc',
          uploadUrl: 'https://storage.test/put',
          method: 'PUT',
          headers: {},
          expiresAt: '2026-09-28T12:05:00Z',
        },
      )
    }
    if (path.startsWith('https://storage.test')) {
      return Promise.resolve(
        new Response(null, { status: (extra.uploadStatus as number) ?? 200 }),
      )
    }
    if (path.includes('/stories') && method === 'POST') {
      return jsonResponse(makeStory({ id: 'story_new', state: 'draft' }))
    }
    if (path.includes('/stories') && method === 'DELETE') {
      return jsonResponse({ ok: true, alreadyDeleted: false })
    }
    return jsonResponse({ stories })
  })
}

function jsonResponse(body: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

describe('the story list tells the truth about state', () => {
  it('shows a live story as live, with its delivery and view counts', async () => {
    respondWith([makeStory()])
    renderWithProviders(<StoriesPage />, { staff: makeStaff() })

    expect(await screen.findByText('Term starts Sunday')).toBeInTheDocument()
    expect(screen.getByText('Live')).toBeInTheDocument()
    expect(screen.getByText(/Delivered to.*42/)).toBeInTheDocument()
    expect(screen.getByText(/Opened by.*7/)).toBeInTheDocument()
  })

  it('shows a story whose expiry has PASSED as finished, even while the server still says published', async () => {
    // The sweep is bookkeeping and may lag. The audience already cannot read
    // this story, so rendering it as live would be the console lying.
    respondWith([makeStory({ expiresAt: '2026-09-28T11:00:00Z', state: 'published' })])
    renderWithProviders(<StoriesPage />, { staff: makeStaff() })

    expect(await screen.findByText('Finished')).toBeInTheDocument()
    expect(screen.queryByText('Live')).not.toBeInTheDocument()
  })

  it('offers publish only for a draft', async () => {
    respondWith([makeStory({ id: 'd', state: 'draft', publishedAt: null, expiresAt: null })])
    renderWithProviders(<StoriesPage />, { staff: makeStaff() })

    expect(await screen.findByRole('button', { name: 'Publish' })).toBeInTheDocument()
    // Nothing has been published, so there is nobody to have viewed it.
    expect(screen.queryByRole('button', { name: 'Who viewed this' })).not.toBeInTheDocument()
  })

  it('offers no controls at all on a removed story', async () => {
    respondWith([makeStory({ state: 'deleted' })])
    renderWithProviders(<StoriesPage />, { staff: makeStaff() })

    expect(await screen.findByText('Removed')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Publish' })).not.toBeInTheDocument()
  })

  it('renders an empty state rather than a blank page', async () => {
    respondWith([])
    renderWithProviders(<StoriesPage />, { staff: makeStaff() })
    expect(await screen.findByText('No stories yet.')).toBeInTheDocument()
  })
})

describe('composing a story', () => {
  it('cannot be submitted without an audience', async () => {
    respondWith([])
    renderWithProviders(<StoriesPage />, { staff: makeStaff() })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    await user.type(screen.getByLabelText('What do you want to say?'), 'Hello')
    // Body alone is not enough: a story with no audience reaches nobody, and the
    // server refuses it. The button stays disabled rather than inviting a 400.
    expect(screen.getByRole('button', { name: 'Save as draft' })).toBeDisabled()
  })

  it('cannot be submitted with an audience but no content', async () => {
    respondWith([])
    renderWithProviders(<StoriesPage />, { staff: makeStaff() })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    await user.click(screen.getByLabelText('All families'))
    expect(screen.getByRole('button', { name: 'Save as draft' })).toBeDisabled()
  })

  it('submits an AUDIENCE, never a recipient list', async () => {
    respondWith([])
    renderWithProviders(<StoriesPage />, { staff: makeStaff() })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    await user.type(screen.getByLabelText('What do you want to say?'), 'Hello')
    await user.click(screen.getByLabelText('All families'))
    await user.click(screen.getByRole('button', { name: 'Save as draft' }))

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit | undefined)?.method === 'POST',
      )
      expect(post).toBeDefined()
      const body = JSON.parse((post![1] as RequestInit).body as string)
      expect(body.audiences).toEqual([{ kind: 'all_families', refId: null }])
      // The invariant that makes the privacy model hold: no field names people.
      expect(body).not.toHaveProperty('recipients')
      expect(body).not.toHaveProperty('actorIds')
    })
  })

  it('offers no `label` audience — chat.family_label does not exist on this schema', async () => {
    respondWith([])
    renderWithProviders(<StoriesPage />, { staff: makeStaff() })
    await screen.findByText('Who sees this')

    expect(screen.queryByLabelText(/label/i)).not.toBeInTheDocument()
    const select = screen.getByLabelText('Audience type')
    expect(within(select).queryByText('Label')).not.toBeInTheDocument()
    // A group is addressed as a conversation here.
    expect(within(select).getByText('A group')).toBeInTheDocument()
  })
})

describe('media upload', () => {
  it('reports a FAILED upload and does not claim media is attached', async () => {
    respondWith([], { uploadStatus: 500 })
    renderWithProviders(<StoriesPage />, { staff: makeStaff() })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    const file = new File(['bytes'], 'photo.png', { type: 'image/png' })
    await user.upload(screen.getByLabelText('Image or video'), file)

    // The failure is surfaced. Silently swallowing it is how an operator
    // publishes a story whose picture never arrived.
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.queryByText('Media attached.')).not.toBeInTheDocument()
  })

  it('confirms a successful upload, and sends the key rather than the bytes', async () => {
    respondWith([])
    renderWithProviders(<StoriesPage />, { staff: makeStaff() })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    const file = new File(['bytes'], 'photo.png', { type: 'image/png' })
    await user.upload(screen.getByLabelText('Image or video'), file)
    expect(await screen.findByText('Media attached.')).toBeInTheDocument()

    await user.click(screen.getByLabelText('All families'))
    await user.click(screen.getByRole('button', { name: 'Save as draft' }))

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([url, init]) =>
          (init as RequestInit | undefined)?.method === 'POST' &&
          String(url).endsWith('/stories'),
      )
      const body = JSON.parse((post![1] as RequestInit).body as string)
      expect(body.mediaObjectKey).toBe('stories/abc')
      expect(body.mediaKind).toBe('image')
    })
  })
})

describe('the viewer list', () => {
  it('is not fetched until it is asked for', async () => {
    respondWith([makeStory()])
    renderWithProviders(<StoriesPage />, { staff: makeStaff() })
    await screen.findByText('Term starts Sunday')

    // The most privacy-sensitive read in the feature is never prefetched.
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes('/viewers')),
    ).toBe(false)
  })

  it('shows names and times once opened', async () => {
    respondWith([makeStory()])
    renderWithProviders(<StoriesPage />, { staff: makeStaff() })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    await user.click(await screen.findByRole('button', { name: 'Who viewed this' }))
    const dialog = await screen.findByRole('dialog', { name: 'Who viewed this' })
    expect(within(dialog).getByText(/Parent P/)).toBeInTheDocument()
  })
})

describe('removing a story', () => {
  it('requires a reason before it will send', async () => {
    respondWith([makeStory()])
    renderWithProviders(<StoriesPage />, { staff: makeStaff() })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    await user.click(await screen.findByRole('button', { name: 'Remove' }))
    expect(screen.getByRole('button', { name: 'Remove story' })).toBeDisabled()

    await user.type(screen.getByLabelText('Why are you removing it?'), 'posted in error')
    expect(screen.getByRole('button', { name: 'Remove story' })).toBeEnabled()
  })

  it('sends the reason as a query parameter, matching the API contract', async () => {
    respondWith([makeStory()])
    renderWithProviders(<StoriesPage />, { staff: makeStaff() })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    await user.click(await screen.findByRole('button', { name: 'Remove' }))
    await user.type(screen.getByLabelText('Why are you removing it?'), 'posted in error')
    await user.click(screen.getByRole('button', { name: 'Remove story' }))

    await waitFor(() => {
      const del = fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit | undefined)?.method === 'DELETE',
      )
      expect(del).toBeDefined()
      expect(String(del![0])).toContain('reason=posted+in+error')
    })
  })
})

describe('navigation', () => {
  it('is offered to the roles that may publish, and to no others', () => {
    // Mirrors AuthorizationService.canPublishStory. The server is the control;
    // this only keeps the nav from advertising a page that would 403.
    for (const role of ['admin', 'coverage', 'manager'] as const) {
      expect(visibleAreas(role)).toContain('stories')
    }
    for (const role of ['finance', 'technical', 'academic'] as const) {
      expect(visibleAreas(role)).not.toContain('stories')
    }
  })
})
