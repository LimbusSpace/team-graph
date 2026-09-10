import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { seedSnapshot } from '../data/seed'
import { unmetPrerequisites } from '../lib/graph'
import type {
  NewEvidenceInput,
  NewWorkItemInput,
  ProjectSnapshot,
  SyncState,
  WorkStatus,
} from '../types'

/**
 * 数据同步策略（静态轮询，GitHub-only 架构）：
 *
 *   轮询 manifest.json → revision 未变：结束
 *                      → revision 变了：加载 project.json
 *   点开任务详情时才需要的重数据已在 project.json 中，30s 内足够新鲜。
 *
 * - 页面隐藏时暂停轮询，重新可见立即检查一次；
 * - 请求失败按 30s → 60s → 120s → 240s 退避重试；
 * - 只接受比当前 revision 新的响应，避免乱序回退；
 * - 这是带宽/渲染优化，不是实时同步：界面明确显示“最后同步时间”。
 */

const BASE = import.meta.env.BASE_URL
const MANIFEST_URL = `${BASE}data/manifest.json`
const SNAPSHOT_URL = `${BASE}data/project.json`
const POLL_INTERVAL_MS = 30_000
const MAX_BACKOFF_MS = 240_000

interface Manifest {
  version: number
  revision: string
  generatedAt: string
}

export function useProject() {
  const [snapshot, setSnapshot] = useState<ProjectSnapshot>(seedSnapshot)
  const [syncState, setSyncState] = useState<SyncState>('connecting')
  const [syncError, setSyncError] = useState('')
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null)
  const revisionRef = useRef<string | null>(null)
  const requestSeq = useRef(0)
  const refreshPending = useRef(false)
  const failureCount = useRef(0)

  const applySnapshot = useCallback((next: ProjectSnapshot) => {
    setSnapshot(next)
    if (next.revision) revisionRef.current = next.revision
  }, [])

  const loadSnapshot = useCallback(async () => {
    const seq = ++requestSeq.current
    const response = await fetch(`${SNAPSHOT_URL}?rev=${revisionRef.current ?? 'init'}`, { cache: 'no-store' })
    if (!response.ok) throw new Error(`状态文件加载失败（${response.status}）`)
    const remote = await response.json() as ProjectSnapshot
    if (seq !== requestSeq.current) return // 乱序响应，丢弃
    // revision 哈希只判断“是否不同”；manifest 已确认有变化才会走到这里。
    if (!revisionRef.current || !remote.revision || remote.revision !== revisionRef.current) {
      applySnapshot(remote)
    }
    setLastSyncedAt(new Date().toISOString())
    setSyncState('live')
    setSyncError('')
  }, [applySnapshot])

  const refresh = useCallback(async () => {
    if (refreshPending.current) return
    refreshPending.current = true
    try {
      // manifest 很小；revision 没变就不下载整张图。
      const response = await fetch(`${MANIFEST_URL}?t=${Date.now()}`, { cache: 'no-store' })
      if (!response.ok) throw new Error(`manifest 加载失败（${response.status}）`)
      const manifest = await response.json() as Manifest
      if (revisionRef.current && manifest.revision === revisionRef.current) {
        setLastSyncedAt(new Date().toISOString())
        setSyncState('live')
        setSyncError('')
      } else {
        await loadSnapshot()
      }
      failureCount.current = 0
    } catch (error) {
      failureCount.current += 1
      setSyncState('error')
      setSyncError(error instanceof Error ? error.message : '无法加载共享状态')
    } finally {
      refreshPending.current = false
    }
  }, [loadSnapshot])

  useEffect(() => {
    let timer: number | undefined
    let cancelled = false

    const schedule = () => {
      const backoff = Math.min(POLL_INTERVAL_MS * 2 ** failureCount.current, MAX_BACKOFF_MS)
      timer = window.setTimeout(() => void tick(), document.hidden ? backoff * 4 : backoff)
    }

    const tick = async () => {
      if (cancelled) return
      if (document.hidden) {
        schedule() // 页面隐藏：不请求，只顺延
        return
      }
      await refresh()
      if (!cancelled) schedule()
    }

    const onVisible = () => {
      if (document.hidden) return
      window.clearTimeout(timer)
      window.setTimeout(() => {
        void refresh().then(() => {
          if (!cancelled) schedule()
        })
      }, 0)
    }

    timer = window.setTimeout(() => void tick(), 0)
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh])

  const updateStatus = useCallback(
    async (itemId: string, status: WorkStatus) => {
      const item = snapshot.items.find((candidate) => candidate.id === itemId)
      if (!item || item.status === status) return

      if (status === 'done') {
        const blockers = unmetPrerequisites(item, snapshot)
        if (blockers.length > 0) {
          throw new Error(`还有 ${blockers.length} 个硬依赖未完成。`)
        }
        const hasAcceptedEvidence = snapshot.evidence.some(
          (entry) => entry.workItemId === itemId && entry.accepted,
        )
        if (!hasAcceptedEvidence) {
          throw new Error('至少需要一条通过审计的证据才能完成节点。')
        }
      }

      throw new Error('看板为只读：请运行 node scripts/task.mjs（如 submit-audit / complete）或提交带 RG 编号的 PR。')
    },
    [snapshot],
  )

  const addWorkItem = useCallback(
    async (input: NewWorkItemInput) => {
      void input
      throw new Error('看板为只读：请运行 node scripts/task.mjs item create --title ... 或直接提交 PR 修改 data/items/。')
    },
    [],
  )

  const addEvidence = useCallback(
    async (input: NewEvidenceInput) => {
      void input
      throw new Error('看板为只读：请运行 node scripts/task.mjs evidence add <RG-xxx> --kind code --title ...')
    },
    [],
  )

  const acceptEvidence = useCallback(
    async (evidenceId: string) => {
      const evidence = snapshot.evidence.find((entry) => entry.id === evidenceId)
      if (!evidence || evidence.accepted) return

      throw new Error('看板为只读：审计请运行 node scripts/task.mjs evidence accept <EV-xxx> --reviewer <成员ID>，并让受保护的 PR review 记录授权。')
    },
    [snapshot],
  )

  return useMemo(
    () => ({
      snapshot,
      syncState,
      syncError,
      lastSyncedAt,
      updateStatus,
      addWorkItem,
      addEvidence,
      acceptEvidence,
      refresh,
      readOnly: true,
    }),
    [
      acceptEvidence,
      addEvidence,
      addWorkItem,
      lastSyncedAt,
      refresh,
      snapshot,
      syncError,
      syncState,
      updateStatus,
    ],
  )
}
