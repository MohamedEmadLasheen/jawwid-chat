import { Link } from 'react-router-dom'
import { C, useCopy } from './copy'

/** The payload of a case_escalated card (apps/api SupervisionCaseService.announce): ids and names only. */
export interface CaseEscalatedPayload {
  caseId: string
  ownerId: string | null
  ownerName: string | null
  openedBy: string
  openedByName: string
}

export function readCaseEscalatedCard(payload: Record<string, unknown> | null | undefined): CaseEscalatedPayload | null {
  if (!payload || typeof payload.caseId !== 'string' || typeof payload.openedBy !== 'string') return null
  return {
    caseId: payload.caseId,
    ownerId: typeof payload.ownerId === 'string' ? payload.ownerId : null,
    ownerName: typeof payload.ownerName === 'string' ? payload.ownerName : null,
    openedBy: payload.openedBy,
    openedByName: typeof payload.openedByName === 'string' ? payload.openedByName : '',
  }
}

/**
 * PD-35 B6: a case escalated to this department, in its room -- who opened it,
 * who owns it, and the way to it. Never its title or subject: Escalations shows
 * the case to those who may see it, and to no one else.
 */
export function CaseEscalatedCard({ payload }: { payload: CaseEscalatedPayload }) {
  const tx = useCopy()
  return (
    <span className="case-card">
      <span dir="auto">{tx(C.escalatedBy, { name: payload.openedByName })}</span>
      {payload.ownerName && (
        <span className="case-card__owner" dir="auto">
          {' '}
          {tx(C.ownerIs, { name: payload.ownerName })}
        </span>
      )}{' '}
      <Link className="case-card__link" to={`/cases?case=${encodeURIComponent(payload.caseId)}`}>
        {tx(C.openInEscalations)}
      </Link>
    </span>
  )
}
