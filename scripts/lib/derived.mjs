import { dirname, join } from 'node:path'
import { mkdirSync, readFileSync } from 'node:fs'
import {
  PUBLIC_DATA_DIR,
  PUBLIC_ITEMS_DIR,
  SEED_FILE,
  repoRoot,
} from './paths.mjs'
import { buildContext } from './context.mjs'
import { evidenceForItem } from './rules.mjs'
import { atomicWrite, hashFacts } from './store.mjs'

/**
 * 发布产物构建：data/（事实源）→ public/data/*（前端、Rainmeter、Agent 详情）。
 *
 * - project.json / status.json / manifest.json 由同一次构建生成，口径一致；
 * - manifest.revision 只由事实源内容决定，重建不改变内容就不会改变 revision；
 * - 项目摘要是“前端完整视图”，不等于 Agent 每次需要的上下文（那是 task context）。
 */

export function snapshotFromFacts(facts, { revision }) {
  // 前端快照保持扁平 schema：依赖统一走 dependencies 数组，
  // 事实源独有的 dependsOn / relevantFiles 不进入发布视图。
  const itemFields = [
    'id', 'title', 'summary', 'type', 'phase', 'status', 'ownerIds',
    'acceptanceCriteria', 'weight', 'lane', 'updatedAt',
  ]
  const items = facts.items
    .map((item) => Object.fromEntries(itemFields
      .filter((field) => item[field] !== undefined)
      .map((field) => [field, item[field]])))
    .sort((left, right) => left.id.localeCompare(right.id))
  const dependencies = [...facts.dependencies].sort((left, right) =>
    `${left.source}${left.target}${left.kind}`.localeCompare(`${right.source}${right.target}${right.kind}`),
  )
  const evidence = [...facts.evidence].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
  )
  const events = [...facts.events]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 100)

  const timestamps = [
    ...items.map((item) => item.updatedAt),
    ...evidence.map((entry) => entry.createdAt),
    ...facts.events.map((event) => event.createdAt),
  ].sort()
  const updatedAt = timestamps[timestamps.length - 1] ?? new Date().toISOString()

  return {
    revision,
    members: facts.project.members,
    items,
    dependencies,
    evidence,
    events,
    updatedAt,
  }
}

export function statusFromSnapshot(snapshot, projectName) {
  const trackable = snapshot.items.filter((item) => item.type !== 'mission')
  const completedItems = trackable.filter((item) => item.status === 'done')
  const hardDeps = snapshot.dependencies.filter((dependency) => dependency.kind === 'hard')
  const itemById = new Map(snapshot.items.map((item) => [item.id, item]))

  return {
    generatedAt: snapshot.updatedAt,
    project: projectName,
    progress: weightedProgressPercent(trackable),
    completed: completedItems.length,
    total: trackable.length,
    frontier: snapshot.items.filter((item) => isFrontier(item, hardDeps, itemById)).length,
    blocked: snapshot.items.filter((item) => item.status === 'blocked').length,
    pendingEvidence: snapshot.evidence.filter((entry) => !entry.accepted).length,
    active: snapshot.items
      .filter((item) => item.status === 'in_progress' || item.status === 'review')
      .map((item) => ({ id: item.id, title: item.title, status: item.status, owners: item.ownerIds })),
  }
}

function weightedProgressPercent(trackable) {
  const total = trackable.reduce((sum, item) => sum + item.weight, 0)
  const completed = trackable
    .filter((item) => item.status === 'done')
    .reduce((sum, item) => sum + item.weight, 0)
  return total === 0 ? 0 : Math.round((completed / total) * 100)
}

function isFrontier(item, hardDeps, itemById) {
  if (item.status === 'done' || item.status === 'blocked') return false
  return hardDeps
    .filter((dependency) => dependency.target === item.id)
    .every((dependency) => itemById.get(dependency.source)?.status === 'done')
}

function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

function itemDetail(facts, item, revision, root) {
  const context = buildContext(facts, item.id, { include: ['evidence', 'history'], revision, root })
  const evidence = evidenceForItem(facts, item.id)
  return {
    ...context,
    evidence_count: evidence.length,
    generated_hint: '此文件由 scripts/build-data.mjs 生成，请勿手工编辑；事实源在 data/items/。',
  }
}

/** 生成全部发布文件（内存中），返回 [{path, content}]。 */
export function buildDerivedFiles(facts, { revision, generatedAt }) {
  const snapshot = snapshotFromFacts(facts, { revision })
  const status = statusFromSnapshot(snapshot)
  const manifest = {
    version: 1,
    revision,
    generatedAt,
    counts: {
      items: snapshot.items.length,
      evidence: snapshot.evidence.length,
      events: snapshot.events.length,
    },
  }

  const files = [
    { path: `${PUBLIC_DATA_DIR}/project.json`, content: serialize(snapshot) },
    { path: `${PUBLIC_DATA_DIR}/status.json`, content: serialize(status) },
    { path: `${PUBLIC_DATA_DIR}/manifest.json`, content: serialize(manifest) },
    { path: SEED_FILE, content: seedFileContent(snapshot) },
  ]

  for (const item of snapshot.items) {
    files.push({
      path: `${PUBLIC_ITEMS_DIR}/${item.id}.json`,
      content: serialize(itemDetail(facts, item, revision)),
    })
  }

  return files
}

function seedFileContent(snapshot) {
  return [
    'import type { ProjectSnapshot } from \'../types\'',
    '',
    '// 由 scripts/build-data.mjs 从 data/ 事实源生成，请勿手工编辑。',
    '// 修改数据请编辑 data/ 目录，然后运行 node scripts/build-data.mjs。',
    `export const seedSnapshot: ProjectSnapshot = ${JSON.stringify(snapshot, null, 2)}`,
    '',
  ].join('\n')
}

/**
 * 写出或校验发布产物。
 * check=true 时不写入，逐字节比较磁盘内容，用于 CI 保证“发布快照与事实源一致”。
 */
export function rebuildDerived(root = repoRoot(), { facts, check = false } = {}) {
  if (!facts) throw new Error('rebuildDerived 需要传入 facts（loadFacts 的返回值）')
  const revision = hashFacts(root)
  const files = buildDerivedFiles(facts, { revision })

  const changed = []
  for (const file of files) {
    const fullPath = join(root, file.path)
    let existing = null
    try {
      existing = readFileSync(fullPath, 'utf8')
    } catch {
      existing = null
    }
    if (existing !== file.content) changed.push(file.path)
  }

  if (!check) {
    for (const file of files) {
      mkdirSync(dirname(join(root, file.path)), { recursive: true })
      atomicWrite(join(root, file.path), file.content)
    }
  }

  return { revision, changed, files: files.map((file) => file.path) }
}
