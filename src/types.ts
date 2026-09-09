export type WorkStatus =
  | 'planned'
  | 'ready'
  | 'in_progress'
  | 'review'
  | 'done'
  | 'blocked'

export type WorkType =
  | 'mission'
  | 'gate'
  | 'task'
  | 'experiment'
  | 'claim'
  | 'release'

export type DependencyKind = 'hard' | 'soft'

export interface TeamMember {
  id: string
  name: string
  initials: string
  role: string
  focus: string
  userId?: string | null
  gitEmails?: string[]
}

export interface WorkItem {
  id: string
  title: string
  summary: string
  type: WorkType
  phase: string
  status: WorkStatus
  ownerIds: string[]
  acceptanceCriteria: string
  weight: number
  lane: number
  updatedAt: string
}

export interface Dependency {
  source: string
  target: string
  kind: DependencyKind
}

export interface Evidence {
  id: string
  workItemId: string
  actorId: string
  title: string
  kind: 'document' | 'code' | 'experiment' | 'decision' | 'link'
  url?: string
  accepted: boolean
  createdAt: string
}

export interface ActivityEvent {
  id: string
  actorId: string
  action: 'item.created' | 'status.changed' | 'evidence.added' | 'evidence.accepted' | 'git.commit'
  workItemId?: string
  summary: string
  createdAt: string
  metadata?: Record<string, unknown>
}

export interface ProjectSnapshot {
  members: TeamMember[]
  items: WorkItem[]
  dependencies: Dependency[]
  evidence: Evidence[]
  events: ActivityEvent[]
  updatedAt: string
}

export interface NewWorkItemInput {
  title: string
  summary: string
  type: WorkType
  phase: string
  status: WorkStatus
  ownerIds: string[]
  acceptanceCriteria: string
  prerequisiteIds: string[]
}

export interface NewEvidenceInput {
  workItemId: string
  actorId: string
  title: string
  url?: string
  kind: Evidence['kind']
}

export type SyncState = 'local' | 'connecting' | 'live' | 'error'

export type GraphFilter = WorkStatus | 'all' | 'frontier' | 'pending_evidence'
