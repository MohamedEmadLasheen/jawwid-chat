import type { Bilingual } from '@/features/admin/copy'
import type { IconName } from '@/shared/components/Icon'
import type { DashboardSectionKey } from './api'

/**
 * PD-44: what the Dashboard knows about each section and tile. The server
 * decides which tiles a person gets and what they count; this says only how
 * each is named and which page resolves it (plan §3, §4.4).
 *
 * A section is asked for only with the PD-40 key of the page its tiles link
 * to (the same key its route requires), so nobody is shown a section their
 * own account would be refused.
 */
export interface SectionSpec {
  key: DashboardSectionKey
  title: Bilingual
  requires: readonly string[]
}

export const SECTIONS: readonly SectionSpec[] = [
  { key: 'chats', title: { en: 'Chats', ar: 'المحادثات' }, requires: ['chat.use'] },
  { key: 'cases', title: { en: 'Escalation cases', ar: 'حالات التصعيد' }, requires: ['cases.view'] },
]

export interface TileSpec {
  label: Bilingual
  icon: IconName
  /** A backlog: above zero it wants doing, so it is marked. Informational counts never are. */
  backlog: boolean
  /** The page that resolves it, given the tile keys the section returned. */
  href: (present: ReadonlySet<string>) => string
}

export const TILES: Readonly<Record<string, TileSpec>> = {
  'chats.waiting': {
    label: { en: 'Chats waiting for our reply', ar: 'محادثات تنتظر ردّنا' },
    icon: 'conversations',
    backlog: true,
    href: () => '/chat?view=waiting',
  },
  'cases.mine_open': {
    label: { en: 'Cases assigned to me', ar: 'حالات مسندة إليّ' },
    icon: 'tasks',
    backlog: false,
    href: () => '/cases?tab=mine',
  },
  'cases.department_open': {
    label: { en: 'Open cases in the department', ar: 'حالات مفتوحة في القسم' },
    icon: 'tasks',
    backlog: false,
    href: () => '/cases?tab=department',
  },
  'cases.overdue': {
    label: { en: 'Cases past their due date', ar: 'حالات تجاوزت موعدها' },
    icon: 'clock',
    backlog: true,
    // Overdue counts the caller's own cases and their department's together:
    // the department list holds both for a manager, Mine for anyone else.
    href: (present) => (present.has('cases.department_open') ? '/cases?tab=department' : '/cases?tab=mine'),
  },
}

/** Without /me's keys (an API before PD-40) every section is asked for, and the server decides. */
export function sectionAllowed(spec: SectionSpec, permissions: readonly string[] | undefined): boolean {
  return !permissions || spec.requires.some((key) => permissions.includes(key))
}
