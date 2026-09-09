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

const stateUrl = `${import.meta.env.BASE_URL}data/project.json`

export function useProject() {
  const [snapshot, setSnapshot] = useState<ProjectSnapshot>(seedSnapshot)
  const [syncState, setSyncState] = useState<SyncState>('connecting')
  const [syncError, setSyncError] = useState('')
  const refreshPending = useRef(false)

  const refresh = useCallback(async () => {
    if (refreshPending.current) return
    refreshPending.current = true
    try {
      const response = await fetch(`${stateUrl}?t=${Date.now()}`, { cache: 'no-store' })
      if (!response.ok) throw new Error(`状态文件加载失败（${response.status}）`)
      const remote = await response.json() as ProjectSnapshot
      setSnapshot(remote)
      setSyncState('live')
      setSyncError('')
    } catch (error) {
      setSyncState('error')
      setSyncError(error instanceof Error ? error.message : '无法连接共享数据库')
    } finally {
      refreshPending.current = false
    }
  }, [])

  useEffect(() => {
    const initialRefresh = window.setTimeout(() => void refresh(), 0)
    const interval = window.setInterval(() => void refresh(), 30_000)
    return () => {
      window.clearTimeout(initialRefresh)
      window.clearInterval(interval)
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

      throw new Error('GitHub-only 模式请通过带 RG 编号的提交或 PR 更新状态。')
    },
    [snapshot],
  )

  const addWorkItem = useCallback(
    async (input: NewWorkItemInput) => {
      void input
      throw new Error('GitHub-only 模式请通过 GitHub 提交变更。')
    },
    [],
  )

  const addEvidence = useCallback(
    async (input: NewEvidenceInput) => {
      void input
      throw new Error('GitHub-only 模式请通过 GitHub 提交或 PR 添加证据。')
    },
    [],
  )

  const acceptEvidence = useCallback(
    async (evidenceId: string) => {
      const evidence = snapshot.evidence.find((entry) => entry.id === evidenceId)
      if (!evidence || evidence.accepted) return

      throw new Error('GitHub-only 模式请通过修改状态文件的 PR 完成审计。')
    },
    [snapshot],
  )

  return useMemo(
    () => ({
      snapshot,
      syncState,
      syncError,
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
      refresh,
      snapshot,
      syncError,
      syncState,
      updateStatus,
    ],
  )
}
