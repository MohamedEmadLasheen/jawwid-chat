import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'

// ADMIN-008: a language picked while signed in is remembered per account. Tests
// reuse staff ids, so one test's pick must not open the next test in its language.
afterEach(() => {
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith('jawwid.locale.account.')) localStorage.removeItem(key)
  } catch {
    // No storage: nothing was remembered.
  }
})
