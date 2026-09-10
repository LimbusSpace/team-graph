import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DATA_DIR, EVENTS_DIR, repoRoot } from './lib/paths.mjs'
import { ensureDirs, saveEvidence, saveItem, saveProject, writeJson, eventShardName } from './lib/store.mjs'

/**
 * 一次性迁移：旧版单文件 public/data/project.json → data/ 事实源。
 * 幂等：已存在 data/project.json 时拒绝执行（避免覆盖事实源）。
 * 旧文件保留为 public/data/project.json.legacy（由调用方决定是否提交）。
 */
const root = repoRoot()
const legacyPath = join(root, 'public', 'data', 'project.json')
const factsProjectPath = join(root, DATA_DIR, 'project.json')

if (!existsSync(legacyPath)) {
  console.error('找不到 public/data/project.json，无需迁移。')
  process.exit(1)
}
if (existsSync(factsProjectPath)) {
  console.error('data/project.json 已存在，拒绝重复迁移。')
  process.exit(1)
}

const legacy = JSON.parse(readFileSync(legacyPath, 'utf8'))
ensureDirs(root)

saveProject(root, {
  schemaVersion: 1,
  name: '具身项目依赖台',
  description: '面向五人具身操作数据项目的共享依赖、证据和进度审计工作台。',
  members: legacy.members,
})

for (const item of legacy.items) {
  const dependsOn = legacy.dependencies
    .filter((dependency) => dependency.target === item.id)
    .map((dependency) => ({ id: dependency.source, kind: dependency.kind }))
  saveItem(root, {
    ...item,
    ...(dependsOn.length > 0 ? { dependsOn } : {}),
  })
}

for (const entry of legacy.evidence) {
  saveEvidence(root, {
    ...entry,
    source: 'legacy',
    ...(entry.accepted
      ? {
          audit: {
            decision: 'accepted',
            reviewerId: null,
            reviewedAt: entry.createdAt,
            note: '历史证据迁移：旧版未记录审计人，需在下次复审时补记。',
            legacy: true,
          },
        }
      : {}),
  })
}

const byDay = new Map()
for (const event of legacy.events) {
  const day = eventShardName(event.createdAt)
  if (!byDay.has(day)) byDay.set(day, [])
  byDay.get(day).push(event)
}
for (const [day, events] of byDay) {
  writeJson(join(root, EVENTS_DIR, day), events)
}

console.log(`迁移完成：${legacy.items.length} 个任务、${legacy.evidence.length} 条证据、${legacy.events.length} 条活动。`)
console.log('下一步：node scripts/build-data.mjs 重新生成发布产物。')
