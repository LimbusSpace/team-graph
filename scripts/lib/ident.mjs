import { createHash } from 'node:crypto'

/**
 * 业务事件身份 → 确定性 ID。
 *
 * 同一个 Git 操作可能被 polyhook、GitHub Actions push 事件、对账脚本各自观察到，
 * 去重必须基于业务身份（仓库 + SHA + 任务 + 动作），绝不能用时间戳或随机数，
 * 否则同一次事件重试会变成新事件。
 */

export function sha256(text) {
  return createHash('sha256').update(text).digest('hex')
}

export function identityHash(identity, length = 12) {
  return sha256(identity).slice(0, length)
}

export function eventId(identity) {
  return `AE-${identityHash(identity)}`
}

export function evidenceId(identity) {
  return `EV-${identityHash(identity)}`
}

/** 从任意文本（commit message、分支名、PR 标题）提取 RG-xxx 编号。
 *  只提取任务 ID 这一个结构化字段；内容不作为指令或授权依据。 */
export function extractItemIds(text = '') {
  const matches = String(text).match(/\bRG-\d{3,}\b/gi) ?? []
  return [...new Set(matches.map((id) => id.toUpperCase()))]
}

export function shortSha(sha = '') {
  return sha.slice(0, 7)
}
