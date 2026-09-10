import { hardDependentIds, hardDependencyIds, allowedActions, evidenceForItem, itemById } from './rules.mjs'
import { latestHandoff } from './store.mjs'

/**
 * Agent 的“任务上下文接口”。
 *
 * 默认只输出完成当前任务必需的内容：任务本身、直接硬依赖及其状态、
 * 证据计数摘要、允许的动作。不输出：无关成员与任务、全部下游依赖、
 * 历史活动流水、证据正文、前端展示字段。需要更多时用 include 显式展开。
 */
export function buildContext(facts, itemId, { include = [], revision, root } = {}) {
  const item = itemById(facts, itemId)
  if (!item) return null

  const itemsById = new Map(facts.items.map((candidate) => [candidate.id, candidate]))
  const evidence = evidenceForItem(facts, item.id)
  const approved = evidence.filter((entry) => entry.accepted).length
  const pending = evidence.filter((entry) => !entry.accepted && entry.audit?.decision !== 'declined').length
  const declined = evidence.filter((entry) => entry.audit?.decision === 'declined').length

  const context = {
    id: item.id,
    title: item.title,
    state: item.status,
    type: item.type,
    phase: item.phase,
    owners: item.ownerIds,
    acceptance: item.acceptanceCriteria,
    hard_dependencies: hardDependencyIds(item.id, facts.dependencies).map((id) => ({
      id,
      state: itemsById.get(id)?.status ?? 'unknown',
    })),
    unlocks: hardDependentIds(item.id, facts.dependencies),
    evidence_summary: { approved, pending, declined },
    allowed_actions: allowedActions(facts, item),
    updated_at: item.updatedAt,
    revision: revision ?? null,
  }

  if (item.summary) context.summary = item.summary
  if (item.relevantFiles?.length) context.relevant_files = item.relevantFiles

  const handoff = latestHandoff(root ?? facts.root, item.id)
  if (handoff) {
    context.latest_handoff = {
      file: handoff.file,
      actor: handoff.meta.actor ?? null,
      recorded_at: handoff.meta.recordedAt ?? null,
    }
  }

  if (include.includes('dependencies')) {
    context.dependencies_detail = {
      hard: context.hard_dependencies,
      soft: (item.dependsOn ?? [])
        .filter((dependency) => dependency.kind === 'soft')
        .map((dependency) => ({ id: dependency.id, state: itemsById.get(dependency.id)?.status ?? 'unknown' })),
    }
  }

  if (include.includes('evidence')) {
    context.evidence = evidence.map((entry) => ({
      id: entry.id,
      title: entry.title,
      kind: entry.kind,
      state: entry.accepted ? 'approved' : entry.audit?.decision === 'declined' ? 'declined' : 'pending',
      url: entry.url ?? null,
      ref: entry.ref ?? null,
      actor: entry.actorId,
      created_at: entry.createdAt,
      audit: entry.audit
        ? {
            decision: entry.audit.decision,
            reviewer: entry.audit.reviewerId ?? null,
            reviewed_at: entry.audit.reviewedAt ?? null,
            note: entry.audit.note ?? null,
          }
        : null,
    }))
  }

  if (include.includes('history')) {
    context.history = facts.events
      .filter((event) => event.workItemId === item.id)
      .slice(-30)
      .map((event) => ({
        id: event.id,
        action: event.action,
        actor: event.actorId,
        summary: event.summary,
        at: event.createdAt,
      }))
  }

  if (include.includes('handoff') && handoff) {
    context.handoff = { file: handoff.file, content: handoff.content }
  }

  return context
}
