import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, makeStaff, ROLES } from '@/test/utils'
import { TeacherProfilesPage } from './TeacherProfilesPage'
import type { CertificateReviewItem, ReviewCertificate } from '@/core/api/endpoints'
import { visibleAreas } from '@/core/permissions/capabilities'

/**
 * Teacher CREDENTIAL review.
 *
 * These are UI-CONTRACT tests, not security tests. Every DENY in this feature is
 * proven against the API and the database
 * (apps/api/test/integration/teacher-profile.spec.ts,
 * db/tests/teacher_profile_rls.sql), because a hidden button is not a control.
 *
 * WHAT V2 REMOVED, and why this file shrank: profile-level review. A teacher
 * owns their professional profile and publishes it by saving it, so there is no
 * revision to open, no profile to approve and no changes to request. The console
 * reviews CREDENTIALS, because a document claiming a qualification is not
 * verified by having been uploaded.
 *
 * What is asserted here is that the console does not LIE: it never claims a
 * decision landed when the request failed, never renders an identifier a
 * reviewer has no business seeing, and never constructs a storage URL of its
 * own.
 */

function makeCertificate(over: Partial<ReviewCertificate> = {}): ReviewCertificate {
  return {
    id: 'cert_1',
    title: 'Ijazah in Tajweed',
    issuingOrganization: 'Al-Azhar',
    issuedOn: '2019-06-01T00:00:00Z',
    state: 'pending',
    reviewNote: null,
    mimeType: 'application/pdf',
    byteSize: 1000,
    ...over,
  }
}

function makeItem(over: Partial<CertificateReviewItem> = {}): CertificateReviewItem {
  const certificates = over.certificates ?? [makeCertificate()]
  return {
    profileId: 'prof_1',
    teacherName: 'Ahmed Al-Masri',
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
      return reply(result ?? makeItem())
    }
    if (path.includes('/download')) {
      return reply(handlers.download?.() ?? { url: 'https://signed.example/f' })
    }
    if (path.includes('/teacher-profiles/review')) {
      return reply(handlers.list?.() ?? { profiles: [makeItem()] })
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

describe('navigation', () => {
  it('every operator role may open the area, and no department role may', () => {
    // The SAME set the server uses (canReviewTeacherProfile): the family-facing
    // staff and, under PD-8, the super admin. No new permission.
    for (const role of ROLES) {
      const areas = visibleAreas(role)
      const operator = role === 'admin' || role === 'coverage' || role === 'manager' || role === 'super_admin'
      expect(areas.includes('teacher-profiles')).toBe(operator)
    }
  })
})

describe('the review queue', () => {
  it('lists a teacher with their pending credentials', async () => {
    routes({})
    renderWithProviders(<TeacherProfilesPage />, { staff: makeStaff({ role: 'admin' }) })

    expect(await screen.findByText('Ahmed Al-Masri')).toBeInTheDocument()
    expect(screen.getByText('Ijazah in Tajweed')).toBeInTheDocument()
    expect(screen.getByText('Awaiting decision')).toBeInTheDocument()
  })

  it('flags how many credentials still need a decision', async () => {
    routes({
      list: () => ({
        profiles: [
          makeItem({
            certificates: [
              makeCertificate({ id: 'a', title: 'One', state: 'pending' }),
              makeCertificate({ id: 'b', title: 'Two', state: 'pending' }),
              makeCertificate({ id: 'c', title: 'Three', state: 'approved' }),
            ],
          }),
        ],
      }),
    })
    renderWithProviders(<TeacherProfilesPage />, { staff: makeStaff({ role: 'admin' }) })

    expect(await screen.findByText(/^2 ·/)).toBeInTheDocument()
  })

  it('shows an empty state when nothing is waiting', async () => {
    routes({ list: () => ({ profiles: [] }) })
    renderWithProviders(<TeacherProfilesPage />, { staff: makeStaff({ role: 'admin' }) })

    expect(await screen.findByText('Nothing is waiting for review.')).toBeInTheDocument()
  })

  it('surfaces an error and retries', async () => {
    const user = userEvent.setup()
    let attempt = 0
    fetchMock.mockImplementation(async () => {
      attempt += 1
      if (attempt === 1) {
        return new Response(JSON.stringify({ error: { message: 'boom' } }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ profiles: [makeItem()] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    renderWithProviders(<TeacherProfilesPage />, { staff: makeStaff({ role: 'admin' }) })

    const retry = await screen.findByRole('button', { name: /retry|try again/i })
    await user.click(retry)
    expect(await screen.findByText('Ahmed Al-Masri')).toBeInTheDocument()
  })

  it('renders NO profile id, reviewer id, object key or storage path', async () => {
    routes({})
    const { container } = renderWithProviders(<TeacherProfilesPage />, {
      staff: makeStaff({ role: 'admin' }),
    })
    await screen.findByText('Ahmed Al-Masri')

    const html = container.innerHTML
    expect(html).not.toContain('prof_1')
    expect(html).not.toContain('objectKey')
    expect(html).not.toContain('teacher-certificates/')
    expect(html).not.toContain('reviewedBy')
  })
})

describe('there is no profile approval left', () => {
  it('offers no Approve profile and no Request changes', async () => {
    routes({})
    renderWithProviders(<TeacherProfilesPage />, { staff: makeStaff({ role: 'admin' }) })
    await screen.findByText('Ahmed Al-Masri')

    expect(screen.queryByRole('button', { name: 'Approve profile' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Request changes' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Review' })).toBeNull()
  })

  it('renders no profile content fields -- the console does not review words', async () => {
    routes({})
    renderWithProviders(<TeacherProfilesPage />, { staff: makeStaff({ role: 'admin' }) })
    await screen.findByText('Ahmed Al-Masri')

    for (const label of ['Bio', 'Specialization', 'Qualifications', 'Experience']) {
      expect(screen.queryByText(new RegExp(`^${label}:`))).toBeNull()
    }
  })

  it('never posts to an approve or request-changes endpoint', async () => {
    const user = userEvent.setup()
    const posts: string[] = []
    routes({
      onPost: (path) => {
        posts.push(path)
        return makeItem()
      },
    })
    renderWithProviders(<TeacherProfilesPage />, { staff: makeStaff({ role: 'admin' }) })
    await screen.findByText('Ahmed Al-Masri')

    await user.click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(posts.length).toBe(1))
    expect(posts[0]).toContain('/certificates/cert_1/decide')
    expect(posts.some((p) => p.includes('/approve') || p.includes('request-changes'))).toBe(
      false,
    )
  })
})

describe('certificate decisions', () => {
  it('approving one calls the API and refetches', async () => {
    const user = userEvent.setup()
    const bodies: unknown[] = []
    routes({
      onPost: (_path, body) => {
        bodies.push(body)
        return makeItem({ certificates: [makeCertificate({ state: 'approved' })] })
      },
    })
    renderWithProviders(<TeacherProfilesPage />, { staff: makeStaff({ role: 'admin' }) })
    await screen.findByText('Ahmed Al-Masri')

    await user.click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(bodies).toEqual([{ approved: true, note: undefined }]))
  })

  it('rejecting one collects a note, and refuses an empty one', async () => {
    const user = userEvent.setup()
    const bodies: unknown[] = []
    routes({
      onPost: (_path, body) => {
        bodies.push(body)
        return makeItem()
      },
    })
    renderWithProviders(<TeacherProfilesPage />, { staff: makeStaff({ role: 'admin' }) })
    await screen.findByText('Ahmed Al-Masri')

    await user.click(screen.getByRole('button', { name: 'Reject' }))
    await user.click(screen.getByRole('button', { name: 'Send' }))

    // Refused locally, so the reviewer is told before the round trip.
    expect(await screen.findByText('Say why it is not accepted.')).toBeInTheDocument()
    expect(bodies).toEqual([])

    await user.type(screen.getByLabelText('Why is it not accepted?'), 'Unreadable scan')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() =>
      expect(bodies).toEqual([{ approved: false, note: 'Unreadable scan' }]),
    )
  })

  it('shows the server error when a decision is refused', async () => {
    const user = userEvent.setup()
    routes({
      onPost: () =>
        new Response(
          JSON.stringify({ error: { code: 'COMM.TEACHER_PROFILE_CANNOT_REVIEW', message: 'refused' } }),
          { status: 403, headers: { 'content-type': 'application/json' } },
        ),
    })
    renderWithProviders(<TeacherProfilesPage />, { staff: makeStaff({ role: 'admin' }) })
    await screen.findByText('Ahmed Al-Masri')

    await user.click(screen.getByRole('button', { name: 'Approve' }))
    // The server's words, not a cheerful local guess.
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  it('a rejected credential shows the reviewer note', async () => {
    routes({
      list: () => ({
        profiles: [
          makeItem({
            certificates: [
              makeCertificate({ state: 'rejected', reviewNote: 'Unreadable scan' }),
            ],
          }),
        ],
      }),
    })
    renderWithProviders(<TeacherProfilesPage />, { staff: makeStaff({ role: 'admin' }) })

    expect(await screen.findByText('Unreadable scan')).toBeInTheDocument()
    expect(screen.getByText('Rejected')).toBeInTheDocument()
  })
})

describe('certificate files', () => {
  it('asks the API for a signed URL and opens exactly that, constructing nothing',
    async () => {
      const user = userEvent.setup()
      const opened: unknown[] = []
      vi.stubGlobal('open', (url: string) => {
        opened.push(url)
        return null
      })
      routes({ download: () => ({ url: 'https://signed.example/one-time?sig=abc' }) })
      renderWithProviders(<TeacherProfilesPage />, { staff: makeStaff({ role: 'admin' }) })
      await screen.findByText('Ahmed Al-Masri')

      await user.click(screen.getByRole('button', { name: 'Open file' }))
      await waitFor(() =>
        expect(opened).toEqual(['https://signed.example/one-time?sig=abc']),
      )
    })

  it('asks again on every open, so no grant is held', async () => {
    const user = userEvent.setup()
    let issued = 0
    vi.stubGlobal('open', () => null)
    routes({
      download: () => {
        issued += 1
        return { url: `https://signed.example/${issued}` }
      },
    })
    renderWithProviders(<TeacherProfilesPage />, { staff: makeStaff({ role: 'admin' }) })
    await screen.findByText('Ahmed Al-Masri')

    const open = screen.getByRole('button', { name: 'Open file' })
    await user.click(open)
    await waitFor(() => expect(issued).toBe(1))
    await user.click(open)
    await waitFor(() => expect(issued).toBe(2))
  })
})

describe('several teachers in the queue', () => {
  it('keeps each teacher’s credentials under their own name', async () => {
    routes({
      list: () => ({
        profiles: [
          makeItem({
            profileId: 'p1',
            teacherName: 'Teacher One',
            certificates: [makeCertificate({ id: 'a', title: 'First cert' })],
          }),
          makeItem({
            profileId: 'p2',
            teacherName: 'Teacher Two',
            certificates: [makeCertificate({ id: 'b', title: 'Second cert' })],
          }),
        ],
      }),
    })
    renderWithProviders(<TeacherProfilesPage />, { staff: makeStaff({ role: 'admin' }) })
    await screen.findByText('Teacher One')

    const rows = screen.getAllByRole('listitem')
    const first = rows.find((r) => r.textContent?.includes('Teacher One'))!
    expect(within(first).getByText('First cert')).toBeInTheDocument()
    expect(within(first).queryByText('Second cert')).toBeNull()
  })
})
