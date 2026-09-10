import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import {
  DATA_DIR,
  EVIDENCE_DIR,
  EVENTS_DIR,
  HANDOFFS_DIR,
  ITEMS_DIR,
  repoRoot,
} from './paths.mjs'
import { eventId as makeEventId } from './ident.mjs'

/**
 * 事实源读写层。所有写入方（task.mjs、update-github-state、reconcile、polyhook）
 * 都必须经过这里，保证：
 * - 每类信息只有一个事实源（data/）；
 * - 原子写入（临时文件 + rename），写坏一半不会污染状态；
 * - 事件按业务身份去重，重复执行不会重复追加。
 */

export function atomicWrite(filePath, content) {
  const tmp = `${filePath}.tmp-${process.pid}`
  writeFileSync(tmp, content, 'utf8')
  renameSync(tmp, filePath)
}

export function writeJson(filePath, value) {
  atomicWrite(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

export function readJson(filePath, fallback) {
  if (!existsSync(filePath)) return fallback
  return JSON.parse(readFileSync(filePath, 'utf8'))
}

function listJsonFiles(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((name) => name.endsWith('.json')).sort()
}

export function eventShardName(createdAt) {
  return `${createdAt.slice(0, 10)}.json`
}

/** 加载全部事实源并派生扁平 dependencies（items[].dependsOn 是唯一事实）。 */
export function loadFacts(root = repoRoot()) {
  const project = readJson(join(root, DATA_DIR, 'project.json'), null)
  if (!project) throw new Error(`事实源缺失：${DATA_DIR}/project.json`)

  const items = listJsonFiles(join(root, ITEMS_DIR)).map((name) =>
    readJson(join(root, ITEMS_DIR, name), null),
  ).filter(Boolean)

  const evidence = listJsonFiles(join(root, EVIDENCE_DIR)).map((name) =>
    readJson(join(root, EVIDENCE_DIR, name), null),
  ).filter(Boolean)

  const events = []
  for (const name of listJsonFiles(join(root, EVENTS_DIR))) {
    const shard = readJson(join(root, EVENTS_DIR, name), [])
    if (Array.isArray(shard)) events.push(...shard)
  }
  events.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))

  const dependencies = []
  const seen = new Set()
  for (const item of items) {
    for (const dependency of item.dependsOn ?? []) {
      const key = `${item.id}>${dependency.id}:${dependency.kind}`
      if (seen.has(key)) continue
      seen.add(key)
      dependencies.push({ source: dependency.id, target: item.id, kind: dependency.kind })
    }
  }

  return { root, project, items, evidence, events, dependencies }
}

/** 事实源内容指纹：发布 manifest.revision 用，前端据此判断是否重新加载。 */
export function hashFacts(root = repoRoot()) {
  const files = collectFactFiles(root).sort((left, right) => left.path.localeCompare(right.path))
  const hash = createHash('sha256')
  for (const file of files) {
    hash.update(file.path)
    hash.update('\x00')
    hash.update(file.content)
    hash.update('\x01')
  }
  return hash.digest('hex').slice(0, 16)
}

function collectFactFiles(root) {
  const files = []
  const pushDir = (dir) => {
    const full = join(root, dir)
    if (!existsSync(full)) return
    for (const name of readdirSync(full).sort()) {
      if (name.endsWith('.json')) files.push({ path: `${dir}/${name}`, content: readFileSync(join(full, name)) })
    }
  }
  const projectFile = join(root, DATA_DIR, 'project.json')
  if (existsSync(projectFile)) {
    files.push({ path: `${DATA_DIR}/project.json`, content: readFileSync(projectFile) })
  }
  pushDir(ITEMS_DIR)
  pushDir(EVIDENCE_DIR)
  pushDir(EVENTS_DIR)
  return files
}

export function saveItem(root, item) {
  writeJson(join(root, ITEMS_DIR, `${item.id}.json`), item)
}

export function saveEvidence(root, entry) {
  writeJson(join(root, EVIDENCE_DIR, `${entry.id}.json`), entry)
}

export function saveProject(root, project) {
  writeJson(join(root, DATA_DIR, 'project.json'), project)
}

function readShard(root, name) {
  return readJson(join(root, EVENTS_DIR, name), [])
}

function writeShard(root, name, events) {
  writeJson(join(root, EVENTS_DIR, name), events)
}

/** 按业务身份去重后追加事件；identity 相同的重复上报静默忽略，返回是否真正写入。 */
export function appendEvent(root, event) {
  const shardName = eventShardName(event.createdAt)
  const shard = readShard(root, shardName)
  const duplicate = shard.some((existing) =>
    existing.id === event.id || (event.identity && existing.identity === event.identity),
  )
  if (duplicate) return false
  shard.push(event)
  writeShard(root, shardName, shard)
  return true
}

/** 跨全部分片检查业务身份是否已存在（写入前调用来做幂等判断）。 */
export function hasEventIdentity(root, identity) {
  for (const name of listJsonFiles(join(root, EVENTS_DIR))) {
    const shard = readShard(root, name)
    if (shard.some((existing) => existing.identity === identity)) return true
  }
  return false
}

export function buildEvent({ identity, actorId, action, workItemId, summary, createdAt, metadata }) {
  return {
    id: identity ? makeEventId(identity) : `AE-manual-${createdAt}-${Math.random().toString(16).slice(2, 8)}`,
    actorId,
    action,
    workItemId,
    summary,
    createdAt,
    ...(identity ? { identity } : {}),
    ...(metadata ? { metadata } : {}),
  }
}

export function recordEvent(root, spec) {
  const event = buildEvent(spec)
  return appendEvent(root, event) ? event : null
}

export function ensureDirs(root) {
  for (const dir of [ITEMS_DIR, EVIDENCE_DIR, EVENTS_DIR, HANDOFFS_DIR]) {
    mkdirSync(join(root, dir), { recursive: true })
  }
}

export function handoffDir(root, itemId) {
  return join(root, HANDOFFS_DIR, itemId)
}

export function latestHandoff(root, itemId) {
  const dir = handoffDir(root, itemId)
  if (!existsSync(dir)) return null
  const files = readdirSync(dir).filter((name) => name.endsWith('.md')).sort()
  if (files.length === 0) return null
  const fileName = files[files.length - 1]
  const content = readFileSync(join(dir, fileName), 'utf8')
  const meta = {}
  const header = content.match(/<!--\s*team-graph-handoff\s*([\s\S]*?)-->/)
  if (header) {
    for (const line of header[1].split('\n')) {
      const match = line.match(/^\s*([\w-]+):\s*(.+?)\s*$/)
      if (match) meta[match[1]] = match[2]
    }
  }
  return { file: `data/handoffs/${itemId}/${fileName}`, content, meta }
}

export function saveHandoff(root, itemId, fileName, content) {
  const dir = handoffDir(root, itemId)
  mkdirSync(dir, { recursive: true })
  atomicWrite(join(dir, fileName), content)
}

export function clearDerivedItems(root, publicItemsDir) {
  rmSync(join(root, publicItemsDir), { recursive: true, force: true })
}
