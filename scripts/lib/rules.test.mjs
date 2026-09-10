import { describe, expect, it } from 'vitest'
import {
  evaluateTransition,
  mergePolicy,
  unmetHardDependencies,
  validateGraph,
} from './rules.mjs'

function fixtureFacts() {
  return {
    project: { members: [{ id: 'ma' }, { id: 'zhang' }] },
    items: [
      { id: 'RG-001', title: '上游', type: 'task', status: 'done', ownerIds: ['ma'], weight: 1, lane: 0, acceptanceCriteria: 'x', dependsOn: [] },
      { id: 'RG-002', title: '下游', type: 'task', status: 'review', ownerIds: ['ma'], weight: 1, lane: 1, acceptanceCriteria: 'x', dependsOn: [{ id: 'RG-001', kind: 'hard' }] },
      { id: 'RG-003', title: '实验', type: 'experiment', status: 'in_progress', ownerIds: ['zhang'], weight: 1, lane: 2, acceptanceCriteria: 'x', dependsOn: [] },
      { id: 'RG-004', title: '锚点', type: 'mission', status: 'planned', ownerIds: ['ma'], weight: 3, lane: 3, acceptanceCriteria: 'x', dependsOn: [] },
    ],
    evidence: [
      { id: 'EV-050', workItemId: 'RG-001', actorId: 'ma', title: '上游通过的证据', kind: 'code', accepted: true, audit: { decision: 'accepted', reviewerId: 'zhang', reviewedAt: '2026-09-01T00:00:00Z' }, createdAt: '2026-09-01T00:00:00Z' },
      { id: 'EV-100', workItemId: 'RG-002', actorId: 'ma', title: '通过的证据', kind: 'code', accepted: true, audit: { decision: 'accepted', reviewerId: 'zhang', reviewedAt: '2026-09-01T00:00:00Z' }, createdAt: '2026-09-01T00:00:00Z' },
      { id: 'EV-200', workItemId: 'RG-003', actorId: 'zhang', title: '待审证据', kind: 'experiment', accepted: false, createdAt: '2026-09-01T00:00:00Z' },
    ],
    events: [],
    dependencies: [
      { source: 'RG-001', target: 'RG-002', kind: 'hard' },
    ],
  }
}

describe('state machine', () => {
  it('拒绝缺失审计人的完成操作', () => {
    const facts = fixtureFacts()
    const result = evaluateTransition(facts, facts.items[1], 'done')
    expect(result.ok).toBe(false)
    expect(result.code).toBe('REVIEWER_REQUIRED')
  })

  it('done 必须有通过审计的证据', () => {
    const facts = fixtureFacts()
    facts.items[1].dependsOn = []
    facts.dependencies = []
    const noEvidence = { ...facts, evidence: [] }
    const result = evaluateTransition(noEvidence, noEvidence.items[1], 'done', { reviewerId: 'zhang' })
    expect(result.code).toBe('NO_ACCEPTED_EVIDENCE')

    const result2 = evaluateTransition(facts, facts.items[1], 'done', { reviewerId: 'zhang' })
    expect(result2.ok).toBe(true)
  })

  it('硬依赖未完成时给出 blocking 列表', () => {
    const facts = fixtureFacts()
    facts.items[0].status = 'in_progress' // 上游重新打开
    const result = evaluateTransition(facts, facts.items[1], 'done', { reviewerId: 'zhang' })
    expect(result.code).toBe('HARD_DEPENDENCY_OPEN')
    expect(result.blocking).toEqual(['RG-001'])
  })

  it('不允许 planned 直接跳到 review', () => {
    const facts = fixtureFacts()
    const planned = { ...facts.items[0], status: 'planned' }
    const result = evaluateTransition(facts, planned, 'review')
    expect(result.ok).toBe(false)
    expect(result.code).toBe('INVALID_TRANSITION')
  })

  it('mission 类型完全锁定，不接受自动推进', () => {
    const facts = fixtureFacts()
    const result = evaluateTransition(facts, facts.items[3], 'in_progress')
    expect(result.code).toBe('TYPE_LOCKED')
  })

  it('unmetHardDependencies 只统计未完成的硬依赖', () => {
    const facts = fixtureFacts()
    expect(unmetHardDependencies(facts, facts.items[1]).map((item) => item.id)).toEqual([])
    facts.items[0].status = 'review'
    expect(unmetHardDependencies(facts, facts.items[1]).map((item) => item.id)).toEqual(['RG-001'])
  })
})

describe('per-type merge policy', () => {
  it('代码任务合并且进入待审计，实验/论点/决策门只生成证据', () => {
    expect(mergePolicy('task').autoReview).toBe(true)
    expect(mergePolicy('release').autoReview).toBe(true)
    expect(mergePolicy('experiment').autoReview).toBe(false)
    expect(mergePolicy('claim').autoReview).toBe(false)
    expect(mergePolicy('gate').autoReview).toBe(false)
    expect(mergePolicy('mission').locked).toBe(true)
    expect(mergePolicy('mission').autoStart).toBe(false)
  })
})

describe('validateGraph', () => {
  it('接受合法图', () => {
    expect(validateGraph(fixtureFacts()).ok).toBe(true)
  })

  it('捕获悬空依赖、缺审计人和 done 但硬依赖未完成', () => {
    const facts = fixtureFacts()
    facts.items[1].dependsOn.push({ id: 'RG-999', kind: 'hard' })
    facts.dependencies.push({ source: 'RG-999', target: 'RG-002', kind: 'hard' })
    facts.evidence.push({ id: 'EV-300', workItemId: 'RG-002', actorId: 'ma', title: '缺审计人', kind: 'code', accepted: true, createdAt: '2026-09-01T00:00:00Z' })
    facts.items[0].status = 'planned'
    const result = validateGraph(facts)
    expect(result.ok).toBe(false)
    expect(result.errors.some((message) => message.includes('RG-999'))).toBe(true)
    expect(result.errors.some((message) => message.includes('EV-300'))).toBe(true)
  })

  it('捕获硬依赖环', () => {
    const facts = fixtureFacts()
    // RG-001 依赖 RG-002，RG-002 也依赖 RG-001 → 环
    facts.items[0].dependsOn = [{ id: 'RG-002', kind: 'hard' }]
    facts.items[0].status = 'planned'
    facts.items[1].status = 'planned'
    facts.dependencies = [
      { source: 'RG-001', target: 'RG-002', kind: 'hard' },
      { source: 'RG-002', target: 'RG-001', kind: 'hard' },
    ]
    const result = validateGraph(facts)
    expect(result.errors).toContain('硬依赖图存在环')
  })
})
