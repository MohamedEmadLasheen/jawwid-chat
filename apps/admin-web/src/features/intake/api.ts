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
  /** Entering opens once every existing family's parents are keyed (the contact-key backfill). */
  ready: boolean
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

/** PR-3: whether children just placed or added joined the family's live group. */
export type GroupJoin = 'joined' | 'none' | 'not_joined'

export interface StaffRef {
  id: string
  name: string | null
}

/** The parent's sign-up, as New Students shows it. */
export type ParentSignup =
  | { state: 'no_email' }
  | { state: 'not_started' }
  | { state: 'signed_up' }
  | { state: 'code_waiting'; code: string | null; issuedAt: string }

/** One family (or children) entered by hand, on New Students. No contact channel. */
export interface EnteredFamily {
  enrolmentId: string
  kind: 'new_family' | 'added_children'
  familyId: string
  contactId: string
  parentName: string | null
  children: Array<{ id: string; name: string | null }>
  enteredBy: StaffRef
  enteredAt: string
  supervisor: StaffRef | null
  needsOperationsSupervisor: boolean
  salesOwner: StaffRef | null
  suggestion: StaffRef | null
  groupConversationId: string | null
  parentSignup: ParentSignup
}

export interface EnteredList {
  viewer: IntakeStanding
  canAssignSupervisor: boolean
  families: EnteredFamily[]
}

/** The family as the Parent Profile reads it: its sign-in, its owners, what the viewer may do. */
export interface FamilyOwnership {
  familyId: string
  contactId: string
  signIn: boolean
  supervisor: StaffRef | null
  needsOperationsSupervisor: boolean
  salesOwner: StaffRef | null
  suggestion: StaffRef | null
  can: {
    setSignInEmail: boolean
    addChild: boolean
    suggestSupervisor: boolean
    assignOperationsSupervisor: boolean
    changeSalesOwner: boolean
  }
  supervisorChoices: Array<{ id: string; name: string }>
  salesOwnerChoices: Array<{ id: string; name: string }>
}

/** The Student Profile's "Current package": Core's numbers as entered, and what the viewer may do. */
export interface CarriedOverView {
  learnerId: string
  package: {
    total: number
    completed: number
    remaining: number
    planMonths: number | null
    enteredBy: StaffRef
    enteredAt: string
  } | null
  access: { state: string; balance: number } | null
  can: { carryOver: boolean; correct: boolean }
}

export const intakeKeys = {
  all: ['family-intake'] as const,
  options: ['family-intake', 'options'] as const,
  entered: ['family-intake', 'entered'] as const,
  family: (id: string) => ['family-intake', 'family', id] as const,
  carriedOver: (learnerId: string) => ['family-intake', 'carried-over', learnerId] as const,
}

const family = (id: string) => `/family-intake/families/${encodeURIComponent(id)}`
const learner = (id: string) => `/family-intake/learners/${encodeURIComponent(id)}`

export const intakeApi = {
  options: () => api.get<IntakeOptions>('/family-intake/options'),
  enter: (body: IntakeInput) => api.post<IntakeResult>('/family-intake', body),
  addChildren: (familyId: string, body: AddChildrenInput) => api.post<IntakeResult>(`${family(familyId)}/children`, body),
  /** New Students: the families entered by hand that this viewer owns. */
  entered: () => api.get<EnteredList>('/family-intake/entered'),
  family: (familyId: string) => api.get<FamilyOwnership>(family(familyId)),
  /** The Operations manager places a family waiting for its Operations supervisor. */
  assignSupervisor: (familyId: string, supervisorId: string) =>
    api.post<{ familyId: string; supervisorId: string; learnerIds: string[]; group: GroupJoin }>(`${family(familyId)}/operations-supervisor`, { supervisorId }),
  /** A Sales owner suggests one (D1); it places nothing. */
  suggestSupervisor: (familyId: string, supervisorId: string) =>
    api.post<{ familyId: string; supervisorId: string }>(`${family(familyId)}/supervisor-suggestion`, { supervisorId }),
  /** The Sales manager sets or changes the Sales owner. */
  changeSalesOwner: (familyId: string, body: { staffId: string; reason: string }) =>
    api.post<{ familyId: string; salesOwnerId: string; previousSalesOwnerId: string | null }>(`${family(familyId)}/sales-owner`, body),
  setSignInEmail: (familyId: string, email: string) =>
    api.post<{ familyId: string; contactId: string; accountId: string }>(`${family(familyId)}/sign-in-email`, { email }),
  carriedOver: (learnerId: string) => api.get<CarriedOverView>(`${learner(learnerId)}/carried-over`),
  carryOver: (learnerId: string, body: CarriedOverInput & { confirmOver?: boolean }) =>
    api.post<{ learnerId: string } & CarriedOverInput>(`${learner(learnerId)}/carried-over`, body),
  voidCarryOver: (learnerId: string, reason: string) =>
    api.post<{ learnerId: string; voided: boolean }>(`${learner(learnerId)}/carried-over/void`, { reason }),
}
