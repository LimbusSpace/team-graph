const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

function git(cwd, args) {
  const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' })
  return result.status === 0 ? result.stdout.trim() : ''
}

function output(message) {
  if (message) process.stdout.write(`${message}\n`)
}

let event
try {
  event = JSON.parse(fs.readFileSync(0, 'utf8'))
} catch {
  process.exit(0)
}

const command = String(event.tool_input?.command ?? '')
if (!/\bgit\s+(?:add|commit|push)\b/i.test(command)) process.exit(0)

const sourceRoot = git(event.cwd || process.cwd(), ['rev-parse', '--show-toplevel'])
if (!sourceRoot) process.exit(0)

const configPath = path.join(sourceRoot, '.codex', 'team-graph.local.json')
if (!fs.existsSync(configPath)) process.exit(0)

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
const graphRoot = path.resolve(config.teamGraphPath)
if (!fs.existsSync(path.join(graphRoot, 'public', 'data', 'project.json'))) {
  output('[team-graph] 配置的 teamGraphPath 无效，已跳过同步。')
  process.exit(0)
}
if (path.resolve(sourceRoot) === path.resolve(graphRoot)) process.exit(0)

const statePath = path.join(graphRoot, 'public', 'data', 'project.json')
const graphStatus = git(graphRoot, ['status', '--porcelain', '--untracked-files=all'])
if (graphStatus) {
  output('[team-graph] 状态仓库有未提交修改，已跳过本次同步。')
  process.exit(0)
}

const branch = git(sourceRoot, ['branch', '--show-current'])
const staged = git(sourceRoot, ['diff', '--cached', '--name-only'])
const latestMessage = git(sourceRoot, ['log', '-1', '--format=%B'])
const action = /\bgit\s+push\b/i.test(command)
  ? 'git.push'
  : /\bgit\s+commit\b/i.test(command)
    ? 'git.commit'
    : 'git.add'
const nodeIds = [...new Set([
  ...((command.match(/\bRG-\d{3,}\b/gi) ?? []).map((id) => id.toUpperCase())),
  ...((branch.match(/\bRG-\d{3,}\b/gi) ?? []).map((id) => id.toUpperCase())),
  ...((latestMessage.match(/\bRG-\d{3,}\b/gi) ?? []).map((id) => id.toUpperCase())),
])]
if (nodeIds.length === 0 && config.defaultNode) nodeIds.push(String(config.defaultNode).toUpperCase())
if (nodeIds.length === 0) {
  output('[team-graph] 未找到 RG-xxx 节点编号，未修改状态。')
  process.exit(0)
}

const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
const now = new Date().toISOString()
const sourceRemote = git(sourceRoot, ['remote', 'get-url', 'origin'])
const githubRemote = sourceRemote.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/i)
const sourceRepository = githubRemote ? `${githubRemote[1]}/${githubRemote[2]}` : sourceRemote
const sourceSha = git(sourceRoot, ['rev-parse', 'HEAD'])
const commitUrl = githubRemote && sourceSha ? `https://github.com/${sourceRepository}/commit/${sourceSha}` : undefined
const actorEmail = git(sourceRoot, ['config', 'user.email']).toLowerCase()
let matched = 0

for (const nodeId of nodeIds) {
  const item = state.items.find((candidate) => candidate.id === nodeId)
  if (!item) continue
  matched += 1
  const member = state.members.find((candidate) =>
    actorEmail && (candidate.gitEmails ?? []).some((email) => email.toLowerCase() === actorEmail),
  )
  const actorId = member?.id ?? item.ownerIds[0] ?? state.members[0]?.id ?? 'unknown'
  const eventId = `AE-CODEX-${sourceSha || Date.now()}-${action}-${nodeId}`
  const evidenceId = `EV-CODEX-${sourceSha || Date.now()}-${nodeId}`

  if (!state.events.some((entry) => entry.id === eventId)) {
    state.events.unshift({
      id: eventId,
      actorId,
      action,
      workItemId: nodeId,
      summary: `${nodeId} 检测到 Agent Git 操作：${command.slice(0, 140)}`,
      createdAt: now,
      metadata: { sourceRepository, sourceSha, staged, command },
    })
  }
  if (/\bgit\s+(?:add|commit)\b/i.test(command) && !state.evidence.some((entry) => entry.id === evidenceId)) {
    state.evidence.unshift({
      id: evidenceId,
      workItemId: nodeId,
      actorId,
      title: `Agent 已准备代码变更 · ${nodeId}`,
      kind: 'code',
      url: commitUrl,
      accepted: false,
      createdAt: now,
    })
  }
  if (item.status === 'planned' || item.status === 'ready') item.status = 'in_progress'
  item.updatedAt = now
}

if (matched === 0) process.exit(0)
state.events = state.events.slice(0, 100)
state.updatedAt = now
fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')

const statusResult = spawnSync(process.execPath, [path.join(graphRoot, 'scripts', 'export-status.cjs')], { cwd: graphRoot })
if (statusResult.status !== 0) {
  output('[team-graph] status.json 生成失败。')
  process.exit(0)
}

spawnSync('git', ['-C', graphRoot, 'add', 'public/data/project.json', 'public/data/status.json'])
const commit = spawnSync('git', ['-C', graphRoot, 'commit', '-m', 'chore: sync agent git state'], { encoding: 'utf8' })
if (commit.status !== 0) {
  output('[team-graph] 状态已生成，但提交失败。')
  process.exit(0)
}

if (config.autoPush === true) {
  const push = spawnSync('git', ['-C', graphRoot, 'push'], { encoding: 'utf8' })
  output(push.status === 0 ? `[team-graph] 已同步 ${nodeIds.join(', ')} 并推送状态仓库。` : '[team-graph] 状态已提交，但推送状态仓库失败。')
} else {
  output(`[team-graph] 已同步 ${nodeIds.join(', ')}；autoPush 未开启。`)
}
