import { execFileSync } from 'node:child_process'
import { mkdtempSync, cpSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * task.mjs 端到端测试：在临时目录复制 data/ 事实源，
 * 用 TEAM_GRAPH_ROOT 指过去，验证真实 CLI 行为（含门槛与去重）。
 */

let root

const run = (args, { expectFailure = false } = {}) => {
  try {
    const stdout = execFileSync(process.execPath, [join('scripts', 'task.mjs'), ...args], {
      encoding: 'utf8',
      env: { ...process.env, TEAM_GRAPH_ROOT: root },
      cwd: join(import.meta.dirname, '..'),
    })
    if (expectFailure) throw new Error(`命令意外成功：${args.join(' ')}\n${stdout}`)
    return JSON.parse(stdout)
  } catch (error) {
    if (expectFailure && error.status === 1) {
      return JSON.parse(error.stdout)
    }
    throw error
  }
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'team-graph-cli-'))
  cpSync('data', join(root, 'data'), { recursive: true })
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('task context', () => {
  it('只输出当前任务必需的上下文', () => {
    const context = run(['context', 'RG-023'])
    expect(context.id).toBe('RG-023')
    expect(context).toHaveProperty('hard_dependencies')
    expect(context).toHaveProperty('evidence_summary')
    expect(context).toHaveProperty('allowed_actions')
    // 默认不输出历史流水与证据正文
    expect(context.history).toBeUndefined()
    expect(context.evidence).toBeUndefined()
  })

  it('--include 显式展开证据与历史', () => {
    const context = run(['context', 'RG-014', '--include', 'evidence', '--include', 'history'])
    expect(context.evidence?.length).toBeGreaterThan(0)
    expect(context.history?.length).toBeGreaterThan(0)
  })

  it('不存在的任务返回结构化错误', () => {
    const result = run(['context', 'RG-999'], { expectFailure: true })
    expect(result.ok).toBe(false)
    expect(result.code).toBe('ITEM_NOT_FOUND')
  })
})

describe('push 落账与去重', () => {
  it('record-push 生成证据并推进 in_progress，重复执行幂等', () => {
    const first = run(['record-push', '--repo', 'o/r', '--commit', '1111111:RG-023: draft schema', '--actor', 'zhang'])
    expect(first.ok).toBe(true)
    const second = run(['record-push', '--repo', 'o/r', '--commit', '1111111:RG-023: draft schema', '--actor', 'zhang'])
    expect(second.duplicate).toBe(true)

    const context = run(['context', 'RG-023'])
    expect(context.state).toBe('in_progress')
    expect(context.evidence_summary.pending).toBe(1)
  })

  it('done 之后的新 push 只追加证据，不回退状态', () => {
    run(['record-push', '--repo', 'o/r', '--commit', '2222222:RG-012: follow-up after done', '--actor', 'zhang'])
    const context = run(['context', 'RG-012'])
    expect(context.state).toBe('done')
    expect(context.evidence_summary.pending).toBeGreaterThan(0)
  })
})

describe('审计门槛', () => {
  it('submit-audit 需要先开工', () => {
    const result = run(['submit-audit', 'RG-030'], { expectFailure: true })
    expect(result.code).toBe('INVALID_TRANSITION')
  })

  it('complete 需要审计人（结构合法但缺条件时给门槛错误）', () => {
    run(['status', 'set', 'RG-034', 'in_progress', '--actor', 'ma'])
    const evidence = run(['evidence', 'add', 'RG-034', '--kind', 'experiment', '--title', '门槛测试证据', '--actor', 'ma'])
    run(['submit-audit', 'RG-034'])
    const noReviewer = run(['complete', 'RG-034'], { expectFailure: true })
    expect(noReviewer.code).toBe('REVIEWER_REQUIRED')
    run(['evidence', 'decline', evidence.evidenceId, '--reviewer', 'zhang'])
  })

  it('完整流程：开工 → 提交证据 → 提交审计 → 审计通过 → 完成', () => {
    run(['status', 'set', 'RG-024', 'in_progress', '--actor', 'deng'])
    const evidence = run(['evidence', 'add', 'RG-024', '--kind', 'code', '--title', '同步驱动 v1', '--ref', '3333333', '--actor', 'deng'])
    expect(evidence.ok).toBe(true)
    expect(run(['submit-audit', 'RG-024']).ok).toBe(true)
    expect(run(['evidence', 'accept', evidence.evidenceId, '--reviewer', 'ma', '--note', '复现通过']).ok).toBe(true)
    const done = run(['complete', 'RG-024', '--reviewer', 'ma'])
    expect(done.ok).toBe(true)
    expect(run(['context', 'RG-024']).state).toBe('done')
  })

  it('审计退回后 evidence 状态为 declined，可重新提交', () => {
    run(['status', 'set', 'RG-035', 'in_progress', '--actor', 'ma'])
    const evidence = run(['evidence', 'add', 'RG-035', '--kind', 'experiment', '--title', '初测未达标', '--actor', 'ma'])
    run(['submit-audit', 'RG-035'])
    expect(run(['evidence', 'decline', evidence.evidenceId, '--reviewer', 'zhang', '--note', '指标未达标']).ok).toBe(true)
    const context = run(['context', 'RG-035', '--include', 'evidence'])
    expect(context.evidence_summary.declined).toBe(1)
    expect(context.evidence.find((entry) => entry.id === evidence.evidenceId).state).toBe('declined')
  })

  it('版本冲突检测：--expect-revision 不匹配时拒绝写入', () => {
    const result = run([
      'evidence', 'add', 'RG-034', '--kind', 'document', '--title', '冲突测试',
      '--actor', 'ma', '--expect-revision', '0000000000000000',
    ], { expectFailure: true })
    expect(result.code).toBe('REVISION_CONFLICT')
  })
})

describe('图校验', () => {
  it('迁移后的真实数据通过全图校验，且历史数据给出可追溯警告', () => {
    const result = run(['validate'])
    expect(result.ok).toBe(true)
    expect(result.warnings.some((warning) => warning.includes('审计人未记录'))).toBe(true)
  })
})
