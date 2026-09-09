import type { Dependency, ProjectSnapshot, TeamMember, WorkItem } from '../types'

export const phaseOrder = ['P0 定义', 'P1 闭环', 'P2 实证', 'P3 主张']

export function hardPrerequisites(itemId: string, dependencies: Dependency[]) {
  return dependencies
    .filter((dependency) => dependency.target === itemId && dependency.kind === 'hard')
    .map((dependency) => dependency.source)
}

export function hardDependents(itemId: string, dependencies: Dependency[]) {
  return dependencies
    .filter((dependency) => dependency.source === itemId && dependency.kind === 'hard')
    .map((dependency) => dependency.target)
}

export function unmetPrerequisites(item: WorkItem, snapshot: ProjectSnapshot) {
  const itemsById = new Map(snapshot.items.map((candidate) => [candidate.id, candidate]))

  return hardPrerequisites(item.id, snapshot.dependencies)
    .map((id) => itemsById.get(id))
    .filter((candidate): candidate is WorkItem => Boolean(candidate && candidate.status !== 'done'))
}

export function isOpenFrontier(item: WorkItem, snapshot: ProjectSnapshot) {
  if (item.status === 'done' || item.status === 'blocked') return false
  return unmetPrerequisites(item, snapshot).length === 0
}

export function openFrontier(snapshot: ProjectSnapshot) {
  return snapshot.items.filter((item) => isOpenFrontier(item, snapshot))
}

export function weightedProgress(snapshot: ProjectSnapshot) {
  const trackable = snapshot.items.filter((item) => item.type !== 'mission')
  const total = trackable.reduce((sum, item) => sum + item.weight, 0)
  const completed = trackable
    .filter((item) => item.status === 'done')
    .reduce((sum, item) => sum + item.weight, 0)

  return {
    completed,
    total,
    ratio: total === 0 ? 0 : completed / total,
    completedItems: trackable.filter((item) => item.status === 'done').length,
    totalItems: trackable.length,
  }
}

export function memberStats(member: TeamMember, snapshot: ProjectSnapshot) {
  const ownedItems = snapshot.items.filter((item) => item.ownerIds.includes(member.id))
  const acceptedEvidence = snapshot.evidence.filter(
    (entry) => entry.actorId === member.id && entry.accepted,
  )

  return {
    completed: ownedItems.filter((item) => item.status === 'done').length,
    active: ownedItems.filter((item) => item.status === 'in_progress' || item.status === 'review').length,
    frontier: ownedItems.filter((item) => isOpenFrontier(item, snapshot)).length,
    acceptedEvidence: acceptedEvidence.length,
    lastContributionAt: acceptedEvidence
      .map((entry) => entry.createdAt)
      .sort((left, right) => right.localeCompare(left))[0],
  }
}

export function nextWorkItemId(items: WorkItem[]) {
  const highest = items.reduce((max, item) => {
    const match = /^RG-(\d+)$/.exec(item.id)
    return match ? Math.max(max, Number(match[1])) : max
  }, 0)

  return `RG-${String(highest + 1).padStart(3, '0')}`
}

export function hasDependencyCycle(items: WorkItem[], dependencies: Dependency[]) {
  const indegree = new Map(items.map((item) => [item.id, 0]))
  const adjacency = new Map(items.map((item) => [item.id, [] as string[]]))

  dependencies
    .filter((dependency) => dependency.kind === 'hard')
    .forEach((dependency) => {
      if (!indegree.has(dependency.source) || !indegree.has(dependency.target)) return
      indegree.set(dependency.target, (indegree.get(dependency.target) ?? 0) + 1)
      adjacency.get(dependency.source)?.push(dependency.target)
    })

  const queue = [...indegree.entries()]
    .filter(([, degree]) => degree === 0)
    .map(([id]) => id)
  let visited = 0

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current) break
    visited += 1
    adjacency.get(current)?.forEach((target) => {
      const nextDegree = (indegree.get(target) ?? 1) - 1
      indegree.set(target, nextDegree)
      if (nextDegree === 0) queue.push(target)
    })
  }

  return visited !== items.length
}

export function formatRelativeTime(isoDate: string, now = new Date()) {
  const then = new Date(isoDate)
  const milliseconds = now.getTime() - then.getTime()
  const minutes = Math.max(0, Math.floor(milliseconds / 60_000))

  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`

  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} 天前`

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
  }).format(then)
}
