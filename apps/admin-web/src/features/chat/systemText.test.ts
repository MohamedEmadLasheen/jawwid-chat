import { describe, expect, it } from 'vitest'
import { chatCopyFor, systemText } from './copy'

/** PD-42 PR-3: a child added to the family joins its group -- the same words as the app. */
describe('group.learner_added', () => {
  it('names the child, in both languages, and reads generically without one', () => {
    const body = JSON.stringify({ kind: 'group.learner_added', learner: 'QA Learner B' })
    expect(systemText(body, chatCopyFor('en'))).toBe('QA Learner B joined this group')
    expect(systemText(body, chatCopyFor('ar'))).toBe('انضم QA Learner B إلى هذه المجموعة')
    expect(systemText(JSON.stringify({ kind: 'group.learner_added' }), chatCopyFor('en'))).toBe('A child joined this group')
    expect(systemText(JSON.stringify({ kind: 'group.learner_added' }), chatCopyFor('ar'))).toBe('انضم طفل إلى هذه المجموعة')
  })
})
