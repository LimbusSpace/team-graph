#!/usr/bin/env node
import { loadFacts, hashFacts, saveItem, saveEvidence, recordEvent, saveHandoff, latestHandoff, ensureDirs } from './lib/store.mjs'
import { rebuildDerived } from './lib/derived.mjs'
import { buildContext } from './lib/context.mjs'
import { applyPush } from './lib/github.mjs'
import {
  STATUS_LABELS,
  ITEM_TYPES,
  EVIDENCE_KINDS,
  evaluateTransition,
  itemById,
  isOpenFrontier,
  validateGraph,
} from './lib/rules.mjs'
import { repoRoot } from './lib/paths.mjs'
import { createHash } from 'node:crypto'

/**
 * Agent / 人工统一的任务操作入口。
 *
 * 设计约束：
 * - `task context RG-xxx` 只输出完成当前任务必需的内容，不读全量任务图；
 * - 所有修改输出短回执 {ok, id, changed, next}，不回显整个项目；
 * - 状态规则、审计门槛在这里集中校验，程序直接拒绝非法操作；
 * - 写入完成后自动重建 public/data 派生产物，保持口径一致。
 *
 * 用法：node scripts/task.mjs <command> [args] [flags]
 */

const root = repoRoot()
const [, , command, ...rest] = process.argv

function parseFlags(args) {
  const flags = { _: [] }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const next = args[index + 1]
      const value = next === undefined || next.startsWith('--') ? true : next
      if (value !== true) index += 1
      if (key in flags) {
        flags[key] = Array.isArray(flags[key]) ? [...flags[key], value] : [flags[key], value]
      } else {
        flags[key] = value
      }
    } else {
      flags._.push(arg)
    }
  }
  return flags
}

const flags = parseFlags(rest)

function out(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

function fail(payload) {
  out({ ok: false, ...payload })
  process.exit(1)
}

function receipt(payload) {
  out({ ok: true, ...payload })
}

function nowIso() {
  return new Date().toISOString()
}

function requireItem(facts, id) {
  const item = itemById(facts, id)
  if (!item) fail({ code: 'ITEM_NOT_FOUND', message: `任务不存在：${id}`, availableHint: '运行 node scripts/task.mjs list 查看全部任务。' })
  return item
}

function checkExpectedRevision(rootDir) {
  const expected = flags['expect-revision']
  if (!expected) return
  const current = hashFacts(rootDir)
  if (current !== expected) {
    fail({
      code: 'REVISION_CONFLICT',
      message: '事实源已被其他人更新，请重新读取后再试（重新运行命令即可获得最新上下文）。',
      expected,
      current,
    })
  }
}

function rebuildAfterChange(extra = {}) {
  const facts = loadFacts(root)
  const validation = validateGraph(facts)
  if (!validation.ok) {
    fail({ code: 'GRAPH_INVALID', errors: validation.errors, warnings: validation.warnings })
  }
  const derived = rebuildDerived(root, { facts })
  // 短回执：派生文件变化只报数量，不回显完整列表。
  receipt({ revision: derived.revision, derivedChanged: derived.changed.length, warnings: validation.warnings, ...extra })
}

function resolveActor() {
  if (flags.actor) return String(flags.actor)
  return null
}

function requireActor(facts, fallbackOwnerId) {
  const actor = resolveActor(facts) ?? fallbackOwnerId ?? facts.project.members[0]?.id
  if (!actor) fail({ code: 'ACTOR_REQUIRED', message: '无法确定操作人，请用 --actor <memberId> 显式指定。' })
  const known = facts.project.members.some((member) => member.id === actor)
  if (!known) fail({ code: 'ACTOR_UNKNOWN', message: `成员不存在：${actor}` })
  return actor
}

ensureDirs(root)

switch (command) {
  case 'context': {
    const facts = loadFacts(root)
    const id = flags._[0]
    if (!id) fail({ code: 'USAGE', message: '用法：task context <RG-xxx> [--include evidence|history|dependencies|handoff]' })
    requireItem(facts, id)
    const include = []
    for (const flag of ['evidence', 'history', 'dependencies', 'handoff']) {
      if (flags[flag] || flags.include === flag || (Array.isArray(flags.include) && flags.include.includes(flag))) include.push(flag)
    }
    const context = buildContext(facts, id, { include, revision: hashFacts(root), root })
    if (!context) fail({ code: 'ITEM_NOT_FOUND', message: `任务不存在：${id}` })
    out(context)
    break
  }

  case 'list': {
    const facts = loadFacts(root)
    let items = facts.items
    if (flags.frontier) items = items.filter((item) => isOpenFrontier(item, facts))
    if (flags.status) items = items.filter((item) => item.status === flags.status)
    if (flags.owner) items = items.filter((item) => item.ownerIds.includes(flags.owner))
    out({
      ok: true,
      count: items.length,
      items: items
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((item) => ({
          id: item.id,
          title: item.title,
          state: item.status,
          type: item.type,
          owners: item.ownerIds,
        })),
    })
    break
  }

  case 'item': {
    if (flags._[0] !== 'create') fail({ code: 'USAGE', message: '用法：task item create --title ... --type task [--owners fei,ma] [--phase ...] [--summary ...] [--acceptance ...] [--weight 1] [--lane 0]' })
    const facts = loadFacts(root)
    const highest = facts.items.reduce((max, item) => {
      const match = /^RG-(\d+)$/.exec(item.id)
      return match ? Math.max(max, Number(match[1])) : max
    }, 0)
    const id = `RG-${String(highest + 1).padStart(3, '0')}`
    const type = flags.type ?? 'task'
    if (!ITEM_TYPES.includes(type)) fail({ code: 'USAGE', message: `type 必须是 ${ITEM_TYPES.join(', ')}` })
    if (!flags.title) fail({ code: 'USAGE', message: '必须提供 --title' })
    const ownerIds = String(flags.owners ?? facts.project.members[0]?.id ?? '').split(',').filter(Boolean)
    const createdAt = nowIso()
    const item = {
      id,
      title: String(flags.title),
      summary: String(flags.summary ?? ''),
      type,
      phase: String(flags.phase ?? 'P1 闭环'),
      status: 'planned',
      ownerIds,
      acceptanceCriteria: String(flags.acceptance ?? ''),
      weight: Number(flags.weight ?? 1),
      lane: Number(flags.lane ?? 0),
      updatedAt: createdAt,
    }
    checkExpectedRevision(root)
    saveItem(root, item)
    recordEvent(root, {
      identity: null,
      actorId: requireActor(facts, ownerIds[0]),
      action: 'item.created',
      workItemId: id,
      summary: `创建任务 ${id}：${item.title}`,
      createdAt,
    })
    rebuildAfterChange({ id, created: true, next: 'task context ' + id })
    break
  }

  case 'evidence': {
    const facts = loadFacts(root)
    const sub = flags._[0]

    if (sub === 'add') {
      const id = flags._[1]
      const item = requireItem(facts, id)
      const kind = String(flags.kind ?? 'code')
      if (!EVIDENCE_KINDS.includes(kind)) fail({ code: 'USAGE', message: `kind 必须是 ${EVIDENCE_KINDS.join(', ')}` })
      if (!flags.title) fail({ code: 'USAGE', message: '必须提供 --title（写清结果和测量条件）' })
      const actorId = requireActor(facts, item.ownerIds[0])
      const ref = flags.ref ? String(flags.ref) : null
      const url = flags.url ? String(flags.url) : null
      const title = String(flags.title)
      // 业务身份：有 SHA 用 SHA，有链接用链接，否则用标题哈希 → Agent 重试天然幂等。
      const dedupeKey = ref ?? url ?? createHash('sha256').update(`${item.id}:${kind}:${title}`).digest('hex').slice(0, 12)
      const identity = `manual:${item.id}:${kind}:${dedupeKey}`
      const entryId = `EV-${createHash('sha256').update(identity).digest('hex').slice(0, 12)}`
      if (facts.evidence.some((entry) => entry.id === entryId)) {
        receipt({ id: item.id, evidenceId: entryId, changed: [], duplicate: true, next: 'task context ' + item.id })
        break
      }
      checkExpectedRevision(root)
      const createdAt = nowIso()
      saveEvidence(root, {
        id: entryId,
        workItemId: item.id,
        actorId,
        title,
        kind,
        ...(url ? { url } : {}),
        ...(ref ? { ref } : {}),
        source: flags.actor ? 'agent-cli' : 'manual-cli',
        accepted: false,
        createdAt,
      })
      recordEvent(root, {
        identity: `evidence.added:${entryId}`,
        actorId,
        action: 'evidence.added',
        workItemId: item.id,
        summary: `提交${kind === 'code' ? '代码' : kind === 'experiment' ? '实验' : ''}证据：${title.slice(0, 120)}`,
        createdAt,
        metadata: { url, ref },
      })
      rebuildAfterChange({ id: item.id, evidenceId: entryId, changed: ['evidence'], next: `node scripts/task.mjs submit-audit ${item.id}` })
      break
    }

    if (sub === 'accept' || sub === 'decline') {
      const evidenceRaw = flags._[1]
      const entry = facts.evidence.find((candidate) => candidate.id === evidenceRaw)
      if (!entry) fail({ code: 'EVIDENCE_NOT_FOUND', message: `证据不存在：${evidenceRaw}` })
      const reviewerId = flags.reviewer ? String(flags.reviewer) : null
      if (!reviewerId) fail({ code: 'REVIEWER_REQUIRED', message: '审计必须记录审计人：--reviewer <memberId>。身份与授权最终以受保护的 PR review 为准，这里只做记录。' })
      if (!facts.project.members.some((member) => member.id === reviewerId)) {
        fail({ code: 'ACTOR_UNKNOWN', message: `成员不存在：${reviewerId}` })
      }
      const accepted = sub === 'accept'
      const currentDecision = entry.audit?.decision ?? (entry.accepted ? 'accepted' : 'pending')
      if (currentDecision === (accepted ? 'accepted' : 'declined')) {
        receipt({ id: entry.id, changed: [], duplicate: true, next: 'task context ' + entry.workItemId })
        break
      }
      checkExpectedRevision(root)
      const reviewedAt = nowIso()
      entry.accepted = accepted
      entry.audit = {
        decision: accepted ? 'accepted' : 'declined',
        reviewerId,
        reviewedAt,
        note: flags.note ? String(flags.note) : null,
        reviewRef: flags['review-ref'] ? String(flags['review-ref']) : null,
      }
      saveEvidence(root, entry)
      recordEvent(root, {
        identity: `evidence.${accepted ? 'accepted' : 'declined'}:${entry.id}:${reviewerId}:${reviewedAt}`,
        actorId: reviewerId,
        action: accepted ? 'evidence.accepted' : 'evidence.declined',
        workItemId: entry.workItemId,
        summary: `审计${accepted ? '通过' : '退回'}：${entry.title.slice(0, 120)}`,
        createdAt: reviewedAt,
        metadata: { evidenceId: entry.id, note: entry.audit.note },
      })
      rebuildAfterChange({ id: entry.id, changed: ['evidence'], next: `node scripts/task.mjs complete ${entry.workItemId} --reviewer ${reviewerId}` })
      break
    }

    fail({ code: 'USAGE', message: '用法：task evidence add <RG-xxx> --kind code --title ... [--url ...] [--ref <sha>] | task evidence accept|decline <EV-xxx> --reviewer <memberId> [--note ...]' })
    break
  }

  case 'submit-audit': {
    const facts = loadFacts(root)
    const id = flags._[0]
    const item = requireItem(facts, id)
    const decision = evaluateTransition(facts, item, 'review')
    if (!decision.ok) {
      if (decision.code === 'NO_EVIDENCE') fail({ ...decision, next: `node scripts/task.mjs evidence add ${id} --kind code --title ...` })
      fail(decision)
    }
    if (decision.noop) {
      receipt({ id, changed: [], duplicate: true, next: '等待人工审计：task evidence accept <EV-xxx> --reviewer ...' })
      break
    }
    checkExpectedRevision(root)
    const createdAt = nowIso()
    const actorId = requireActor(facts, item.ownerIds[0])
    const from = item.status
    item.status = 'review'
    item.updatedAt = createdAt
    saveItem(root, item)
    recordEvent(root, {
      identity: `status:${item.id}:${from}->review:${createdAt}`,
      actorId,
      action: 'status.changed',
      workItemId: item.id,
      summary: `${item.id} 提交审计：${from} → review`,
      createdAt,
    })
    rebuildAfterChange({ id, changed: ['status'], next: '等待人工审计确认（evidence accept → complete）' })
    break
  }

  case 'complete': {
    const facts = loadFacts(root)
    const id = flags._[0]
    const item = requireItem(facts, id)
    const reviewerId = flags.reviewer ? String(flags.reviewer) : null
    const decision = evaluateTransition(facts, item, 'done', { reviewerId })
    if (!decision.ok) fail(decision)
    if (decision.noop) {
      receipt({ id, changed: [], duplicate: true })
      break
    }
    checkExpectedRevision(root)
    const createdAt = nowIso()
    item.status = 'done'
    item.updatedAt = createdAt
    saveItem(root, item)
    recordEvent(root, {
      identity: `status:${item.id}:review->done:${reviewerId}:${createdAt}`,
      actorId: reviewerId,
      action: 'status.changed',
      workItemId: item.id,
      summary: `${item.id} 审计确认完成：${reviewerId}${flags.note ? `（${String(flags.note).slice(0, 120)}）` : ''}`,
      createdAt,
    })
    rebuildAfterChange({ id, changed: ['status'], next: null })
    break
  }

  case 'status': {
    if (flags._[0] !== 'set') fail({ code: 'USAGE', message: '用法：task status set <RG-xxx> <planned|ready|in_progress|review|blocked|done>' })
    const facts = loadFacts(root)
    const id = flags._[1]
    const to = flags._[2]
    const item = requireItem(facts, id)
    const decision = evaluateTransition(facts, item, to, { reviewerId: flags.reviewer ? String(flags.reviewer) : null })
    if (!decision.ok) fail(decision)
    if (decision.noop) {
      receipt({ id, changed: [], duplicate: true })
      break
    }
    checkExpectedRevision(root)
    const createdAt = nowIso()
    const from = item.status
    item.status = to
    item.updatedAt = createdAt
    saveItem(root, item)
    recordEvent(root, {
      identity: `status:${item.id}:${from}->${to}:${createdAt}`,
      actorId: requireActor(facts, item.ownerIds[0]),
      action: 'status.changed',
      workItemId: item.id,
      summary: `${item.id}：${from} → ${to}${flags.note ? `（${String(flags.note).slice(0, 120)}）` : ''}`,
      createdAt,
    })
    rebuildAfterChange({ id, changed: ['status'], next: STATUS_LABELS[to] ? `当前状态：${to}（${STATUS_LABELS[to]}）` : null })
    break
  }

  case 'record-push': {
    // polyhook / Actions / 对账共用的受控写入口：Git 事件 → 事实源（幂等）。
    const facts = loadFacts(root)
    const repository = flags.repo
    if (!repository) fail({ code: 'USAGE', message: '必须提供 --repo owner/name' })
    const commits = []
    const rawCommits = [...flags._.filter((value) => value.includes(':')), ...(Array.isArray(flags.commit) ? flags.commit : flags.commit ? [flags.commit] : [])]
    for (const raw of rawCommits) {
      const separator = raw.indexOf(':')
      const sha = raw.slice(0, separator)
      const message = raw.slice(separator + 1)
      commits.push({ id: sha, message })
    }
    if (commits.length === 0) {
      receipt({ changed: false, items: {}, note: '没有可记录的 commit。' })
      break
    }
    checkExpectedRevision(root)
    const result = applyPush(root, facts, {
      repository: String(repository),
      commits,
      actorId: flags.actor ? String(flags.actor) : null,
      pusherEmail: flags.pusher ? String(flags.pusher) : null,
      branchHint: flags['branch-hint'] ? String(flags['branch-hint']) : null,
      now: nowIso(),
    })
    if (!result.changed) {
      receipt({ changed: false, duplicate: true, items: result.items, note: '事件已记录过（按业务身份去重），未重复写入。' })
      break
    }
    rebuildAfterChange({ changed: ['facts'], items: result.items, note: '重复推送同一 commit 会在这里幂等跳过。' })
    break
  }

  case 'handoff': {
    const facts = loadFacts(root)
    const id = flags._[0]
    const item = requireItem(facts, id)
    if (flags.file) {
      const { readFileSync } = await import('node:fs')
      const content = readFileSync(String(flags.file), 'utf8')
      const actorId = requireActor(facts, item.ownerIds[0])
      const createdAt = nowIso()
      const revision = hashFacts(root)
      const fileName = `${createdAt.replace(/[:.]/g, '-')}.md`
      saveHandoff(root, id, fileName, [
        '<!-- team-graph-handoff',
        `item: ${id}`,
        `actor: ${actorId}`,
        `recordedAt: ${createdAt}`,
        `revision: ${revision}`,
        '-->',
        '',
        content.trimEnd(),
        '',
      ].join('\n'))
      recordEvent(root, {
        identity: `handoff:${id}:${revision}:${createdAt}`,
        actorId,
        action: 'handoff.recorded',
        workItemId: id,
        summary: `记录交接摘要（revision ${revision.slice(0, 7)}）`,
        createdAt,
      })
      rebuildAfterChange({ id, changed: ['handoff'], next: `node scripts/task.mjs handoff ${id} 可读取` })
      break
    }
    const handoff = latestHandoff(root, id)
    if (!handoff) fail({ code: 'NO_HANDOFF', message: `${id} 还没有交接摘要。` })
    out({ ok: true, id, file: handoff.file, meta: handoff.meta, content: handoff.content })
    break
  }

  case 'validate': {
    const facts = loadFacts(root)
    const validation = validateGraph(facts)
    out({ ok: validation.ok, errors: validation.errors, warnings: validation.warnings })
    process.exit(validation.ok ? 0 : 1)
    break
  }

  default:
    out({
      ok: false,
      code: 'USAGE',
      message: 'Team Graph 任务操作入口。',
      commands: [
        'context <RG-xxx> [--include evidence|history|dependencies|handoff]  # 只读当前任务所需上下文',
        'list [--frontier] [--status S] [--owner ID]',
        'item create --title T --type task [--owners a,b] [--phase P] [--summary S] [--acceptance A]',
        'evidence add <RG-xxx> --kind code --title T [--url U] [--ref SHA] [--actor ID]',
        'evidence accept|decline <EV-xxx> --reviewer ID [--note N] [--review-ref "PR #12"]',
        'submit-audit <RG-xxx>',
        'complete <RG-xxx> --reviewer ID [--note N]',
        'status set <RG-xxx> <status> [--reviewer ID] [--note N]',
        'record-push --repo owner/name [--pusher email] --commit <sha>:<subject> ...',
        'handoff <RG-xxx> [--file F] [--actor ID]',
        'validate',
      ],
      rules: [
        '开始任务前运行 task context <ID>；不要读取全量任务图。',
        '状态与证据通过 task 命令修改；不要直接编辑 public/data（派生产物）。',
        '不要自行批准证据审计或设置 done；审计人最终以受保护的 PR review 为准。',
      ],
    })
    process.exit(command ? 1 : 0)
}
