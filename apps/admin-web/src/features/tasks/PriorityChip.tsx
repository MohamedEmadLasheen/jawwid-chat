import { Icon, type IconName } from '@/shared/components/Icon'
import type { Level, TaskSummary } from './api'
import { FINANCE, LEVEL_LABEL, useCopy } from './copy'
import { reasonOf } from './format'

const LEVEL_ICON: Record<Level, IconName> = { high: 'alert', medium: 'clock', low: 'chevronDown' }

/**
 * PD-47 priority amendment §4: never colour alone. An icon, the level's name
 * and, when something raised it, why. The icon is decoration; the text is the
 * chip's name. Drawn from what the server computed, never recomputed here.
 */
export function PriorityChip({ task }: { task: Pick<TaskSummary, 'effectivePriority' | 'priorityReason' | 'source'> }) {
  const tx = useCopy()
  const reason = reasonOf(task, tx)
  return (
    <span className={`task-level task-level--${task.effectivePriority}`} data-testid="task-level">
      <Icon name={LEVEL_ICON[task.effectivePriority]} size={14} />
      <span>{tx(LEVEL_LABEL[task.effectivePriority])}</span>
      {reason && <span className="task-level__reason">{' · '}{reason}</span>}
    </span>
  )
}

/** Beside the level on every financial task; neutral, so it never competes with the level's colour. */
export function FinanceTag() {
  const tx = useCopy()
  return (
    <span className="task-finance" data-testid="task-finance">
      <Icon name="banknote" size={14} />
      <span>{tx(FINANCE)}</span>
    </span>
  )
}
