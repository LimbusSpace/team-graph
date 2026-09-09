import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type {
  ActivityEvent,
  Dependency,
  Evidence,
  NewEvidenceInput,
  NewWorkItemInput,
  ProjectSnapshot,
  TeamMember,
  WorkItem,
  WorkStatus,
} from '../types'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: { persistSession: true },
      realtime: { params: { eventsPerSecond: 10 } },
    })
  : null

export function getSupabaseClient() {
  return supabase
}

type MemberRow = {
  id: string
  name: string
  initials: string
  role: string
  focus: string
  user_id: string | null
  git_emails: string[] | null
}

type WorkItemRow = {
  id: string
  title: string
  summary: string
  type: WorkItem['type']
  phase: string
  status: WorkStatus
  owner_ids: string[]
  acceptance_criteria: string
  weight: number
  lane: number
  updated_at: string
}

type DependencyRow = {
  source_id: string
  target_id: string
  kind: Dependency['kind']
}

type EvidenceRow = {
  id: string
  work_item_id: string
  actor_id: string
  title: string
  kind: Evidence['kind']
  url: string | null
  accepted: boolean
  created_at: string
}

type EventRow = {
  id: string
  actor_id: string
  action: ActivityEvent['action']
  work_item_id: string | null
  summary: string
  metadata: Record<string, unknown> | null
  created_at: string
}

function memberFromRow(row: MemberRow): TeamMember {
  return {
    id: row.id,
    name: row.name,
    initials: row.initials,
    role: row.role,
    focus: row.focus,
    userId: row.user_id,
    gitEmails: row.git_emails ?? [],
  }
}

function itemFromRow(row: WorkItemRow): WorkItem {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    type: row.type,
    phase: row.phase,
    status: row.status,
    ownerIds: row.owner_ids,
    acceptanceCriteria: row.acceptance_criteria,
    weight: Number(row.weight),
    lane: row.lane,
    updatedAt: row.updated_at,
  }
}

function dependencyFromRow(row: DependencyRow): Dependency {
  return { source: row.source_id, target: row.target_id, kind: row.kind }
}

function evidenceFromRow(row: EvidenceRow): Evidence {
  return {
    id: row.id,
    workItemId: row.work_item_id,
    actorId: row.actor_id,
    title: row.title,
    kind: row.kind,
    url: row.url ?? undefined,
    accepted: row.accepted,
    createdAt: row.created_at,
  }
}

function eventFromRow(row: EventRow): ActivityEvent {
  return {
    id: row.id,
    actorId: row.actor_id,
    action: row.action,
    workItemId: row.work_item_id ?? undefined,
    summary: row.summary,
    metadata: row.metadata ?? undefined,
    createdAt: row.created_at,
  }
}

export async function loadRemoteSnapshot(): Promise<ProjectSnapshot> {
  if (!supabase) throw new Error('Supabase 未配置')

  const [memberResult, itemResult, dependencyResult, evidenceResult, eventResult] = await Promise.all([
    supabase.from('team_members').select('*').order('name'),
    supabase.from('work_items').select('*').order('lane'),
    supabase.from('dependencies').select('*'),
    supabase.from('evidence').select('*').order('created_at', { ascending: false }),
    supabase.from('activity_events').select('*').order('created_at', { ascending: false }).limit(100),
  ])

  const firstError = [memberResult, itemResult, dependencyResult, evidenceResult, eventResult]
    .map((result) => result.error)
    .find(Boolean)
  if (firstError) throw firstError

  return {
    members: (memberResult.data as MemberRow[]).map(memberFromRow),
    items: (itemResult.data as WorkItemRow[]).map(itemFromRow),
    dependencies: (dependencyResult.data as DependencyRow[]).map(dependencyFromRow),
    evidence: (evidenceResult.data as EvidenceRow[]).map(evidenceFromRow),
    events: (eventResult.data as EventRow[]).map(eventFromRow),
    updatedAt: new Date().toISOString(),
  }
}

export function subscribeToProject(onChange: () => void) {
  if (!supabase) return () => undefined

  const channel = supabase
    .channel('team-graph-project')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'work_items' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'dependencies' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'evidence' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'activity_events' }, onChange)
    .subscribe()

  return () => {
    void supabase.removeChannel(channel)
  }
}

export async function createRemoteWorkItem(item: WorkItem, input: NewWorkItemInput) {
  if (!supabase) throw new Error('Supabase 未配置')

  const { error } = await supabase.from('work_items').insert({
    id: item.id,
    title: item.title,
    summary: item.summary,
    type: item.type,
    phase: item.phase,
    status: item.status,
    owner_ids: item.ownerIds,
    acceptance_criteria: item.acceptanceCriteria,
    weight: item.weight,
    lane: item.lane,
  })
  if (error) throw error

  if (input.prerequisiteIds.length > 0) {
    const dependencyResult = await supabase.from('dependencies').insert(
      input.prerequisiteIds.map((sourceId) => ({
        source_id: sourceId,
        target_id: item.id,
        kind: 'hard',
      })),
    )
    if (dependencyResult.error) throw dependencyResult.error
  }
}

export async function updateRemoteStatus(itemId: string, status: WorkStatus) {
  if (!supabase) throw new Error('Supabase 未配置')
  const { error } = await supabase.from('work_items').update({ status }).eq('id', itemId)
  if (error) throw error
}

export async function createRemoteEvidence(input: NewEvidenceInput) {
  if (!supabase) throw new Error('Supabase 未配置')
  const { error } = await supabase.from('evidence').insert({
    work_item_id: input.workItemId,
    actor_id: input.actorId,
    title: input.title,
    kind: input.kind,
    url: input.url || null,
  })
  if (error) throw error
}

export async function acceptRemoteEvidence(evidenceId: string) {
  if (!supabase) throw new Error('Supabase 未配置')
  const { error } = await supabase.from('evidence').update({ accepted: true }).eq('id', evidenceId)
  if (error) throw error
}
