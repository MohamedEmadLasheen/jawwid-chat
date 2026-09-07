import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AudiencePicker, describe as describeClause } from './AudiencePicker'
import type { AudienceClause } from '@/core/api/phase5'

/**
 * The composer's contract: it emits AUDIENCES, never recipients.
 *
 * These are UX tests. The authorization they mirror -- who may target what --
 * is proved against the API in `phase5-stories.spec.ts` and
 * `phase5-broadcast.spec.ts`, because a hidden option is not a control.
 */
function Harness({ canTargetEveryone = true }: { canTargetEveryone?: boolean }) {
  const [value, setValue] = useState<AudienceClause[]>([])
  return (
    <AudiencePicker
      value={value}
      onChange={setValue}
      labels={[{ id: 'label-1', name: 'Installments' }]}
      groups={[{ id: 'group-1', name: 'Thursday' }]}
      canTargetEveryone={canTargetEveryone}
    />
  )
}

describe('the audience picker', () => {
  it('combines several audiences, which is the normal case', async () => {
    // "Thursday families + the Installments label + the teachers" is the
    // example the product was specified against, not an edge case.
    const user = userEvent.setup()
    render(<Harness />)

    await user.selectOptions(screen.getByLabelText('Audience'), 'label')
    await user.selectOptions(screen.getByLabelText('Label'), 'label-1')
    await user.click(screen.getByRole('button', { name: 'Add audience' }))

    await user.selectOptions(screen.getByLabelText('Audience'), 'group')
    await user.selectOptions(screen.getByLabelText('Group'), 'group-1')
    await user.click(screen.getByRole('button', { name: 'Add audience' }))

    const chips = screen.getByRole('list', { name: 'Selected audiences' })
    expect(chips).toHaveTextContent('Label: Installments')
    expect(chips).toHaveTextContent('Group: Thursday')
  })

  it('adding the same audience twice is the same audience', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    for (let i = 0; i < 2; i += 1) {
      await user.selectOptions(screen.getByLabelText('Audience'), 'label')
      await user.selectOptions(screen.getByLabelText('Label'), 'label-1')
      await user.click(screen.getByRole('button', { name: 'Add audience' }))
    }

    const chips = screen.getAllByRole('listitem')
    expect(chips.filter((c) => c.textContent?.includes('Installments'))).toHaveLength(1)
  })

  it('an audience naming a record cannot be added without one', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.selectOptions(screen.getByLabelText('Audience'), 'label')
    // No label chosen: the server would answer 400, so the button is disabled.
    expect(screen.getByRole('button', { name: 'Add audience' })).toBeDisabled()
  })

  it('hides "all families" from a supervisor', async () => {
    // Presentation only -- the server refuses `all_families` from anyone
    // without an organization-wide role either way. What this prevents is an
    // operator composing an announcement against an option that will 403.
    render(<Harness canTargetEveryone={false} />)
    const select = screen.getByLabelText('Audience') as HTMLSelectElement
    const options = [...select.options].map((o) => o.value)

    expect(options).not.toContain('all_families')
    expect(options).not.toContain('all_teachers')
    expect(options).toContain('assigned_families')
  })

  it('an audience can be removed again', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.selectOptions(screen.getByLabelText('Audience'), 'group')
    await user.selectOptions(screen.getByLabelText('Group'), 'group-1')
    await user.click(screen.getByRole('button', { name: 'Add audience' }))
    await user.click(screen.getByRole('button', { name: 'Remove Group: Thursday' }))

    expect(screen.getByRole('list', { name: 'Selected audiences' })).toHaveTextContent(
      'No audience chosen yet.',
    )
  })
})

describe('describing a clause', () => {
  it('names the label and group rather than showing an id', () => {
    // An operator reviewing what went out must be able to read it. An id is
    // not a description of an audience.
    expect(
      describeClause({ kind: 'label', refId: 'label-1' }, [{ id: 'label-1', name: 'Installments' }], []),
    ).toBe('Label: Installments')
    expect(describeClause({ kind: 'all_families' }, [], [])).toBe('All families')
    expect(describeClause({ kind: 'assigned_families' }, [], [])).toBe('My families')
  })
})
