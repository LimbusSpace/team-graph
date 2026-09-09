const fs = require('node:fs')

const snapshot = JSON.parse(fs.readFileSync('public/data/project.json', 'utf8'))
const trackable = snapshot.items.filter((item) => item.type !== 'mission')
const total = trackable.reduce((sum, item) => sum + item.weight, 0)
const completedItems = trackable.filter((item) => item.status === 'done')
const completed = completedItems.reduce((sum, item) => sum + item.weight, 0)
const status = {
  generatedAt: snapshot.updatedAt,
  project: '具身项目依赖台',
  progress: total === 0 ? 0 : Math.round((completed / total) * 100),
  completed: completedItems.length,
  total: trackable.length,
  frontier: snapshot.items.filter((item) => {
    if (item.status === 'done' || item.status === 'blocked') return false
    return snapshot.dependencies
      .filter((dependency) => dependency.target === item.id && dependency.kind === 'hard')
      .every((dependency) => snapshot.items.find((candidate) => candidate.id === dependency.source)?.status === 'done')
  }).length,
  blocked: snapshot.items.filter((item) => item.status === 'blocked').length,
  pendingEvidence: snapshot.evidence.filter((entry) => !entry.accepted).length,
  active: snapshot.items
    .filter((item) => item.status === 'in_progress' || item.status === 'review')
    .map((item) => ({ id: item.id, title: item.title, status: item.status, owners: item.ownerIds })),
}

fs.writeFileSync('public/data/status.json', `${JSON.stringify(status, null, 2)}\n`)
