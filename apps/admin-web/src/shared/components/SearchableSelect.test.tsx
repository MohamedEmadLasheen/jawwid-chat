import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/utils'
import { chooseOption, listOf } from '@/test/select'
import { Dialog } from './Dialog'
import { SearchableSelect, optionsFromChildren, type SelectOption } from './SearchableSelect'

/**
 * The owner's ask (2026-10-29): every list can be typed into as well as picked
 * from. One combobox serves every picker, so these pin its contract.
 */

const c = (...codes: number[]) => String.fromCharCode(...codes)
const AHMAD_HAMZA = c(0x623, 0x62d, 0x645, 0x62f)
const AHMAD_BARE = c(0x627, 0x62d, 0x645, 0x62f)

const FAMILIES = ['Abdelrahman family', 'Ali family', 'Amer family', 'Ashour family', 'Bakr family']

function Harness({
  onPick = () => undefined,
  initial = '',
  required = false,
  disabled = false,
  options,
}: {
  onPick?: (v: string) => void
  initial?: string
  required?: boolean
  disabled?: boolean
  options?: SelectOption[]
}) {
  const [value, setValue] = useState(initial)
  return (
    <form aria-label="form">
      <label htmlFor="fam">Family</label>
      <SearchableSelect
        id="fam"
        value={value}
        required={required}
        disabled={disabled}
        name="family"
        data-testid="family"
        options={options}
        onValueChange={(v) => {
          setValue(v)
          onPick(v)
        }}
      >
        <option value="">—</option>
        {FAMILIES.map((f, i) => (
          <option key={f} value={`f${i}`} disabled={f === 'Amer family'}>
            {f}
          </option>
        ))}
      </SearchableSelect>
    </form>
  )
}

const box = () => screen.getByRole('combobox', { name: 'Family' })
const shown = () => within(listOf(box())).queryAllByRole('option').map((o) => o.textContent)

describe('SearchableSelect', () => {
  it('is a labelled combobox that keeps the test id and exposes the value', () => {
    renderWithProviders(<Harness initial="f1" />)
    const input = box()
    expect(input).toBe(screen.getByTestId('family'))
    expect(input).toHaveValue('Ali family')
    expect(input).toHaveAttribute('data-value', 'f1')
    expect(input).toHaveAttribute('aria-expanded', 'false')
    expect(input).toHaveAttribute('aria-autocomplete', 'list')
    // The form posts the value, not the label.
    expect(screen.getByRole('form')).toHaveFormValues({ family: 'f1' })
  })

  it('opens on click with every option, the chosen one selected and active', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Harness initial="f1" />)
    await user.click(box())
    expect(box()).toHaveAttribute('aria-expanded', 'true')
    const list = screen.getByRole('listbox')
    expect(box()).toHaveAttribute('aria-controls', list.id)
    expect(shown()).toEqual(['—', ...FAMILIES])
    const ali = within(list).getByRole('option', { name: 'Ali family' })
    expect(ali).toHaveAttribute('aria-selected', 'true')
    expect(box()).toHaveAttribute('aria-activedescendant', ali.id)
    expect(within(list).getByRole('option', { name: 'Amer family' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('filters as you type, and picks with the mouse', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    renderWithProviders(<Harness onPick={onPick} />)
    await user.click(box())
    await user.keyboard('ash')
    expect(shown()).toEqual(['Ashour family'])
    await user.click(screen.getByRole('option', { name: 'Ashour family' }))
    expect(onPick).toHaveBeenCalledWith('f3')
    expect(box()).toHaveValue('Ashour family')
    expect(box()).toHaveAttribute('aria-expanded', 'false')
  })

  it('moves with the arrows, Home and End, skipping disabled options, and picks with Enter', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    renderWithProviders(<Harness onPick={onPick} />)
    box().focus()
    await user.keyboard('{ArrowDown}')
    const active = () => document.getElementById(box().getAttribute('aria-activedescendant')!)?.textContent
    expect(active()).toBe('—')
    await user.keyboard('{ArrowDown}{ArrowDown}')
    expect(active()).toBe('Ali family')
    await user.keyboard('{ArrowDown}')
    expect(active()).toBe('Ashour family') // Amer is disabled
    await user.keyboard('{End}')
    expect(active()).toBe('Bakr family')
    await user.keyboard('{Home}')
    expect(active()).toBe('—')
    await user.keyboard('{ArrowUp}')
    expect(active()).toBe('—') // no wrap
    await user.keyboard('{End}{Enter}')
    expect(onPick).toHaveBeenCalledWith('f4')
    expect(box()).toHaveValue('Bakr family')
  })

  it('Escape closes the list without closing the dialog, then closes the dialog', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    renderWithProviders(
      <Dialog title="New family group" onClose={onClose}>
        <Harness />
      </Dialog>,
    )
    await user.click(box())
    await user.keyboard('ali')
    await user.keyboard('{Escape}')
    expect(box()).toHaveAttribute('aria-expanded', 'false')
    expect(box()).toHaveValue('')
    expect(onClose).not.toHaveBeenCalled()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('stays open while the dialog around it re-renders (data arriving, a new inline onClose)', async () => {
    const user = userEvent.setup()
    let rerender: (n: number) => void = () => undefined
    function Parent() {
      const [n, setN] = useState(0)
      rerender = setN
      return (
        <Dialog title={`New family group ${n}`} onClose={() => undefined}>
          <Harness />
        </Dialog>
      )
    }
    renderWithProviders(<Parent />)
    await user.click(box())
    await user.keyboard('ali')
    act(() => rerender(1))
    expect(box()).toHaveFocus()
    expect(box()).toHaveAttribute('aria-expanded', 'true')
    expect(box()).toHaveValue('ali')
  })

  it('says so when nothing matches', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Harness />)
    await user.click(box())
    await user.keyboard('zzz')
    expect(shown()).toEqual([])
    expect(screen.getByRole('status')).toHaveTextContent('No matches')
    expect(box()).not.toHaveAttribute('aria-activedescendant')
    await user.keyboard('{Enter}')
    expect(box()).toHaveAttribute('data-value', '')
  })

  it('matches Arabic regardless of hamza spelling', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <Harness
        options={[
          { value: '', label: '—' },
          { value: 'a', label: `${AHMAD_HAMZA} Ali` },
          { value: 'b', label: 'Bakr', hint: 'bakr@example.test' },
        ]}
      />,
    )
    await user.click(box())
    await user.keyboard(AHMAD_BARE)
    expect(shown()).toEqual([`${AHMAD_HAMZA} Ali`])
    await user.clear(box())
    await user.keyboard('example')
    expect(shown()).toEqual(['Bakrbakr@example.test'])
  })

  it('clears the typed text, then the choice', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    renderWithProviders(<Harness initial="f1" onPick={onPick} />)
    await user.click(box())
    await user.keyboard('zz')
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(box()).toHaveValue('')
    expect(shown()).toHaveLength(FAMILIES.length + 1)
    expect(onPick).not.toHaveBeenCalled()
    await user.keyboard('{Escape}')
    expect(box()).toHaveValue('Ali family')
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(onPick).toHaveBeenCalledWith('')
  })

  it('is invalid while required and empty, and inert while disabled', async () => {
    const user = userEvent.setup()
    const { unmount } = renderWithProviders(<Harness required />)
    expect(box()).toHaveAttribute('aria-required', 'true')
    expect(box()).toBeInvalid()
    await chooseOption(user, box(), 'f0')
    expect(box()).toBeValid()
    unmount()

    renderWithProviders(<Harness disabled initial="f1" />)
    expect(box()).toBeDisabled()
    await user.click(box())
    expect(box()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull()
  })

  it('follows the page direction in Arabic and labels its buttons in Arabic', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Harness initial="f1" />, { locale: 'ar' })
    expect(document.documentElement.dir).toBe('rtl')
    await user.click(box())
    expect(listOf(box()).parentElement).toHaveAttribute('dir', 'rtl')
    await user.keyboard('zzz')
    expect(screen.getByRole('status')).toHaveTextContent('لا توجد نتائج مطابقة')
    expect(screen.getByRole('button', { name: 'مسح' })).toBeInTheDocument()
  })

  it('asks the server, debounced, when the list is server-backed, and shows its answer unfiltered', async () => {
    vi.useFakeTimers()
    try {
      const onSearch = vi.fn()
      function Server() {
        const [value, setValue] = useState('')
        const [options, setOptions] = useState<SelectOption[]>([{ value: 's1', label: 'Staff One' }])
        return (
          <SearchableSelect
            aria-label="Staff"
            value={value}
            onValueChange={setValue}
            options={options}
            onSearch={(q) => {
              onSearch(q)
              setOptions([{ value: 's9', label: 'Server Match', hint: 'matched by phone' }])
            }}
          />
        )
      }
      renderWithProviders(<Server />)
      const input = screen.getByRole('combobox', { name: 'Staff' })
      fireEvent.click(input)
      fireEvent.change(input, { target: { value: '0100' } })
      fireEvent.change(input, { target: { value: '01001' } })
      expect(onSearch).not.toHaveBeenCalled()
      act(() => vi.advanceTimersByTime(300))
      expect(onSearch).toHaveBeenCalledTimes(1)
      expect(onSearch).toHaveBeenCalledWith('01001')
      // '01001' matches nothing on the client, but the server's answer is shown as given.
      expect(within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.dataset.value)).toEqual(['s9'])
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('optionsFromChildren', () => {
  it('reads options through arrays, fragments and conditionals, numbers as text', () => {
    const show = false
    expect(
      optionsFromChildren(
        <>
          <option value="">All</option>
          {[1, 2].map((n) => (
            <option key={n} value={n}>
              Week {n}
            </option>
          ))}
          {show && <option value="x">hidden</option>}
          <option value="d" disabled data-hint="note">
            Disabled
          </option>
        </>,
      ),
    ).toEqual([
      { value: '', label: 'All', hint: undefined, disabled: undefined },
      { value: '1', label: 'Week 1', hint: undefined, disabled: undefined },
      { value: '2', label: 'Week 2', hint: undefined, disabled: undefined },
      { value: 'd', label: 'Disabled', hint: 'note', disabled: true },
    ])
  })
})
