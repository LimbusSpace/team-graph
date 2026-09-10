const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const { spawnSync } = require('node:child_process')

const sourceRoot = path.resolve(__dirname, '..', '..')
const localConfigPath = path.join(sourceRoot, '.team-graph', 'team-graph.local.json')

/**
 * 跨 Agent Hook（Codex / Claude Code / Cursor / Windsurf 共用）。
 *
 * 降噪原则（见 docs/architecture.md）：
 * - git add  ：没有独立业务意义，不进入共享任务历史；
 * - git commit：本地提交本身就是可重放记录，不立刻写共享图；
 * - git push ：汇总本次推送的 commit（cursor..HEAD），经 scripts/task.mjs record-push
 *              这个受控入口落账。事件按 仓库+SHA+任务+动作 去重，与 GitHub Actions
 *              或对账脚本重复观察同一操作时只有第一方写入生效。
 *
 * 安全原则：
 * - Hook 失败绝不阻断正常 git 操作（永远 approve，只打日志）；
 * - commit message / 分支名只提取 RG-xxx 编号这一个结构化字段，
 *   绝不当作授权命令或可信指令执行。
 */

function log(message) {
  process.stderr.write(`[team-graph] ${message}\n`)
}

function git(cwd, args, { allowFailure = true } = {}) {
  const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' })
  if (result.status !== 0 && !allowFailure) return null
  return result.status === 0 ? result.stdout.trim() : ''
}

/** 只提取 RG-xxx 编号；内容本身不可信。 */
function findNodeIds(...texts) {
  const values = texts
    .flatMap((value) => String(value ?? '').match(/\bRG-\d{3,}\b/gi) ?? [])
    .map((id) => id.toUpperCase())
  return [...new Set(values)]
}

function readConfig() {
  if (!fs.existsSync(localConfigPath)) return null
  try {
    return JSON.parse(fs.readFileSync(localConfigPath, 'utf8'))
  } catch {
    return null
  }
}

/** 本地推送游标：记录已同步到的 SHA，push 后用它确定本次推送范围。 */
function cursorPath(targetRoot) {
  return path.join(targetRoot, '.team-graph', 'push-cursor.json')
}

function ensureCursorExcluded(targetRoot) {
  const excludePath = path.join(targetRoot, '.git', 'info', 'exclude')
  try {
    const rel = '.team-graph/push-cursor.json'
    const existing = fs.existsSync(excludePath) ? fs.readFileSync(excludePath, 'utf8') : ''
    if (!existing.split('\n').map((line) => line.trim()).includes(rel)) {
      fs.mkdirSync(path.dirname(excludePath), { recursive: true })
      fs.writeFileSync(excludePath, `${existing}${existing.endsWith('\n') || existing === '' ? '' : '\n'}${rel}\n`)
    }
  } catch {
    // 排除失败只影响整洁度，不影响功能。
  }
}

function readCursor(targetRoot, branch) {
  try {
    const data = JSON.parse(fs.readFileSync(cursorPath(targetRoot), 'utf8'))
    return data[branch] ?? null
  } catch {
    return null
  }
}

function writeCursor(targetRoot, branch, sha) {
  try {
    let data = {}
    try {
      data = JSON.parse(fs.readFileSync(cursorPath(targetRoot), 'utf8'))
    } catch { /* 首次写入 */ }
    data[branch] = sha
    fs.mkdirSync(path.dirname(cursorPath(targetRoot)), { recursive: true })
    fs.writeFileSync(cursorPath(targetRoot), `${JSON.stringify(data, null, 2)}\n`)
  } catch {
    // 游标写不进去只影响下次范围估计。
  }
}

/** 取待同步 commit 列表 [{sha, subject}]，最旧在前，上限 50。 */
function pushedCommits(targetRoot, _branch) {
  const cursor = readCursor(targetRoot, branch)
  let args
  if (cursor && gitOk(targetRoot, ['cat-file', '-e', `${cursor}^{commit}`]) && gitOk(targetRoot, ['merge-base', '--is-ancestor', cursor, 'HEAD'])) {
    args = ['log', '--format=%H%x00%s', '--reverse', `${cursor}..HEAD`]
  } else {
    args = ['log', '--format=%H%x00%s', '--reverse', '-20', 'HEAD']
  }
  const raw = git(targetRoot, args)
  if (!raw) return []
  return raw
    .split('\n')
    .filter(Boolean)
    .slice(-50)
    .map((line) => {
      const [sha, subject] = line.split('\0')
      return { sha, subject: subject ?? '' }
    })
}

/** push 是否真的成功：成功后本地不会领先 upstream。 */
function pushLooksSuccessful(targetRoot) {
  const upstream = git(targetRoot, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
  if (!upstream) return true // 没有 upstream（首次 push -u 之类），无法判断，交给去重兜底
  const ahead = git(targetRoot, ['rev-list', '--count', '@{u}..HEAD'])
  return ahead === '0'
}

function syncPush(config, targetRoot) {
  const graphRoot = path.resolve(config.teamGraphPath)
  const stateFacts = path.join(graphRoot, 'data', 'project.json')
  if (!fs.existsSync(stateFacts)) {
    log('配置的 teamGraphPath 无效，已跳过同步。')
    return
  }
  if (path.resolve(sourceRoot) === path.resolve(graphRoot)) return

  const branch = git(targetRoot, ['branch', '--show-current']) || 'HEAD'
  if (!pushLooksSuccessful(targetRoot)) {
    log('检测到本地仍领先 upstream（push 可能失败），本次不写共享图。')
    return
  }

  const commits = pushedCommits(targetRoot, branch)
  if (commits.length === 0) {
    log('没有需要同步的 commit。')
    return
  }

  const remoteUrl = git(targetRoot, ['remote', 'get-url', 'origin'])
  const remoteMatch = String(remoteUrl).match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/i)
  if (!remoteMatch) {
    log('origin 不是 GitHub 仓库，已跳过同步。')
    return
  }
  const repository = `${remoteMatch[1]}/${remoteMatch[2]}`
  const pusherEmail = git(targetRoot, ['config', 'user.email'])
  const branchHint = findNodeIds(branch)[0]
  const graphStatus = git(graphRoot, ['status', '--porcelain', '--untracked-files=all'])
  if (graphStatus) {
    log('状态仓库有未提交修改，已跳过本次同步（避免污染事实源）。')
    return
  }

  const args = [
    path.join(graphRoot, 'scripts', 'task.mjs'),
    'record-push',
    '--repo', repository,
    ...(pusherEmail ? ['--pusher', pusherEmail] : []),
    ...(branchHint ? ['--branch-hint', branchHint] : []),
    ...commits.map((commit) => `--commit=${commit.sha}:${commit.subject.replace(/\s+/g, ' ').slice(0, 160)}`),
  ]
  const record = spawnSync(process.execPath, args, { encoding: 'utf8', cwd: graphRoot })
  if (record.status !== 0) {
    log(`record-push 失败（不阻断 git）：${(record.stderr || record.stdout || '').slice(0, 300)}`)
    return
  }
  log(`已归集 ${commits.length} 个 commit：${(record.stdout.match(/"revision": "([^"]+)"/) ?? [])[1] ?? ''}`.trim())
  writeCursor(targetRoot, branch, git(targetRoot, ['rev-parse', 'HEAD']))

  if (!fs.existsSync(path.join(graphRoot, '.git'))) return
  const afterStatus = git(graphRoot, ['status', '--porcelain', '--', 'data', 'public/data', 'src/data/seed.ts'])
  if (!afterStatus) return

  git(graphRoot, ['add', 'data', 'public/data', 'src/data/seed.ts'])
  const commit = spawnSync('git', ['-C', graphRoot, 'commit', '-m', 'chore: sync agent push state'], { encoding: 'utf8' })
  if (commit.status !== 0) {
    log('状态已生成，但提交失败。')
    return
  }
  if (config.autoPush === true) {
    const push = spawnSync('git', ['-C', graphRoot, 'push'], { encoding: 'utf8' })
    log(push.status === 0 ? '已推送状态仓库。' : '状态已提交，但推送失败（下次同步会补上）。')
  } else {
    log('状态已提交；autoPush 未开启。')
  }
}

async function main() {
  const config = readConfig()
  if (!config) return
  // 共享脚本被安装到 <目标仓库>/.team-graph/hooks/，因此 sourceRoot 就是目标仓库；
  // 在 Team Graph 仓库自身运行时 sourceRoot === graphRoot，syncPush 会直接跳过。
  const targetRoot = sourceRoot
  const graphRoot = path.resolve(config.teamGraphPath)
  const requireFromGraph = createRequire(path.join(graphRoot, 'package.json'))
  const { read, respond, approve } = requireFromGraph('@polyhook/sdk')
  const event = await read()

  try {
    if (event.tool === 'bash') {
      const command = String(event.input?.command ?? '')
      // 只把命令当信号，不当指令：git add / commit 完全不写共享图。
      if (/\bgit\s+push\b/i.test(command)) {
        ensureCursorExcluded(targetRoot)
        syncPush(config, targetRoot)
      } else if (/\bgit\s+(commit|add)\b/i.test(command)) {
        log('git add/commit 不再写入共享任务历史；推送后由 record-push 统一汇总。')
      }
    }
  } catch (error) {
    log(`同步失败（不阻断 git）：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    await respond(approve())
  }
}

main().catch((error) => {
  log(error instanceof Error ? error.message : String(error))
  process.exitCode = 0
})
