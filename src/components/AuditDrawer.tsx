import { useMemo, useState, type FormEvent } from 'react'
import {
  Check,
  ExternalLink,
  FileCheck2,
  GitBranch,
  Link2,
  LockKeyhole,
  X,
} from 'lucide-react'
import { formatRelativeTime, hardDependents, hardPrerequisites, isOpenFrontier, statusBadgeCopy, unmetPrerequisites } from '../lib/graph'
import type {
  NewEvidenceInput,
  ProjectSnapshot,
  WorkItem,
  WorkStatus,
} from '../types'

interface AuditDrawerProps {
  item: WorkItem
  snapshot: ProjectSnapshot
  onClose: () => void
  onSelect: (id: string) => void
  onStatusChange: (status: WorkStatus) => Promise<void>
  onAddEvidence: (input: NewEvidenceInput) => Promise<void>
  onAcceptEvidence: (evidenceId: string) => Promise<void>
  readOnly?: boolean
}

const statuses: { value: WorkStatus; label: string }[] = [
  { value: 'planned', label: '等待' },
  { value: 'ready', label: '可开工' },
  { value: 'in_progress', label: '进行中' },
  { value: 'review', label: '待审计' },
  { value: 'done', label: '已验证' },
  { value: 'blocked', label: '受阻' },
]

const REPO_URL = 'https://github.com/LimbusSpace/team-graph'

function evidenceSummary(acceptedCount: number, pendingCount: number) {
  if (acceptedCount > 0 && pendingCount > 0) {
    return `已有 ${acceptedCount} 条证据通过审计，另有 ${pendingCount} 条待审计。`
  }
  if (acceptedCount > 0) return `已有 ${acceptedCount} 条证据通过审计。`
  if (pendingCount > 0) return `已有 ${pendingCount} 条证据待审计。`
  return '目前尚无证据。'
}

export function AuditDrawer({
  item,
  snapshot,
  onClose,
  onSelect,
  onStatusChange,
  onAddEvidence,
  onAcceptEvidence,
  readOnly = false,
}: AuditDrawerProps) {
  const [showEvidenceForm, setShowEvidenceForm] = useState(false)
  const [error, setError] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [evidenceForm, setEvidenceForm] = useState<NewEvidenceInput>({
    workItemId: item.id,
    actorId: item.ownerIds[0] ?? snapshot.members[0]?.id,
    title: '',
    url: '',
    kind: 'experiment',
  })
  const itemById = useMemo(
    () => new Map(snapshot.items.map((candidate) => [candidate.id, candidate])),
    [snapshot.items],
  )
  const owners = item.ownerIds
    .map((id) => snapshot.members.find((member) => member.id === id))
    .filter((owner) => owner !== undefined)
  const prerequisites = hardPrerequisites(item.id, snapshot.dependencies)
    .map((id) => itemById.get(id))
    .filter((candidate): candidate is WorkItem => Boolean(candidate))
  const dependents = hardDependents(item.id, snapshot.dependencies)
    .map((id) => itemById.get(id))
    .filter((candidate): candidate is WorkItem => Boolean(candidate))
  const blockers = unmetPrerequisites(item, snapshot)
  const evidence = snapshot.evidence.filter((entry) => entry.workItemId === item.id)
  const acceptedEvidence = evidence.filter((entry) => entry.accepted)
  const pendingEvidence = evidence.filter((entry) => !entry.accepted)
  const badge = statusBadgeCopy(item, {
    isFrontier: isOpenFrontier(item, snapshot),
    blockerCount: blockers.length,
    acceptedEvidenceCount: acceptedEvidence.length,
    pendingEvidenceCount: pendingEvidence.length,
  })

  let nextStep: string
  switch (item.status) {
    case 'done':
      nextStep = '该节点已通过验收，可以推进下游节点。'
      break
    case 'blocked':
      nextStep = '节点被标记为异常受阻：先解决前置依赖，或与负责人确认恢复计划。'
      break
    case 'review':
      nextStep = `等待审计：全部证据通过后即可验收。${evidenceSummary(acceptedEvidence.length, pendingEvidence.length)}`
      break
    case 'in_progress':
      nextStep = `推进完成后，提交审计证据。${evidenceSummary(acceptedEvidence.length, pendingEvidence.length)}`
      break
    default:
      nextStep = blockers.length > 0
        ? `先完成下方 ${blockers.length} 项未满足的硬依赖，再开工本节点。`
        : `前置依赖已满足，可以开工。完成后提交审计证据。${evidenceSummary(acceptedEvidence.length, pendingEvidence.length)}`
  }

  const handleStatusChange = async (status: WorkStatus) => {
    setError('')
    try {
      await onStatusChange(status)
    } catch (changeError) {
      setError(changeError instanceof Error ? changeError.message : '状态更新失败')
    }
  }

  const handleEvidenceSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!evidenceForm.title.trim()) return
    setIsSaving(true)
    setError('')
    try {
      await onAddEvidence({ ...evidenceForm, workItemId: item.id })
      setEvidenceForm((current) => ({ ...current, title: '', url: '' }))
      setShowEvidenceForm(false)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '证据提交失败')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <aside className="audit-drawer" aria-label={`${item.title} 任务详情`}>
      <header className="drawer-header">
        <div>
          <span className="drawer-id">{item.id} · {item.phase}</span>
          <h2>{item.title}</h2>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="关闭详情">
          <X size={18} />
        </button>
      </header>

      <div className="drawer-statusline">
        <span className={`node-badge badge-${badge.tone}`}>{badge.label}</span>
        <span className="drawer-owners">
          {owners.length > 0
            ? `负责人：${owners.map((owner) => owner.name).join('、')}`
            : '尚未指定负责人'}
        </span>
      </div>

      <p className="drawer-summary">{item.summary}</p>

      {!readOnly && (
        <section className="drawer-section">
          <label className="section-label" htmlFor="node-status">节点状态</label>
          <select
            id="node-status"
            className="select-control"
            value={item.status}
            onChange={(event) => void handleStatusChange(event.target.value as WorkStatus)}
          >
            {statuses.map((status) => (
              <option key={status.value} value={status.value}>{status.label}</option>
            ))}
          </select>
          {error && <p className="form-error" role="alert">{error}</p>}
        </section>
      )}

      {blockers.length > 0 && item.status !== 'done' && (
        <p className="constraint-note"><LockKeyhole size={14} /> {blockers.length} 个硬依赖尚未通过</p>
      )}
      {item.status !== 'done' && acceptedEvidence.length === 0 && (
        <p className="constraint-note"><FileCheck2 size={14} /> 完成前需要通过至少一条证据</p>
      )}

      <section className="drawer-section next-step">
        <span className="section-label">下一步</span>
        <p>{nextStep}</p>
      </section>

      <section className="drawer-section">
        <span className="section-label">验收标准</span>
        <p className="acceptance-criteria">{item.acceptanceCriteria}</p>
      </section>

      <section className="drawer-section">
        <span className="section-label">前置依赖</span>
        {prerequisites.length === 0 ? (
          <p className="empty-line">无硬依赖</p>
        ) : prerequisites.map((candidate) => (
          <button key={candidate.id} type="button" className="dependency-row" onClick={() => onSelect(candidate.id)}>
            {candidate.status === 'done'
              ? <Check size={13} className="dep-done" />
              : <LockKeyhole size={13} className="dep-locked" />}
            <b>{candidate.id}</b>
            <span className="dep-title">{candidate.title}</span>
            <em>{candidate.status === 'done' ? '已完成' : '未完成'}</em>
          </button>
        ))}
      </section>

      <section className="drawer-section">
        <span className="section-label">完成后解锁</span>
        {dependents.length === 0 ? (
          <p className="empty-line">无下游节点</p>
        ) : dependents.map((candidate) => (
          <button key={candidate.id} type="button" className="dependency-row" onClick={() => onSelect(candidate.id)}>
            <GitBranch size={13} />
            <b>{candidate.id}</b>
            <span className="dep-title">{candidate.title}</span>
          </button>
        ))}
      </section>

      <section className="drawer-section evidence-section">
        <div className="section-heading-row">
          <span className="section-label">证据与审计 · {evidence.length}</span>
          {!readOnly && (
            <button type="button" className="text-button" onClick={() => setShowEvidenceForm((value) => !value)}>
              <Link2 size={14} /> 添加证据
            </button>
          )}
        </div>

        {showEvidenceForm && (
          <form className="evidence-form" onSubmit={handleEvidenceSubmit}>
            <label>
              <span>提交人</span>
              <select
                value={evidenceForm.actorId}
                onChange={(event) => setEvidenceForm((current) => ({ ...current, actorId: event.target.value }))}
              >
                {snapshot.members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
              </select>
            </label>
            <label>
              <span>证据类型</span>
              <select
                value={evidenceForm.kind}
                onChange={(event) => setEvidenceForm((current) => ({ ...current, kind: event.target.value as NewEvidenceInput['kind'] }))}
              >
                <option value="experiment">实验</option>
                <option value="code">代码</option>
                <option value="document">文档</option>
                <option value="decision">决策记录</option>
                <option value="link">外部链接</option>
              </select>
            </label>
            <label className="full-field">
              <span>结果摘要</span>
              <input
                required
                value={evidenceForm.title}
                onChange={(event) => setEvidenceForm((current) => ({ ...current, title: event.target.value }))}
                placeholder="写清结果和测量条件"
              />
            </label>
            <label className="full-field">
              <span>证据链接</span>
              <input
                value={evidenceForm.url}
                onChange={(event) => setEvidenceForm((current) => ({ ...current, url: event.target.value }))}
                placeholder="PR、报告、实验日志或数据版本"
              />
            </label>
            <button type="submit" className="primary-button" disabled={isSaving}>
              {isSaving ? '提交中' : '提交审计'}
            </button>
          </form>
        )}

        <div className="evidence-list">
          {evidence.length === 0 && <p className="empty-line">暂无证据</p>}
          {evidence.map((entry) => {
            const actor = snapshot.members.find((member) => member.id === entry.actorId)
            return (
              <article key={entry.id} className="evidence-row">
                <div>
                  <span className={`evidence-state ${entry.accepted ? 'accepted' : ''}`}>
                    {entry.accepted ? <Check size={12} /> : null}
                    {entry.accepted ? '已通过' : '待审计'}
                  </span>
                  <strong>{entry.title}</strong>
                  <small>{actor?.name ?? '未知成员'} · {formatRelativeTime(entry.createdAt)}</small>
                </div>
                <div className="evidence-actions">
                  {entry.url && (
                    <a href={entry.url} target="_blank" rel="noreferrer" aria-label="打开证据链接">
                      <ExternalLink size={15} />
                    </a>
                  )}
                  {!readOnly && !entry.accepted && (
                    <button type="button" onClick={() => void onAcceptEvidence(entry.id)}>通过</button>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      </section>

      <footer className="drawer-footer">
        <a className="primary-button" href={REPO_URL} target="_blank" rel="noreferrer">
          <ExternalLink size={15} /> 去 GitHub 处理
        </a>
        <small>通过带 {item.id} 编号的提交或 PR 更新此节点</small>
      </footer>
    </aside>
  )
}
