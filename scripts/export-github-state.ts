import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { seedSnapshot } from '../src/data/seed'
import { openFrontier, weightedProgress } from '../src/lib/graph'

const root = resolve(process.cwd())
const snapshotPath = resolve(root, 'public/data/project.json')
const statusPath = resolve(root, 'public/data/status.json')

const snapshot = structuredClone(seedSnapshot)
const progress = weightedProgress(snapshot)

const status = {
  generatedAt: snapshot.updatedAt,
  project: '具身项目依赖台',
  progress: Math.round(progress.ratio * 100),
  completed: progress.completedItems,
  total: progress.totalItems,
  frontier: openFrontier(snapshot).length,
  blocked: snapshot.items.filter((item) => item.status === 'blocked').length,
  pendingEvidence: snapshot.evidence.filter((entry) => !entry.accepted).length,
  active: snapshot.items.filter((item) => item.status === 'in_progress' || item.status === 'review').map((item) => ({
    id: item.id,
    title: item.title,
    status: item.status,
    owners: item.ownerIds,
  })),
}

await mkdir(dirname(snapshotPath), { recursive: true })
await writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
await writeFile(statusPath, `${JSON.stringify(status, null, 2)}\n`, 'utf8')
console.log(`Exported ${snapshot.items.length} items to ${snapshotPath}`)
