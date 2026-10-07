import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, makeStaff, ROLES } from '@/test/utils'
import { TeacherProfilesPage } from './TeacherProfilesPage'
import type { ReviewCertificate, ReviewRevision } from '@/core/api/endpoints'
import { visibleAreas } from '@/core/permissions/capabilities'

/**
 * Teacher professional profile review.
 *
 * These are UI-CONTRACT tests, not security tests. Every DENY in this feature is
 * proven against the API and the database
 * (apps/api/test/integration/teacher-profile.spec.ts,
 * db/tests/teacher_profile_rls.sql), because a hidden button is not a control.
 *
 * What is asserted here is that the console does not LIE: it never offers an
 * approval the server would refuse without saying why, never claims a decision
 * landed when the request failed, never renders an identifier a reviewer has no
 * business seeing, and never constructs a storage URL of its own.
 */

function makeCertificate(over: Partial<ReviewCertificate> = {}): ReviewCertificate {
  return {
    id: 'cert_1',
    title: 'Ijazah in Tajweed',
    issuingOrganization: 'Al-Azhar',
    issuedOn: '2019-06-01T00:00:00Z',
    state: 'approved',
    reviewNote: null,
    mimeType: 'application/pdf',
    byteSize: 1000,
    ...over,
  }
}

function makeRevision(over: Partial<ReviewRevision> = {}): ReviewRevision {
  const certificates = over.certificates ?? [makeCertificate()]
  return {
    revisionId: 'rev_1',
    teacherName: 'Ahmed Al-Masri',
    state: 'pending_review',
    revisionNumber: 2,
    bio: 'Fifteen years teaching Tajweed.',
    specialization: 'Tajweed',
    qualifications: 'Ijazah, BA Islamic Studies',
    experience: 'Taught at two academies.',
    languages: ['Arabic', 'English'],
    reviewNote: null,
    submittedAt: '2026-10-07T09:00:00Z',
    approvedAt: null,
    ...over,
    certificates,
    pendingCertificates:
      over.pendingCertificates ?? certificates.filter((c) => c.state === 'pending').length,
  }
}

const fetchMock = vi.fn()

/** Route by path and method, as the Stories suite does. */
function routes(handlers: {
  list?: () => unknown
  detail?: () => unknown
  onPost?: (path: string, body: unknown) => unknown
  download?: () => unknown
}) {
  fetchMock.mockImplementation(async (url: string | URL, init?: RequestInit) => {
    const path = String(url)
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined

    const reply = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' },
      })

    if (method === 'POST') {
      const result = handlers.onPost?.(path, body)
      if (result instanceof Response) return result
      return reply(result ?? makeRevision())
    }
    if (path.includes('/download')) return reply(handlers.download?.() ?? { url: 'https://signed.example/f' })
    if (/\/teacher-profiles\/review\/[^/]+$/.test(path)) {
      return reply(handlers.detail?.() ?? makeRevision())
    }
    if (path.includes('/teacher-profiles/review')) {
      return reply(handlers.list?.() ?? { revisions: [makeRevision()] })
    }
    return reply({})
  })
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function openReview(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByText('Ahmed Al-Masri')
  await user.click(screen.getByRole('button', { name: 'Review' }))
  await screen.findByText('Fifteen years teaching Tajweed.')
}

describe('navigation', () => {
  it('every operator role may open the area, and no department role may', () => {
    // The SAME set the server uses (isFamilyFacingStaff). No new permission.
    for (const role of ROLES) {
      const areas = visibleAreas(role)
      const operator = role === 'admin' || role === 'coverage' || role === 'manager'
      expect(areas.includes('teacher-profiles')).toBe(operator)
    }
  })
})

describe('the review list', () => {
  it('renders a pending profile with its counts', async () => {
    routes({})
    renderWithProviders(<TeacherProfilesPage />, { staff: makeStaff({ role: 'admin' }) })

    expect(await screen.findByText('Ahmed Al-Masri')).toBeInTheDocument()
    expect(screen.getByText('Awaiting review')).toBeInTheDocument()
    expect(screen.getByText('Ready to decide')).toBeInTheDocument()
  })

  it('flags how many certificates still need a decision', async () => {
    routes({
      list: () => ({
        revisions: [
          makeRevision({
            certificates: [makeCertificate({ state: 'pending' }), makeCertificate({ id: 'c2' })],
          }),
        ],
      }),
    })
    renderWithProviders(<TeacherProfilesPage />, { staff: makeStaff({ role: 'admin' }) })

    expect(await screen.findByText(/Awaiting decision/)).toBeInTheDocument()
    expect(screen.queryByText('Ready to decide')).not.toBeInTheDocument()
  })

  it('shows an empty state when nothing is waiting', async () => {
    routes({ list: () => ({ revisions: [] }) })
    renderWithProviders(<TeacherProfilesPage />, { staff: makeStaff({ role: 'admin' }) })

    expect(await screen.findByText('Nothing is waiting for review.')).toBeInTheDocument()
  })

  it('surfaces an error and retries', async () => {
    const user = userEvent.setup()
    let fail = true
    fetchMock.mockImplementation(async () => {
      if (fail) return new Response('{}', { status: 500 })
      return new Response(JSON.stringify({ revisions: [makeRevision()] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    renderWithProviders(<TeacherProfilesPage />, { staff: makeStaff({ role: 'admin' }) })

    const retry = await screen.findByRole('button', { name: /retry|إعادة/i })
    fail = false
    await user.click(retry)
    expect(await screen.findByText('Ahmed Al-Masri')).toBeInTheDocument()
  })
})

describe('the review detail', () => {
  it('renders every professional field and certificate', async () => {
    const user = userEvent.setup()
    routes({
      detail: () =>
        makeRevision({
          certificates: [
            makeCertificate(),
            makeCertificate({ id: 'c2', title: 'Second', state: 'pending' }),
            makeCertificate({
              id: 'c3',
              title: 'Third',
              state: 'rejected',
              reviewNote: 'Unreadable scan.',
            }),
          ],
        }),
    })
    renderWithProviders(<TeacherProfilesPage />, { staff: makeStaff({ role: 'admin' }) })
    await openReview(user)

    expect(screen.getByText('Tajweed')).toBeInTheDocument()
    expect(screen.getByText('Ijazah, BA Islamic Studies')).toBeInTheDocument()
    expect(screen.getByText('Taught at two academies.')).toBeInTheDocument()
    expect(screen.getByText('Arabic, English')).toBeInTheDocument()

    expect(screen.getByText('Ijazah in Tajweed')).toBeInTheDocument()
    expect(screen.getByText('Awaiting decision')).toBeInTheDocument()
    expect(screen.getByText('Rejected')).toBeInTheDocument()
    expect(screen.getByText('Unreadable scan.')).toBeInTheDocument()
  })

  it('says "Not written" for a field the teacher left empty', async () => {
    const user = userEvent.setup()
    routes({ detail: () => makeRevision({ experience: null }) })
    renderWithProviders(<TeacherProfilesPage />, { staff: makeStaff({ role: 'admin' }) })
    await openReview(user)

    expect(screen.getByText('Not written')).toBeInTheDocument()
  })

  it('renders NO revision id, reviewer id, object key or storage path', async () => {
    const user = userEvent.setup()
    routes({})
    const { container } = renderWithProviders(<TeacherProfilesPage />, {
      staff: makeStaff({ role: 'admin' }),
    })
    await openReview(user)

    const text = container.textContent ?? ''
    expect(text).not.toContain('rev_1')
    expect(text).not.toContain('cert_1')
    expect(text).not.toContain('teacher-certificates/')
    expect(text).not.toContain('objectKey')
  })
})

describe('certificate decisions', () => {
  it('approving one calls the API and refetches', async () => {
    const user = userEvent.setup()
    const posts: string[] = []
    routes({
      onPost: (path) => {
        posts.push(path)
        return makeRevision()
      },
    })
    renderWithProviders(<TeacherProfilesPage />, { staff: makeStaff({ role: 'admin' }) })
    await openReview(user)

    const list = screen.getByRole('list', { name: 'Certificates' })
    await user.click(within(list).getByRole('button', { name: 'Approve' }))

    await waitFor(() => {
      expect(posts.some((p) => p.includes('/certificates/cert_1/decide'))).toBe(true)
    })
  })

  it('rejecting one collects a note, and refuses an empty one', async () => {
    const user = userEvent.setup()
    const bodies: unknown[] = []
    routes({
      onPost: (_path, body) => {
        bodies.push(body)
        return makeRevision()
      },
    })
    renderWithProviders(<TeacherProfilesPage />, { staff: makeStaff({ role: 'admin' }) })
    await openReview(user)

    const list = screen.getByRole('list', { name: 'Certificates' })
    await user.click(within(list).getByRole('button', { name: 'Reject' }))

    // Empty note: refused before any request.
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByText('Say what needs to change.')).toBeInTheDocument()
    expect(bodies).toHaveLength(0)

    await user.type(screen.getByLabelText('Why is it not accepted?'), 'Unreadable scan.')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => {
      expect(bodies).toContainEqual({ approved: false, note: 'Unreadable scan.' })
    })
  })

  it('shows the server error when a decision is refused', async () => {
    const user = userEvent.setup()
    routes({
      onPost: () =>
        new Response(JSON.stringify({ message: 'a teacher cannot review their own profile' }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        }),
    })
    renderWithProviders(<TeacherProfilesPage />, { staff: makeStaff({ role: 'admin' }) })
    await openReview(user)

    const list = screen.getByRole('list', { name: 'Certificates' })
    await user.click(within(list).getByRole('button', { name: 'Approve' }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })
})

describe('profile approval', () => {
  it('is disabled while a certificate is pending, and says why', async () => {
    const user = userEvent.setup()
    routes({
      detail: () =>
        makeRevision({ certificates: [makeCertificate({ state: 'pending' })] }),
    })
    renderWithProviders(<TeacherProfilesPage />, { staff: makeStaff({ role: 'admin' }) })
    await openReview(user)

    expect(screen.getByRole('button', { name: 'Approve profile' })).toBeDisabled()
    // The reason is stated, not implied by a dead control.
    expect(
      screen.getByText('Decide every certificate before approving.'),
    ).toBeInTheDocument()
  })

  it('is enabled when every certificate is decided, and posts once', async () => {
    const user = userEvent.setup()
    const posts: string[] = []
    routes({
      onPost: (path) => {
        posts.push(path)
        return makeRevision({ state: 'approved' })
      },
    })
    renderWithProviders(<TeacherProfilesPage />, { staff: makeStaff({ role: 'admin' }) })
    await openReview(user)

    const approve = screen.getByRole('button', { name: 'Approve profile' })
    expect(approve).toBeEnabled()

    await user.click(approve)

    await waitFor(() => {
      expect(posts.filter((p) => p.endsWith('/approve'))).toHaveLength(1)
    })
    expect(await screen.findByText(/Profile approved/)).toBeInTheDocument()
  })

  it('a double click while the request is in flight sends ONE approval', async () => {
    const user = userEvent.setup()
    const posts: string[] = []
    // Initialised to a no-op rather than null: TypeScript does not track an
    // assignment made inside a Promise executor, so a nullable here narrows to
    // `never` at the call site.
    let release: () => void = () => {}
    const inFlight = new Promise<void>((resolve) => {
      release = () => resolve()
    })

    fetchMock.mockImplementation(async (url: string | URL, init?: RequestInit) => {
      const path = String(url)
      const reply = (d: unknown) =>
        new Response(JSON.stringify(d), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      if ((init?.method ?? 'GET') === 'POST') {
        posts.push(path)
        // Hold the request open so BOTH clicks land while it is pending --
        // which is the only window the guard exists for. Awaiting the first
        // click lets it settle, and a second click after a completed round trip
        // is a second legitimate action, not a double submit.
        await inFlight
        return reply(makeRevision({ state: 'approved' }))
      }
      if (/\/teacher-profiles\/review\/[^/]+$/.test(path)) return reply(makeRevision())
      return reply({ revisions: [makeRevision()] })
    })

    renderWithProviders(<TeacherProfilesPage />, { staff: makeStaff({ role: 'admin' }) })
    await openReview(user)

    const approve = screen.getByRole('button', { name: 'Approve profile' })
    // Deliberately NOT awaited: two clicks in the same tick.
    void user.click(approve)
    void user.click(approve)

    await waitFor(() => expect(posts).toHaveLength(1))
    release()
    await waitFor(() => expect(posts).toHaveLength(1))
  })

  it('a revision that is no longer pending cannot be approved, and says so', async () => {
    const user = userEvent.setup()
    // The race: somebody else approved it between the list load and this open.
    routes({ detail: () => makeRevision({ state: 'approved', approvedAt: 'x' }) })
    renderWithProviders(<TeacherProfilesPage />, { staff: makeStaff({ role: 'admin' }) })
    await openReview(user)

    expect(screen.getByRole('button', { name: 'Approve profile' })).toBeDisabled()
    expect(
      screen.getByText('This revision is no longer awaiting a decision.'),
    ).toBeInTheDocument()
  })

  it('a server refusal is shown and the detail is refetched, not faked', async () => {
    const user = userEvent.setup()
    let detailCalls = 0
    fetchMock.mockImplementation(async (url: string | URL, init?: RequestInit) => {
      const path = String(url)
      const method = init?.method ?? 'GET'
      const reply = (d: unknown, status = 200) =>
        new Response(JSON.stringify(d), {
          status,
          headers: { 'content-type': 'application/json' },
        })

      if (method === 'POST') {
        return reply({ message: 'this revision is approved and is not awaiting a decision' }, 409)
      }
      if (/\/teacher-profiles\/review\/[^/]+$/.test(path)) {
        detailCalls += 1
        return reply(makeRevision())
      }
      return reply({ revisions: [makeRevision()] })
    })
    renderWithProviders(<TeacherProfilesPage />, { staff: makeStaff({ role: 'admin' }) })
    await openReview(user)

    const before = detailCalls
    await user.click(screen.getByRole('button', { name: 'Approve profile' }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    // Invalidated on failure too: the loser of a race must see what happened.
    await waitFor(() => expect(detailCalls).toBeGreaterThan(before))
    expect(screen.queryByText(/Profile approved/)).not.toBeInTheDocument()
  })
})

describe('request changes', () => {
  it('requires a note and posts it', async () => {
    const user = userEvent.setup()
    const bodies: unknown[] = []
    routes({
      onPost: (_path, body) => {
        bodies.push(body)
        return makeRevision({ state: 'changes_requested' })
      },
    })
    renderWithProviders(<TeacherProfilesPage />, { staff: makeStaff({ role: 'admin' }) })
    await openReview(user)

    await user.click(screen.getByRole('button', { name: 'Request changes' }))
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByText('Say what needs to change.')).toBeInTheDocument()
    expect(bodies).toHaveLength(0)

    await user.type(screen.getByLabelText('What needs to change?'), 'Add your ijazah.')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(bodies).toContainEqual({ note: 'Add your ijazah.' }))
    expect(await screen.findByText('Sent back to the teacher.')).toBeInTheDocument()
  })
})

describe('certificate files', () => {
  it('asks the API for a signed URL and opens exactly that, constructing nothing',
    async () => {
    const user = userEvent.setup()
    const open = vi.fn()
    vi.stubGlobal('open', open)
    routes({ download: () => ({ url: 'https://signed.example/abc?sig=xyz' }) })

    renderWithProviders(<TeacherProfilesPage />, { staff: makeStaff({ role: 'admin' }) })
    await openReview(user)

    const list = screen.getByRole('list', { name: 'Certificates' })
    await user.click(within(list).getByRole('button', { name: 'Open file' }))

    await waitFor(() => {
      expect(open).toHaveBeenCalledWith(
        'https://signed.example/abc?sig=xyz',
        '_blank',
        'noopener',
      )
    })
    // The download endpoint was called -- the URL was not assembled locally.
    const paths = fetchMock.mock.calls.map((c) => String(c[0]))
    expect(paths.some((p) => p.includes('/certificates/cert_1/download'))).toBe(true)
    expect(paths.every((p) => !p.includes('minio') && !p.includes('s3'))).toBe(true)
  })
})
