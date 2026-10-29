import { within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'

/**
 * Pickers are SearchableSelect comboboxes, not <select>s, so user.selectOptions
 * does not reach them. These open the list the way a person does.
 */

/** `userEvent` itself or a `userEvent.setup()` instance. */
interface Driver {
  click: UserEvent['click']
  keyboard: (text: string) => Promise<unknown>
}

/** The open list of a combobox. */
export function listOf(combobox: HTMLElement): HTMLElement {
  const id = combobox.getAttribute('aria-controls')
  const list = id ? document.getElementById(id) : null
  if (!list) throw new Error('the combobox has no open list')
  return list
}

/** Opens the combobox and clicks the option whose value, or failing that visible label, is given. */
export async function chooseOption(user: Driver, combobox: HTMLElement, valueOrLabel: string): Promise<void> {
  if (combobox.getAttribute('aria-expanded') !== 'true') await user.click(combobox)
  const options = within(listOf(combobox)).getAllByRole('option')
  const option =
    options.find((o) => o.dataset.value === valueOrLabel) ?? options.find((o) => o.textContent?.trim() === valueOrLabel)
  if (!option) {
    throw new Error(`no option "${valueOrLabel}" in [${options.map((o) => `${o.dataset.value}=${o.textContent}`).join(', ')}]`)
  }
  await user.click(option)
}

/** The options' visible labels (and values), read by opening the list and closing it again. */
export async function optionsOf(user: Driver, combobox: HTMLElement): Promise<Array<{ value: string; label: string; disabled: boolean }>> {
  await user.click(combobox)
  const options = within(listOf(combobox))
    .queryAllByRole('option')
    .map((o) => ({ value: o.dataset.value ?? '', label: o.textContent?.trim() ?? '', disabled: o.getAttribute('aria-disabled') === 'true' }))
  await user.keyboard('{Escape}')
  return options
}
