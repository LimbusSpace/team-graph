import { describe, expect, it } from 'vitest'
import { seedSnapshot } from '../data/seed'
import { hasDependencyCycle, nextWorkItemId, openFrontier, weightedProgress } from './graph'

describe('dependency graph', () => {
  it('only opens nodes whose hard prerequisites are done', () => {
    const frontierIds = openFrontier(seedSnapshot).map((item) => item.id)

    expect(frontierIds).toContain('RG-020')
    expect(frontierIds).toContain('RG-023')
    expect(frontierIds).not.toContain('RG-030')
    expect(frontierIds).not.toContain('RG-021')
  })

  it('keeps the seed graph acyclic', () => {
    expect(hasDependencyCycle(seedSnapshot.items, seedSnapshot.dependencies)).toBe(false)
  })

  it('reports accepted progress from completed work only', () => {
    const progress = weightedProgress(seedSnapshot)

    expect(progress.completedItems).toBe(4)
    expect(progress.totalItems).toBe(seedSnapshot.items.length - 1)
    expect(progress.ratio).toBeGreaterThan(0)
    expect(progress.ratio).toBeLessThan(1)
  })

  it('allocates the next stable project id', () => {
    expect(nextWorkItemId(seedSnapshot.items)).toBe('RG-061')
  })
})
