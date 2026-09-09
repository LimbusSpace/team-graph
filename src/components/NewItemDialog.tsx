import { useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import { phaseOrder } from '../lib/graph'
import type { NewWorkItemInput, ProjectSnapshot, WorkStatus, WorkType } from '../types'

interface NewItemDialogProps {
  snapshot: ProjectSnapshot
  onClose: () => void
  onCreate: (input: NewWorkItemInput) => Promise<string>
}

const initialForm: NewWorkItemInput = {
  title: '',
  summary: '',
  type: 'task',
  phase: 'P1 闭环',
  status: 'planned',
  ownerIds: [],
  acceptanceCriteria: '',
  prerequisiteIds: [],
}

export function NewItemDialog({ snapshot, onClose, onCreate }: NewItemDialogProps) {
  const [form, setForm] = useState(initialForm)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (form.ownerIds.length === 0) {
      setError('至少选择一名负责人。')
      return
    }
    setSaving(true)
    setError('')
    try {
      await onCreate(form)
      onClose()
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : '创建失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose()
    }}>
      <section className="new-item-dialog" role="dialog" aria-modal="true" aria-labelledby="new-item-title">
        <header>
          <div>
            <span className="dialog-kicker">新增可审计工作</span>
            <h2 id="new-item-title">新建依赖节点</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </header>
        <form onSubmit={handleSubmit}>
          <label className="full-field">
            <span>节点名称</span>
            <input required autoFocus value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
          </label>
          <label className="full-field">
            <span>要解决的问题</span>
            <textarea required rows={2} value={form.summary} onChange={(event) => setForm({ ...form, summary: event.target.value })} />
          </label>
          <label>
            <span>类型</span>
            <select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value as WorkType })}>
              <option value="task">任务</option>
              <option value="experiment">实验</option>
              <option value="gate">决策门</option>
              <option value="claim">论点</option>
              <option value="release">交付</option>
            </select>
          </label>
          <label>
            <span>阶段</span>
            <select value={form.phase} onChange={(event) => setForm({ ...form, phase: event.target.value })}>
              {phaseOrder.map((phase) => <option key={phase}>{phase}</option>)}
            </select>
          </label>
          <label>
            <span>初始状态</span>
            <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as WorkStatus })}>
              <option value="planned">等待</option>
              <option value="ready">可开工</option>
              <option value="in_progress">进行中</option>
              <option value="blocked">受阻</option>
            </select>
          </label>
          <fieldset className="full-field check-field">
            <legend>负责人</legend>
            {snapshot.members.map((member) => (
              <label key={member.id}>
                <input
                  type="checkbox"
                  checked={form.ownerIds.includes(member.id)}
                  onChange={(event) => setForm({
                    ...form,
                    ownerIds: event.target.checked
                      ? [...form.ownerIds, member.id]
                      : form.ownerIds.filter((id) => id !== member.id),
                  })}
                />
                {member.name}
              </label>
            ))}
          </fieldset>
          <label className="full-field">
            <span>硬依赖</span>
            <select
              multiple
              value={form.prerequisiteIds}
              onChange={(event) => setForm({
                ...form,
                prerequisiteIds: [...event.target.selectedOptions].map((option) => option.value),
              })}
              aria-describedby="dependency-help"
            >
              {snapshot.items.filter((item) => item.type !== 'mission').map((item) => (
                <option key={item.id} value={item.id}>{item.id} · {item.title}</option>
              ))}
            </select>
            <small id="dependency-help">按 Ctrl 可多选；这些节点通过后才能开始。</small>
          </label>
          <label className="full-field">
            <span>验收标准</span>
            <textarea required rows={3} value={form.acceptanceCriteria} onChange={(event) => setForm({ ...form, acceptanceCriteria: event.target.value })} />
          </label>
          {error && <p className="form-error full-field" role="alert">{error}</p>}
          <footer className="full-field">
            <button type="button" className="secondary-button" onClick={onClose}>取消</button>
            <button type="submit" className="primary-button" disabled={saving}>{saving ? '创建中' : '创建节点'}</button>
          </footer>
        </form>
      </section>
    </div>
  )
}
