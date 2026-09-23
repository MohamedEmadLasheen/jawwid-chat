import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CreateAnnouncementDialog } from './CreateAnnouncementDialog'
import { canOpenArea, visibleAreas } from '@/core/permissions/capabilities'
import { makeStaff, renderWithProviders, ROLES } from '@/test/utils'

/**
 * The announcement composer.
 *
 * What is under test is the SAFETY of a control that can address every parent
 * in the academy in one click: who may reach it, who may escalate it, and that
 * sending is never one accidental click away.
 *
 * These are affordances, not controls. The server refuses the same things, and
 * a database trigger refuses urgent again -- but an operator should see a
 * disabled control with an honest reason rather than typing an announcement and
 * discovering a 403.
 */
describe('who may reach announcements at all', () => {
  it('is offered to the roles that operate the academy', () => {
    for (const role of ['admin', 'manager', 'coverage'] as const) {
      expect(canOpenArea(role, 'announcements')).toBe(true)
    }
  })

  it('is never offered to a department role', () => {
    // Finance, technical and academic complete tasks. They never message
    // families, and they certainly never address the whole academy.
    for (const role of ['finance', 'technical', 'academic'] as const) {
      expect(canOpenArea(role, 'announcements')).toBe(false)
      expect(visibleAreas(role)).toEqual(['tasks'])
    }
  })

  it('covers every role, so a new one is a deliberate decision', () => {
    for (const role of ROLES) {
      expect(typeof canOpenArea(role, 'announcements')).toBe('boolean')
    }
  })
})

describe('urgent is rationed', () => {
  it('is offered to an admin', async () => {
    renderWithProviders(<CreateAnnouncementDialog onClose={vi.fn()} />, {
      staff: makeStaff({ role: 'admin' }),
    })

    const urgent = await screen.findByRole('option', { name: 'Urgent' })
    expect(urgent).not.toBeDisabled()
  })

  it('is offered to a manager', async () => {
    renderWithProviders(<CreateAnnouncementDialog onClose={vi.fn()} />, {
      staff: makeStaff({ role: 'manager' }),
    })

    const urgent = await screen.findByRole('option', { name: 'Urgent' })
    expect(urgent).not.toBeDisabled()
  })

  it('is disabled for a coverage lead, WITH the reason', async () => {
    renderWithProviders(<CreateAnnouncementDialog onClose={vi.fn()} />, {
      staff: makeStaff({ role: 'coverage' }),
    })

    // Urgent bypasses quiet hours and category mutes. Disabled and explained
    // beats hidden, which leaves the operator wondering, and beats enabled,
    // which turns a 403 into a surprise after they have typed.
    expect(await screen.findByRole('option', { name: 'Urgent' })).toBeDisabled()
    expect(
      screen.getByText('Only an admin or a manager may send an urgent announcement.'),
    ).toBeInTheDocument()
  })

  it('says what urgent actually does, in the operator’s own terms', async () => {
    renderWithProviders(<CreateAnnouncementDialog onClose={vi.fn()} />, {
      staff: makeStaff({ role: 'admin' }),
    })

    // Not "priority: urgent" -- what it costs the family.
    expect(
      await screen.findByText(/reaches families even during quiet hours/i),
    ).toBeInTheDocument()
  })
})

describe('an announcement cannot be sent by accident', () => {
  it('composing saves a DRAFT, never publishes', async () => {
    renderWithProviders(<CreateAnnouncementDialog onClose={vi.fn()} />, {
      staff: makeStaff({ role: 'admin' }),
    })

    // The only submit on this dialog. Publishing is a second, separate act on
    // the list: an announcement to every parent should not be sendable by
    // mistyping a form.
    expect(await screen.findByRole('button', { name: 'Save as draft' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Publish' })).not.toBeInTheDocument()
  })

  it('cannot be saved with no Arabic text', async () => {
    renderWithProviders(<CreateAnnouncementDialog onClose={vi.fn()} />, {
      staff: makeStaff({ role: 'admin' }),
    })

    // Arabic is the academy's language and the fallback for every locale that
    // has no translation, so an announcement without it renders as nothing.
    expect(await screen.findByRole('button', { name: 'Save as draft' })).toBeDisabled()
  })

  it('is enabled once the Arabic title and body are there', async () => {
    const user = userEvent.setup()
    renderWithProviders(<CreateAnnouncementDialog onClose={vi.fn()} />, {
      staff: makeStaff({ role: 'admin' }),
    })

    await user.type(await screen.findByLabelText('Title (Arabic)'), 'إجازة')
    await user.type(screen.getByLabelText('Message (Arabic)'), 'الأكاديمية مغلقة الجمعة.')

    expect(screen.getByRole('button', { name: 'Save as draft' })).toBeEnabled()
  })

  it('says English is optional rather than requiring a translation', async () => {
    renderWithProviders(<CreateAnnouncementDialog onClose={vi.fn()} />, {
      staff: makeStaff({ role: 'admin' }),
    })

    expect(
      await screen.findByText(/Families reading in English see the Arabic text/i),
    ).toBeInTheDocument()
  })
})

describe('the audience is named, never an id', () => {
  it('offers only audiences an operator can understand', async () => {
    renderWithProviders(<CreateAnnouncementDialog onClose={vi.fn()} />, {
      staff: makeStaff({ role: 'admin' }),
    })

    const audience = await screen.findByLabelText('Who receives this')
    const options = Array.from(audience.querySelectorAll('option')).map((o) => o.textContent)

    expect(options).toEqual(['All parents', 'All teachers', 'All staff'])
  })

  it('has no field that takes a raw identifier', async () => {
    renderWithProviders(<CreateAnnouncementDialog onClose={vi.fn()} />, {
      staff: makeStaff({ role: 'admin' }),
    })
    await screen.findByLabelText('Who receives this')

    // The API supports targeting specific families and learners; exposing an id
    // box for it would be the technical interface an operator should never be
    // handed. It waits for a picker.
    expect(screen.queryByLabelText(/id/i)).not.toBeInTheDocument()
  })
})

describe('expiry is explained in terms of what it does to a family', () => {
  it('says nothing already sent is withdrawn', async () => {
    renderWithProviders(<CreateAnnouncementDialog onClose={vi.fn()} />, {
      staff: makeStaff({ role: 'admin' }),
    })

    expect(
      await screen.findByText(/Nothing already sent is withdrawn/i),
    ).toBeInTheDocument()
  })
})
