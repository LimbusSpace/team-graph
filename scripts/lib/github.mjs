import { evidenceId, extractItemIds, shortSha } from './ident.mjs'
import { mergePolicy, itemById } from './rules.mjs'
import { hasEventIdentity, recordEvent, saveEvidence, saveItem } from './store.mjs'

/**
 * Git 事件 → 事实源。polyhook（本机 push）、GitHub Actions（push/PR）、
 * 定期对账三方都走这一份代码，事件与证据按业务身份去重：
 *
 *   代码证据 / 事件身份 = 仓库 + commit SHA + 任务 ID + 动作
 *   PR 身份 = 仓库 + PR 编号 + 动作 + 任务 ID
 *
 * 同一操作被多个来源观察到时，只有第一个写入生效，其余静默幂等跳过。
 */

function resolveActor(facts, item, explicitActor, pusherEmail) {
  if (explicitActor) return explicitActor
  const email = (pusherEmail ?? '').toLowerCase()
  if (email) {
    const member = facts.project.members.find((candidate) =>
      (candidate.gitEmails ?? []).some((candidateEmail) => candidateEmail.toLowerCase() === email),
    )
    if (member) return member.id
  }
  return item.ownerIds[0] ?? facts.project.members[0]?.id ?? 'unknown'
}

/** 状态推进 + 对应 status.changed 事件。返回是否发生变化。 */
function transitionItem(root, facts, item, to, { actorId, createdAt, identityTag }) {
  if (item.status === to) return false
  const from = item.status
  item.status = to
  item.updatedAt = createdAt
  saveItem(root, item)
  recordEvent(root, {
    identity: `status:${item.id}:${from}->${to}:${identityTag}`,
    actorId,
    action: 'status.changed',
    workItemId: item.id,
    summary: `${item.id}：${from} → ${to}`,
    createdAt,
  })
  return true
}

function upsertCodeEvidence(root, facts, { itemId, actorId, identity, title, url, ref, createdAt, source }) {
  const existing = facts.evidence.find((entry) => entry.id === evidenceId(identity))
  if (existing) return { added: false, id: existing.id }

  const entry = {
    id: evidenceId(identity),
    workItemId: itemId,
    actorId,
    title: title.slice(0, 240),
    kind: 'code',
    url,
    ref,
    source,
    accepted: false,
    createdAt,
  }
  facts.evidence.push(entry)
  saveEvidence(root, entry)
  recordEvent(root, {
    identity: `evidence.added:${entry.id}`,
    actorId,
    action: 'evidence.added',
    workItemId: itemId,
    summary: `代码证据：${title.slice(0, 120)}`,
    createdAt,
    metadata: { url, ref },
  })
  return { added: true, id: entry.id }
}

/**
 * push 事件：汇总本次推送的 commit 与任务 ID。
 * - 每个关联任务生成一条代码证据（候选，不计入进度）；
 * - 非 mission 类型 planned/ready → in_progress；
 * - done 之后的新提交只追加活动，不回退状态。
 */
export function applyPush(root, facts, { repository, commits, actorId: explicitActor, pusherEmail, branchHint, now }) {
  const result = { changed: false, items: {} }

  for (const commit of commits) {
    const sha = commit.id ?? commit.sha
    if (!sha) continue
    const message = commit.message ?? ''
    const createdAt = commit.timestamp ?? now
    const url = `https://github.com/${repository}/commit/${sha}`
    // commit message 是唯一可信的结构化来源；分支名只作兜底提示。
    const itemIds = extractItemIds(message).length > 0
      ? extractItemIds(message)
      : branchHint
        ? [branchHint]
        : []
    for (const itemId of itemIds) {
      const item = itemById(facts, itemId)
      if (!item) continue
      const policy = mergePolicy(item.type)
      const actorId = resolveActor(facts, item, explicitActor, pusherEmail)
      const bucket = (result.items[itemId] ??= { evidenceAdded: false, stateChanged: false })

      const identity = `code:${repository}:${sha}:${itemId}`
      const evidence = upsertCodeEvidence(root, facts, {
        itemId,
        actorId,
        identity,
        title: `${shortSha(sha)} · ${message.split('\n')[0]}`,
        url,
        ref: sha,
        createdAt,
        source: 'git-push',
      })
      if (evidence.added) {
        bucket.evidenceAdded = true
        result.changed = true
      }

      const pushEvent = recordEvent(root, {
        identity: `git.push:${repository}:${sha}:${itemId}`,
        actorId,
        action: 'git.push',
        workItemId: itemId,
        summary: `${shortSha(sha)} 推送关联 ${itemId}：${item.title}`,
        createdAt,
        metadata: { commit: url },
      })
      if (pushEvent) result.changed = true

      if (policy.autoStart && (item.status === 'planned' || item.status === 'ready')) {
        if (transitionItem(root, facts, item, 'in_progress', {
          actorId,
          createdAt,
          identityTag: sha,
        })) {
          bucket.stateChanged = true
          result.changed = true
        }
      }
    }
  }

  return result
}

/** PR 里程碑：opened 只记录事件；merged 按 mergePolicy 决定是否推进到待审计。 */
export function applyPullRequest(root, facts, { repository, action, pullRequest, actorId: explicitActor, now }) {
  const result = { changed: false, items: {} }
  const number = pullRequest.number
  const title = pullRequest.title ?? ''
  const text = `${title}\n${pullRequest.body ?? ''}\n${pullRequest.head?.ref ?? ''}`
  const createdAt = action === 'opened' ? (pullRequest.created_at ?? now) : (pullRequest.merged_at ?? now)

  for (const itemId of extractItemIds(text)) {
    const item = itemById(facts, itemId)
    if (!item) continue
    const policy = mergePolicy(item.type)
    const actorId = resolveActor(facts, item, explicitActor)
    const bucket = (result.items[itemId] ??= { evidenceAdded: false, stateChanged: false })

    if (action === 'opened') {
      const event = recordEvent(root, {
        identity: `pr.opened:${repository}:${number}:${itemId}`,
        actorId,
        action: 'pr.opened',
        workItemId: itemId,
        summary: `PR #${number} 发起：${title}`.slice(0, 200),
        createdAt,
        metadata: { pullRequest: pullRequest.html_url },
      })
      if (event) result.changed = true
      continue
    }

    if (action !== 'merged') continue

    const identity = `code:${repository}:pr-${number}:${itemId}`
    const evidence = upsertCodeEvidence(root, facts, {
      itemId,
      actorId,
      identity,
      title: `PR #${number} 已合并 · ${title}`,
      url: pullRequest.html_url,
      ref: pullRequest.merge_commit_sha ?? null,
      createdAt,
      source: 'pr-merge',
    })
    if (evidence.added) {
      bucket.evidenceAdded = true
      result.changed = true
    }

    const event = recordEvent(root, {
      identity: `pr.merged:${repository}:${number}:${itemId}`,
      actorId,
      action: 'pr.merged',
      workItemId: itemId,
      summary: policy.autoReview
        ? `PR #${number} 已合并，${itemId} 进入待审计`
        : `PR #${number} 已合并；${item.type} 类型不自动推进，需人工确认后续`,
      createdAt,
      metadata: { pullRequest: pullRequest.html_url },
    })
    if (event) result.changed = true

    if (!policy.autoReview) continue
    if (item.status === 'done') continue
    if (item.status === 'planned' || item.status === 'ready') {
      if (transitionItem(root, facts, item, 'in_progress', {
        actorId,
        createdAt,
        identityTag: `pr-${number}`,
      })) {
        bucket.stateChanged = true
        result.changed = true
      }
    }
    if (item.status === 'in_progress') {
      if (transitionItem(root, facts, item, 'review', {
        actorId,
        createdAt,
        identityTag: `pr-${number}`,
      })) {
        bucket.stateChanged = true
        result.changed = true
      }
    }
  }

  return result
}

/** 对账时先做幂等预检，避免为纯重复事件做无谓写入。 */
export function pushAlreadyRecorded(root, repository, sha, itemId) {
  return hasEventIdentity(root, `git.push:${repository}:${sha}:${itemId}`)
}
