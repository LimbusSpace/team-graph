const fs = require('node:fs')

const statePath = 'public/data/project.json'
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
const event_name = process.env.GITHUB_EVENT_NAME
const repository = process.env.GITHUB_REPOSITORY
const now = new Date().toISOString()
let changed = false

function nodeId(text = '') {
  return text.match(/\bRG-\d{3,}\b/i)?.[0]?.toUpperCase()
}

function addEvent(actorId, workItemId, summary, metadata = {}) {
  state.events.unshift({
    id: `AE-GH-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    actorId,
    action: 'git.commit',
    workItemId,
    summary,
    createdAt: now,
    metadata,
  })
  state.events = state.events.slice(0, 100)
}

function applyCommit(commit) {
  const id = nodeId(commit.message)
  const item = state.items.find((candidate) => candidate.id === id)
  if (!item || !commit.id) return

  const actorId = item.ownerIds[0] ?? state.members[0]?.id
  const shortSha = commit.id.slice(0, 7)
  const url = `https://github.com/${repository}/commit/${commit.id}`
  const evidenceId = `EV-GH-${commit.id}`

  if (!state.evidence.some((entry) => entry.id === evidenceId)) {
    state.evidence.unshift({
      id: evidenceId,
      workItemId: item.id,
      actorId,
      title: `${shortSha} · ${(commit.message ?? '').split('\n')[0]}`.slice(0, 240),
      kind: 'code',
      url,
      accepted: false,
      createdAt: commit.timestamp ?? now,
    })
    changed = true
  }

  if (item.status === 'planned' || item.status === 'ready') {
    item.status = 'in_progress'
    item.updatedAt = now
    changed = true
  }

  addEvent(actorId, item.id, `${shortSha} 触发 ${item.id}：${item.title}`, {
    commit: url,
    message: commit.message,
  })
  changed = true
}

if (event_name === 'push') {
  for (const commit of event.commits ?? []) applyCommit(commit)
}

if (event_name === 'pull_request' && event.action === 'closed' && event.pull_request?.merged) {
  const pullRequest = event.pull_request
  const id = nodeId(`${pullRequest.title}\n${pullRequest.body ?? ''}\n${pullRequest.head?.ref ?? ''}`)
  const item = state.items.find((candidate) => candidate.id === id)
  if (item) {
    const actorId = item.ownerIds[0] ?? state.members[0]?.id
    const evidenceId = `EV-GH-PR-${pullRequest.number}`
    if (!state.evidence.some((entry) => entry.id === evidenceId)) {
      state.evidence.unshift({
        id: evidenceId,
        workItemId: item.id,
        actorId,
        title: `PR #${pullRequest.number} 已合并 · ${pullRequest.title}`.slice(0, 240),
        kind: 'code',
        url: pullRequest.html_url,
        accepted: false,
        createdAt: now,
      })
      changed = true
    }
    if (item.status !== 'done') {
      item.status = 'review'
      item.updatedAt = now
      changed = true
    }
    addEvent(actorId, item.id, `PR #${pullRequest.number} 已合并，${item.id} 进入待审计`, { pullRequest: pullRequest.html_url })
    changed = true
  }
}

if (changed) {
  state.updatedAt = now
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`)
  console.log('GitHub event applied to project state.')
} else {
  console.log('No RG node found; project state unchanged.')
}
