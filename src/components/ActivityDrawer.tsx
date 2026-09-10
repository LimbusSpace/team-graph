import { CheckCircle2, X } from 'lucide-react'
import { formatRelativeTime } from '../lib/graph'
import type { ProjectSnapshot } from '../types'

interface ActivityDrawerProps {
  snapshot: ProjectSnapshot
  onClose: () => void
  onSelect: (id: string) => void
}

export function ActivityDrawer({ snapshot, onClose, onSelect }: ActivityDrawerProps) {
  return (
    <aside className="activity-drawer" aria-label="最近贡献">
      <header className="drawer-header">
        <div>
          <span className="drawer-id">团队动态</span>
          <h2>最近贡献</h2>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="关闭动态">
          <X size={18} />
        </button>
      </header>

      <div className="activity-list">
        {snapshot.events.length === 0 && <p className="empty-line">暂无动态</p>}
        {snapshot.events.slice(0, 30).map((event) => {
          const actor = snapshot.members.find((member) => member.id === event.actorId)
          return (
            <button
              type="button"
              key={event.id}
              onClick={() => event.workItemId && onSelect(event.workItemId)}
              disabled={!event.workItemId}
            >
              <span className="activity-avatar">{actor?.initials ?? '?'}</span>
              <span>
                <strong>{actor?.name ?? '系统'}</strong>
                <p>{event.summary}</p>
                <small>{formatRelativeTime(event.createdAt)}</small>
              </span>
            </button>
          )
        })}
      </div>

      <footer className="audit-rule">
        <CheckCircle2 size={16} />
        <p><strong>完成 = 依赖通过 + 证据通过</strong><br />提交次数不直接计为进度。</p>
      </footer>
    </aside>
  )
}
