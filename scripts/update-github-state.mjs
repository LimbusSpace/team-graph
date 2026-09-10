#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { loadFacts } from './lib/store.mjs'
import { rebuildDerived } from './lib/derived.mjs'
import { validateGraph } from './lib/rules.mjs'
import { applyPush, applyPullRequest } from './lib/github.mjs'
import { repoRoot } from './lib/paths.mjs'

/**
 * GitHub Actions 的受控写入口：把 push / PR 事件落到 data/ 事实源。
 *
 * 幂等：事件按业务身份（仓库 + SHA + 任务 + 动作 / PR 编号 + 动作）去重，
 * 同一事件重复执行（重跑 workflow、对账重放、本机 polyhook 先写过）不会重复追加。
 *
 * 环节缺失不靠 concurrency 兜底：漏掉的事件由 reconcile-github.mjs 定期对账补偿。
 */

const root = repoRoot()
const eventName = process.env.GITHUB_EVENT_NAME
const repository = process.env.GITHUB_REPOSITORY
const eventPath = process.env.GITHUB_EVENT_PATH

if (!eventName || !eventPath) {
  console.log('不在 GitHub Actions 环境中，跳过。')
  process.exit(0)
}

const event = JSON.parse(readFileSync(eventPath, 'utf8'))

// 派生数据提交回到 main 时会再次触发本 workflow；机器人自己的 push 直接跳过，循环终止。
const senderLogin = event.sender?.login ?? ''
if (eventName === 'push' && senderLogin === 'github-actions[bot]') {
  console.log('跳过 github-actions[bot] 的状态提交，避免更新循环。')
  process.exit(0)
}

const facts = loadFacts(root)
const now = new Date().toISOString()
let result = { changed: false }

if (eventName === 'push') {
  result = applyPush(root, facts, {
    repository,
    commits: event.commits ?? [],
    pusherEmail: event.pusher?.email ?? null,
    now,
  })
} else if (eventName === 'pull_request') {
  if (event.action === 'opened' || event.action === 'reopened') {
    result = applyPullRequest(root, facts, { repository, action: 'opened', pullRequest: event.pull_request, now })
  } else if (event.action === 'closed' && event.pull_request?.merged) {
    result = applyPullRequest(root, facts, { repository, action: 'merged', pullRequest: event.pull_request, now })
  }
} else {
  console.log(`事件 ${eventName} 不需要归集。`)
  process.exit(0)
}

if (!result.changed) {
  console.log(`事件未命中 RG 节点或已记录过（业务身份去重），事实源未变化。`)
  process.exit(0)
}

const validation = validateGraph(facts)
if (!validation.ok) {
  console.error(JSON.stringify({ ok: false, code: 'GRAPH_INVALID', errors: validation.errors }, null, 2))
  process.exit(1)
}

const derived = rebuildDerived(root, { facts })
console.log(JSON.stringify({
  ok: true,
  revision: derived.revision,
  items: result.items,
  changedFiles: derived.changed.length,
}, null, 2))
