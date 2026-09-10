import { mkdtempSync, cpSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { appendEvent, buildEvent, hashFacts, loadFacts } from './store.mjs'

let root

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'team-graph-store-'))
  cpSync('data', join(root, 'data'), { recursive: true })
})

describe('loadFacts', () => {
  it('把 items[].dependsOn 拍平成 dependencies', () => {
    const facts = loadFacts(root)
    expect(facts.items.length).toBeGreaterThan(20)
    const flat = facts.dependencies.find(
      (dependency) => dependency.source === 'RG-011' && dependency.target === 'RG-020',
    )
    expect(flat.kind).toBe('hard')
  })
})

describe('appendEvent dedup', () => {
  it('同一业务身份只写入一次', () => {
    const spec = {
      identity: 'git.push:o/r:abc123:RG-023',
      actorId: 'zhang',
      action: 'git.push',
      workItemId: 'RG-023',
      summary: 'test',
      createdAt: '2026-09-09T00:00:00.000Z',
    }
    expect(appendEvent(root, buildEvent(spec))).toBe(true)
    expect(appendEvent(root, buildEvent(spec))).toBe(false)

    const facts = loadFacts(root)
    expect(facts.events.filter((event) => event.identity === spec.identity)).toHaveLength(1)
  })

  it('事件按 createdAt 落到对应日期分片', () => {
    appendEvent(root, buildEvent({
      identity: 'x:1',
      actorId: 'ma',
      action: 'git.push',
      workItemId: 'RG-023',
      summary: 's',
      createdAt: '2026-09-01T10:00:00.000Z',
    }))
    const shards = readdirSync(join(root, 'data', 'events'))
    expect(shards).toContain('2026-09-01.json')
  })

  it('hashFacts 只由事实内容决定（重复调用稳定）', () => {
    const first = hashFacts(root)
    const second = hashFacts(root)
    expect(first).toBe(second)
    expect(first).toHaveLength(16)
  })

  it('读取真实仓库事实源：迁移后的证据都带来源标记', () => {
    const facts = loadFacts()
    for (const entry of facts.evidence) {
      expect(entry.source).toBe('legacy')
    }
  })
})
