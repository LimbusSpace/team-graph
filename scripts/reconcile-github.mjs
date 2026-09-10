#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { loadFacts } from './lib/store.mjs'
import { rebuildDerived } from './lib/derived.mjs'
import { validateGraph } from './lib/rules.mjs'
import { applyPush, applyPullRequest } from './lib/github.mjs'
import { extractItemIds } from './lib/ident.mjs'
import { repoRoot } from './lib/paths.mjs'

/**
 * 定期对账：直接从 GitHub API 重放最近的 commit 和已合并 PR，补偿漏掉的事件。
 *
 * 背景：concurrency 取消、polyhook 离线、squash merge 的 push 事件丢 commit 等
 * 情况都会造成事件缺失。这里用“可重放事件 + 幂等更新”补齐：重复重放是安全的，
 * 因为业务身份去重保证已记录的事件不会重复追加。
 *
 * 运行环境需要 gh CLI 和 GITHUB_TOKEN（GitHub Actions 自带）。
 */

const root = repoRoot()
const repository = process.env.GITHUB_REPOSITORY
const days = Number(process.argv[process.argv.indexOf('--days') + 1] ?? 30)

if (!repository) {
  console.log('未设置 GITHUB_REPOSITORY（本地对账请手动指定），跳过。')
  process.exit(0)
}

function gh(args) {
  return execFileSync('gh', ['api', ...args], {
    encoding: 'utf8',
    env: { ...process.env },
    maxBuffer: 16 * 1024 * 1024,
  })
}

const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

let commits = []
let pullRequests = []

try {
  commits = JSON.parse(gh([
    `repos/${repository}/commits?sha=main&per_page=100&since=${since}`,
  ]))
  pullRequests = JSON.parse(gh([
    `repos/${repository}/pulls?state=closed&sort=updated&direction=desc&per_page=50`,
  ]))
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    code: 'GH_UNAVAILABLE',
    message: `无法调用 gh api：${error.message.slice(0, 200)}。对账在 Actions 中由 GITHUB_TOKEN 提供。`,
  }, null, 2))
  process.exit(1)
}

const facts = loadFacts(root)
const summary = { commitsScanned: 0, commitsMatched: 0, pullsScanned: 0, pullsMatched: 0 }

const pushCommits = commits
  .filter((commit) => commit.commit?.author?.name !== 'github-actions[bot]')
  .map((commit) => {
    summary.commitsScanned += 1
    if (extractItemIds(commit.commit?.message ?? '').length > 0) summary.commitsMatched += 1
    return {
      id: commit.sha,
      message: commit.commit?.message ?? '',
      timestamp: commit.commit?.author?.date,
    }
  })

const merged = pullRequests
  .filter((pullRequest) => pullRequest.merged_at && new Date(pullRequest.merged_at) >= new Date(since))
  .map((pullRequest) => {
    summary.pullsScanned += 1
    if (extractItemIds(`${pullRequest.title ?? ''}\n${pullRequest.head?.ref ?? ''}`).length > 0) summary.pullsMatched += 1
    return {
      action: 'merged',
      pullRequest: {
        number: pullRequest.number,
        title: pullRequest.title,
        body: pullRequest.body,
        html_url: pullRequest.html_url,
        merged_at: pullRequest.merged_at,
        merge_commit_sha: pullRequest.merge_commit_sha,
        head: { ref: pullRequest.head?.ref },
      },
    }
  })

let changed = false
if (pushCommits.length > 0) {
  const result = applyPush(root, facts, { repository, commits: pushCommits, now: new Date().toISOString() })
  changed = changed || result.changed
}
for (const pullRequest of merged) {
  const result = applyPullRequest(root, facts, { repository, ...pullRequest, now: new Date().toISOString() })
  changed = changed || result.changed
}

if (!changed) {
  console.log(JSON.stringify({ ok: true, reconciled: false, ...summary, note: '对账完成：没有需要补偿的事件。' }, null, 2))
  process.exit(0)
}

const validation = validateGraph(facts)
if (!validation.ok) {
  console.error(JSON.stringify({ ok: false, code: 'GRAPH_INVALID', errors: validation.errors }, null, 2))
  process.exit(1)
}

const derived = rebuildDerived(root, { facts })
console.log(JSON.stringify({ ok: true, reconciled: true, revision: derived.revision, ...summary }, null, 2))
