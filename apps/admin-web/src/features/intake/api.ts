import { api } from '@/core/api/client'

/**
 * PD-42: entering families by hand -- the intake from Jawwid Core. The server
 * decides who may enter what (FamilyIntakeService, and the database again);
 * these are the shapes it speaks.
 */
export type IntakeStanding = 'super_admin' | 'operations_manager' | 'sales_manager' | 'operations_supervisor' | 'sales_member'

export interface IntakeOptions {
  standing: IntakeStanding
  /** May enter completed lessons above a package (the super admin, the Operations Manager, the Sales Manager). */
  manager: boolean
  /** For a manager: the supervisors they may enter a family for. */
  onBehalfOf: Array<{ id: string; name: string; kind: 'operations' | 'sales' }>
  teachers: Array<{ id: string; name: string }>
}

export interface CarriedOverInput {
  total: number
  completed: number
  planMonths: number | null
}

export interface IntakeChildInput {
  name: string
  teacherId?: string | null
  course?: string | null
  age?: number | null
  birthDate?: string | null
  schedule?: Array<{ weekday: number; time: string }>
  durationMinutes?: number
  carriedOver?: CarriedOverInput | null
}

export interface IntakeInput {
  intakeId: string
  parent: { name: string; phone?: string | null; email?: string | null; country?: string | null }
  children: IntakeChildInput[]
  onBehalfOf?: string | null
  confirmOver?: boolean
}

export interface AddChildrenInput {
  intakeId: string
  children: IntakeChildInput[]
  confirmDuplicate?: boolean
  confirmOver?: boolean
}

export interface IntakeResult {
  enrolmentId: string
  familyId: string
  contactId?: string
  learnerIds: string[]
  /** null on a replay: the first answer had it. */
  supervision: 'placed' | 'needs_operations_supervisor' | null
  salesOwnerId?: string | null
  schedules: Array<{ learnerId: string; set: boolean; reason: string | null }>
  replay: boolean
}

/** PARENT_EXISTS names the family only to who may handle it. */
export interface ParentExistsDetail {
  familyId: string
  contactId: string | null
  parentName: string | null
}

export const intakeKeys = {
  options: ['family-intake', 'options'] as const,
}

const family = (id: string) => `/family-intake/families/${encodeURIComponent(id)}`

export const intakeApi = {
  options: () => api.get<IntakeOptions>('/family-intake/options'),
  enter: (body: IntakeInput) => api.post<IntakeResult>('/family-intake', body),
  addChildren: (familyId: string, body: AddChildrenInput) => api.post<IntakeResult>(`${family(familyId)}/children`, body),
}
