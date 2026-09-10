/**
 * 状态机 + 审计门槛 + 全图校验。
 *
 * 这里是唯一的状态规则实现：
 * - task.mjs（Agent / 人工操作入口）用它做前置校验；
 * - build-data.mjs 用它做全图一致性校验；
 * - update-github-state / reconcile / polyhook 用它做 Git 事件 → 状态推进。
 * 前端 src/lib/graph.ts 只做展示计算，不维护第二套规则。
 */

export const STATUSES = ['planned', 'ready', 'in_progress', 'review', 'done', 'blocked']

export const ITEM_TYPES = ['mission', 'gate', 'task', 'experiment', 'claim', 'release']

export const EVIDENCE_KINDS = ['document', 'code', 'experiment', 'decision', 'link']

export const STATUS_LABELS = {
  planned: '等待',
  ready: '可开工',
  in_progress: '进行中',
  review: '待审计',
  done: '已验证',
  blocked: '受阻',
}

/** 人工可执行的状态迁移。done 不是普通迁移：必须走审计确认（见 evaluateTransition）。 */
const MANUAL_TRANSITIONS = {
  planned: ['ready', 'in_progress', 'blocked'],
  ready: ['planned', 'in_progress', 'blocked'],
  in_progress: ['review', 'ready', 'blocked'],
  review: ['done', 'in_progress', 'blocked'],
  done: ['review'],
  blocked: ['planned', 'ready', 'in_progress'],
}

/**
 * 不同任务类型不能共用同一套 Git 推进规则：
 * - 代码任务/发布：push 可以开工，PR 合并进入待审计；
 * - 实验：脚本合并不代表实验已执行，合并只生成候选证据；
 * - 论点：相关代码合并不代表论点已验证，同样只生成证据；
 * - 决策门：需要人工签字，合并不自动推进；
 * - mission：只做展示锚点，自动流程完全不动它。
 */
export function mergePolicy(type) {
  return {
    locked: type === 'mission',
    autoStart: type !== 'mission',
    autoReview: type === 'task' || type === 'release',
    evidenceOnlyMerge: type === 'experiment' || type === 'claim' || type === 'gate',
  }
}

export function hardDependencyIds(itemId, dependencies) {
  return dependencies
    .filter((dependency) => dependency.target === itemId && dependency.kind === 'hard')
    .map((dependency) => dependency.source)
}

export function hardDependentIds(itemId, dependencies) {
  return dependencies
    .filter((dependency) => dependency.source === itemId && dependency.kind === 'hard')
    .map((dependency) => dependency.target)
}

export function itemById(facts, itemId) {
  return facts.items.find((item) => item.id === itemId)
}

export function evidenceForItem(facts, itemId) {
  return facts.evidence.filter((entry) => entry.workItemId === itemId)
}

export function unmetHardDependencies(facts, item) {
  return hardDependencyIds(item.id, facts.dependencies)
    .map((id) => itemById(facts, id))
    .filter((candidate) => candidate && candidate.status !== 'done')
}

export function isOpenFrontier(item, facts) {
  if (item.status === 'done' || item.status === 'blocked') return false
  return unmetHardDependencies(facts, item).length === 0
}

/** 该任务当前允许 Agent / 人工执行的动作（写入 task context 的 allowed_actions）。 */
export function allowedActions(facts, item) {
  if (item.status === 'done') return ['view', 'reopen_via_audit']
  if (item.status === 'review') return ['add_evidence', 'audit_accept', 'audit_decline']
  if (item.status === 'blocked') return ['view', 'add_evidence', 'unblock']
  if (item.status === 'in_progress') return ['add_evidence', 'submit_audit', 'block']
  return ['start', 'add_evidence', 'block']
}

function fail(code, message, extra = {}) {
  return { ok: false, code, message, ...extra }
}

/**
 * 状态迁移的唯一裁判。程序直接拒绝非法操作并给出结构化错误，
 * Agent 不需要（也不允许）自己推理这些规则。
 */
export function evaluateTransition(facts, item, to, { reviewerId } = {}) {
  const from = item.status

  if (!STATUSES.includes(to)) return fail('UNKNOWN_STATUS', `未知状态：${to}`)
  if (mergePolicy(item.type).locked) {
    return fail('TYPE_LOCKED', `${item.type} 类型节点不接受自动状态推进，请在 data/items/${item.id}.json 中人工修改。`)
  }
  if (from === to) return { ok: true, noop: true }

  // 先判结构（这条边是否存在），再判门槛（这条边上的条件），
  // 这样 Agent 拿到的错误总是“先修路径，再补条件”。
  if (!MANUAL_TRANSITIONS[from]?.includes(to)) {
    return fail('INVALID_TRANSITION', `不允许从 ${from} 直接迁移到 ${to}。`, {
      allowed: MANUAL_TRANSITIONS[from] ?? [],
    })
  }

  if (to === 'review') {
    const usable = evidenceForItem(facts, item.id).filter((entry) => entry.audit?.decision !== 'declined')
    if (usable.length === 0) {
      return fail('NO_EVIDENCE', '进入待审计前至少要有一条证据。请先运行 task evidence add。')
    }
  }

  if (to === 'done') {
    if (!reviewerId) return fail('REVIEWER_REQUIRED', '完成节点必须记录审计人：--reviewer <memberId>。')
    const blocking = unmetHardDependencies(facts, item).map((candidate) => candidate.id)
    if (blocking.length > 0) {
      return fail('HARD_DEPENDENCY_OPEN', '硬依赖未全部完成。', { blocking })
    }
    const approved = evidenceForItem(facts, item.id).filter((entry) => entry.accepted)
    if (approved.length === 0) {
      return fail('NO_ACCEPTED_EVIDENCE', '至少需要一条通过审计的证据才能完成节点。')
    }
  }

  return { ok: true }
}

/** 事件动作类型（也是 src/types.ts 中 ActivityEvent.action 的超集）。 */
export const EVENT_ACTIONS = [
  'item.created',
  'status.changed',
  'evidence.added',
  'evidence.accepted',
  'evidence.declined',
  'git.commit',
  'git.push',
  'pr.opened',
  'pr.merged',
  'handoff.recorded',
]

/**
 * 全图一致性校验。拆文件之后跨任务约束在这里整体兜底，
 * 这是 CI 的验收入口（node scripts/task.mjs validate）。
 */
export function validateGraph(facts) {
  const errors = []
  const warnings = []
  const itemsById = new Map(facts.items.map((item) => [item.id, item]))
  const memberIds = new Set(facts.project.members.map((member) => member.id))
  const evidenceIds = new Set()

  for (const item of facts.items) {
    if (!/^RG-\d{3,}$/.test(item.id)) errors.push(`任务 ID 不合法：${item.id}`)
    if (!item.title) errors.push(`${item.id} 缺少标题`)
    if (!ITEM_TYPES.includes(item.type)) errors.push(`${item.id} 的 type 不合法：${item.type}`)
    if (!STATUSES.includes(item.status)) errors.push(`${item.id} 的 status 不合法：${item.status}`)
    if (!(item.weight > 0)) errors.push(`${item.id} 的 weight 必须大于 0`)
    if (!Number.isInteger(item.lane)) errors.push(`${item.id} 的 lane 必须是整数`)
    if (!Array.isArray(item.ownerIds) || item.ownerIds.length === 0) {
      errors.push(`${item.id} 没有负责人`)
    }
    for (const ownerId of item.ownerIds ?? []) {
      if (!memberIds.has(ownerId)) errors.push(`${item.id} 的负责人不存在：${ownerId}`)
    }
    if (!item.acceptanceCriteria) errors.push(`${item.id} 缺少验收标准`)
    for (const dependency of item.dependsOn ?? []) {
      if (dependency.id === item.id) errors.push(`${item.id} 依赖自身`)
      if (!itemsById.has(dependency.id)) errors.push(`${item.id} 依赖不存在的任务：${dependency.id}`)
      if (dependency.kind !== 'hard' && dependency.kind !== 'soft') {
        errors.push(`${item.id} 的依赖类型不合法：${dependency.kind}`)
      }
    }
    if (item.status === 'done') {
      const blocking = unmetHardDependencies(facts, item).map((candidate) => candidate.id)
      if (blocking.length > 0) errors.push(`${item.id} 已完成但硬依赖未完成：${blocking.join(', ')}`)
      const approved = evidenceForItem(facts, item.id).filter((entry) => entry.accepted)
      if (approved.length === 0) errors.push(`${item.id} 已完成但没有通过审计的证据`)
    }
  }

  for (const entry of facts.evidence) {
    if (evidenceIds.has(entry.id)) errors.push(`证据 ID 重复：${entry.id}`)
    evidenceIds.add(entry.id)
    if (!itemsById.has(entry.workItemId)) errors.push(`证据 ${entry.id} 指向不存在的任务：${entry.workItemId}`)
    if (!EVIDENCE_KINDS.includes(entry.kind)) errors.push(`证据 ${entry.id} 的 kind 不合法：${entry.kind}`)
    if (!entry.actorId || !memberIds.has(entry.actorId)) errors.push(`证据 ${entry.id} 的提交人不存在：${entry.actorId}`)
    if (entry.accepted) {
      const audit = entry.audit
      if (!audit || audit.decision !== 'accepted') {
        errors.push(`证据 ${entry.id} 标记为通过但缺少审计记录`)
      } else if (!audit.reviewerId) {
        if (audit.legacy) {
          warnings.push(`证据 ${entry.id} 是历史迁移数据，审计人未记录`)
        } else {
          errors.push(`证据 ${entry.id} 通过审计但缺少审计人（不可追溯）`)
        }
      }
    }
  }

  const seenEventIds = new Set()
  for (const event of facts.events) {
    if (seenEventIds.has(event.id)) errors.push(`活动 ID 重复：${event.id}`)
    seenEventIds.add(event.id)
    if (event.workItemId && !itemsById.has(event.workItemId)) {
      warnings.push(`活动 ${event.id} 指向不存在的任务：${event.workItemId}`)
    }
    if (event.actorId && !memberIds.has(event.actorId)) {
      warnings.push(`活动 ${event.id} 的成员不存在：${event.actorId}`)
    }
  }

  const adjacency = new Map(facts.items.map((item) => [item.id, []]))
  const indegree = new Map(facts.items.map((item) => [item.id, 0]))
  for (const dependency of facts.dependencies) {
    if (dependency.kind !== 'hard') continue
    if (!adjacency.has(dependency.source) || !adjacency.has(dependency.target)) continue
    adjacency.get(dependency.source).push(dependency.target)
    indegree.set(dependency.target, indegree.get(dependency.target) + 1)
  }
  const queue = [...indegree.entries()].filter(([, degree]) => degree === 0).map(([id]) => id)
  let visited = 0
  while (queue.length > 0) {
    const current = queue.shift()
    visited += 1
    for (const target of adjacency.get(current) ?? []) {
      const next = indegree.get(target) - 1
      indegree.set(target, next)
      if (next === 0) queue.push(target)
    }
  }
  if (visited !== facts.items.length) errors.push('硬依赖图存在环')

  return { ok: errors.length === 0, errors, warnings }
}
