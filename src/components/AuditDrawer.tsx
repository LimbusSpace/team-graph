import { useMemo, useState, type FormEvent } from 'react'
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  ExternalLink,
  FileCheck2,
  GitBranch,
  Link2,
  LockKeyhole,
  X,
} from 'lucide-react'
import { formatRelativeTime, hardDependents, hardPrerequisites, unmetPrerequisites } from '../lib/graph'
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
    <aside className="audit-drawer" aria-label={`${item.title} 审计详情`}>
      <header className="drawer-header">
        <div>
          <span className="drawer-id">{item.id} · {item.phase}</span>
          <h2>{item.title}</h2>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="关闭详情">
          <X size={18} />
        </button>
      </header>

      <p className="drawer-summary">{item.summary}</p>

      <section className="drawer-section">
        <span className="section-label">负责人</span>
        <div className="owner-list">
          {owners.map((owner) => (
            <span key={owner.id} className="owner-chip">
              <b>{owner.initials}</b> {owner.name} · {owner.role}
            </span>
          ))}
        </div>
      </section>

      <section className="drawer-section">
        <label className="section-label" htmlFor="node-status">节点状态</label>
        <select
          id="node-status"
          className="select-control"
          value={item.status}
          disabled={readOnly}
          onChange={(event) => void handleStatusChange(event.target.value as WorkStatus)}
        >
          {statuses.map((status) => (
            <option key={status.value} value={status.value}>{status.label}</option>
          ))}
        </select>
        {blockers.length > 0 && (
          <p className="constraint-note"><LockKeyhole size={14} /> {blockers.length} 个硬依赖尚未通过</p>
        )}
        {item.status !== 'done' && acceptedEvidence.length === 0 && (
          <p className="constraint-note"><FileCheck2 size={14} /> 完成前需要通过至少一条证据</p>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
      </section>

      <section className="drawer-section acceptance-block">
        <span className="section-label">验收标准</span>
        <p>{item.acceptanceCriteria}</p>
      </section>

      <section className="drawer-section dependency-section">
        <span className="section-label">依赖关系</span>
        <div className="dependency-group">
          <span><ArrowDownToLine size={14} /> 硬依赖</span>
          {prerequisites.length === 0 ? (
            <p className="empty-line">无</p>
          ) : prerequisites.map((candidate) => (
            <button key={candidate.id} type="button" onClick={() => onSelect(candidate.id)}>
              {candidate.status === 'done' ? <Check size={13} /> : <LockKeyhole size={13} />}
              {candidate.id} {candidate.title}
            </button>
          ))}
        </div>
        <div className="dependency-group">
          <span><ArrowUpFromLine size={14} /> 解锁下游</span>
          {dependents.length === 0 ? (
            <p className="empty-line">无</p>
          ) : dependents.map((candidate) => (
            <button key={candidate.id} type="button" onClick={() => onSelect(candidate.id)}>
              <GitBranch size={13} /> {candidate.id} {candidate.title}
            </button>
          ))}
        </div>
      </section>

      <section className="drawer-section evidence-section">
        <div className="section-heading-row">
          <span className="section-label">证据 · {evidence.length}</span>
          {!readOnly && <button type="button" className="text-button" onClick={() => setShowEvidenceForm((value) => !value)}>
            <Link2 size={14} /> 添加证据
          </button>}
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
          {evidence.length === 0 && <p className="empty-line">还没有证据</p>}
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
    </aside>
  )
}
