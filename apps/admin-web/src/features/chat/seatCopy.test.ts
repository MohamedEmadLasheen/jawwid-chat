import { describe, expect, it } from 'vitest'
import { chatCopy } from './copy'

// PD-35: a visible seat's lines. The server sends a role KEY, never wording.
describe('seat lines', () => {
  const en = chatCopy.en.system
  const ar = chatCopy.ar.system

  it('a seat taken names the person and their role, in both languages', () => {
    const p = { name: 'Ola Mahmoud', role: 'teacher_supervisor', reason: 'supervision' }
    expect(en['seat.joined'](p)).toBe('Ola Mahmoud (teacher supervisor) joined to support')
    expect(ar['seat.joined'](p)).toBe('انضم Ola Mahmoud (مشرف المعلمين) للمساندة')
    expect(en['seat.stepped_in']({ name: 'Laila Mansour', role: 'manager' })).toBe('Laila Mansour (manager) is following this chat')
  })

  it('a seat left says whether it went idle', () => {
    expect(en['seat.left']({ name: 'Ola Mahmoud', ended: 'left' })).toBe('Ola Mahmoud left')
    expect(en['seat.left']({ name: 'Ola Mahmoud', ended: 'idle' })).toBe('Ola Mahmoud left (no activity)')
    expect(ar['seat.left']({ name: 'Ola Mahmoud', ended: 'idle' })).toBe('غادر Ola Mahmoud (لا نشاط)')
  })

  it('an unknown role word shows the name alone; no name still reads as words', () => {
    expect(en['seat.joined']({ name: 'Ola', role: 'astronaut' })).toBe('Ola joined to support')
    expect(en['seat.left']({})).toBe('A team member left')
  })
})
