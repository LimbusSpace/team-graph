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
  /** commit SHA 或数据版本引用（代码证据必带） */
  ref?: string
  /** 证据来源：git-push / pr-merge / agent-cli / manual-cli / legacy */
  source?: string
  accepted: boolean
  /** 审计记录：人工确认必须可追溯（审计人、时间、意见、关联审查）。 */
  audit?: {
    decision: 'accepted' | 'declined'
    reviewerId?: string | null
    reviewedAt?: string
    note?: string | null
    reviewRef?: string | null
    legacy?: boolean
  }
  createdAt: string
}

export interface ActivityEvent {
  id: string
  actorId: string
  action:
    | 'item.created'
    | 'status.changed'
    | 'evidence.added'
    | 'evidence.accepted'
    | 'evidence.declined'
    | 'git.commit'
    | 'git.push'
    | 'pr.opened'
    | 'pr.merged'
    | 'handoff.recorded'
  workItemId?: string
  summary: string
  createdAt: string
  /** 业务事件身份（仓库+SHA+任务+动作 / PR 编号+动作），跨来源去重的依据。 */
  identity?: string
  metadata?: Record<string, unknown>
}

export interface ProjectSnapshot {
  members: TeamMember[]
  items: WorkItem[]
  dependencies: Dependency[]
  evidence: Evidence[]
  events: ActivityEvent[]
  updatedAt: string
  /** 事实源内容指纹（scripts/build-data.mjs 生成），前端据此判断数据版本。 */
  revision?: string
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
