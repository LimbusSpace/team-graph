import { useMemo, useState } from 'react'
import {
  Activity,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Cloud,
  CloudOff,
  GitFork,
  ListFilter,
  MonitorUp,
  Plus,
  RefreshCw,
  ShieldCheck,
  Users,
} from 'lucide-react'
import { AuditDrawer } from './components/AuditDrawer'
import { GraphBoard } from './components/GraphBoard'
import { NewItemDialog } from './components/NewItemDialog'
import { useProject } from './hooks/useProject'
import { formatRelativeTime, memberStats, openFrontier, weightedProgress } from './lib/graph'
import type { GraphFilter } from './types'
import './App.css'

const statusOptions: { value: GraphFilter; label: string }[] = [
  { value: 'all', label: '全部状态' },
  { value: 'frontier', label: '当前可开工' },
  { value: 'pending_evidence', label: '有待审证据' },
  { value: 'ready', label: '可开工' },
  { value: 'in_progress', label: '进行中' },
  { value: 'review', label: '待审计' },
  { value: 'blocked', label: '受阻' },
  { value: 'done', label: '已验证' },
  { value: 'planned', label: '等待' },
]

function App() {
  const {
    snapshot,
    syncState,
    syncError,
    updateStatus,
    addWorkItem,
    addEvidence,
    acceptEvidence,
    refresh,
    readOnly,
  } = useProject()
  const [selectedId, setSelectedId] = useState('')
  const [ownerFilter, setOwnerFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState<GraphFilter>('all')
  const [showNewItem, setShowNewItem] = useState(false)
  const [wallMode, setWallMode] = useState(() => new URLSearchParams(window.location.search).get('wall') === '1')

  const selectedItem = snapshot.items.find((item) => item.id === selectedId)
  const progress = useMemo(() => weightedProgress(snapshot), [snapshot])
  const frontier = useMemo(() => openFrontier(snapshot), [snapshot])
  const blockedItems = snapshot.items.filter((item) => item.status === 'blocked')
  const reviewEvidence = snapshot.evidence.filter((entry) => !entry.accepted)

  const syncLabel = syncState === 'live'
    ? '实时同步'
    : syncState === 'connecting'
      ? '正在连接'
      : syncState === 'error'
        ? '同步异常'
        : '本机演示'

  const toggleWallMode = async () => {
    const nextMode = !wallMode
    setWallMode(nextMode)
    setSelectedId('')
    if (nextMode && !document.fullscreenElement) {
      await document.documentElement.requestFullscreen().catch(() => undefined)
    } else if (!nextMode && document.fullscreenElement) {
      await document.exitFullscreen().catch(() => undefined)
    }
  }

  return (
    <div className={`app-shell${wallMode ? ' wall-mode' : ''}`}>
      <header className="topbar">
        <div className="brand-block">
          <img src={`${import.meta.env.BASE_URL}project-mark.svg`} alt="" width="34" height="34" />
          <div>
            <h1>具身项目依赖台</h1>
            <p>证据驱动的团队进度审计</p>
          </div>
        </div>

        <div className="project-state">
          <span className={`sync-indicator sync-${syncState}`}>
            {syncState === 'live' ? <Cloud size={15} /> : <CloudOff size={15} />}
            {syncLabel}
          </span>
          <span className="updated-time"><Clock3 size={14} /> {formatRelativeTime(snapshot.updatedAt)}</span>
          <button type="button" className="icon-button" onClick={() => void refresh()} aria-label="刷新项目数据">
            <RefreshCw size={17} />
          </button>
          <button type="button" className="icon-button" onClick={() => void toggleWallMode()} aria-label={wallMode ? '退出投影模式' : '进入投影模式'}>
            <MonitorUp size={17} />
          </button>
          {!readOnly && <button type="button" className="primary-button new-node-button" onClick={() => setShowNewItem(true)}>
            <Plus size={16} /> 新建节点
          </button>}
        </div>
      </header>

      {readOnly && (
        <div className="mode-banner">
          <Cloud size={15} />
          GitHub-only：页面每 30 秒读取仓库状态；请用带 RG 编号的提交或 PR 更新图谱。
        </div>
      )}
      {syncState === 'error' && (
        <div className="error-banner" role="alert">
          <CircleAlert size={15} /> 共享数据库连接失败：{syncError}
        </div>
      )}

      <main className="workspace">
        <aside className="left-rail">
          <section className="progress-panel">
            <div className="progress-label">
              <span>经审计进度</span>
              <strong>{Math.round(progress.ratio * 100)}%</strong>
            </div>
            <div className="progress-track" role="progressbar" aria-label="经审计进度" aria-valuenow={Math.round(progress.ratio * 100)} aria-valuemin={0} aria-valuemax={100}>
              <span style={{ width: `${progress.ratio * 100}%` }} />
            </div>
            <p>{progress.completedItems} / {progress.totalItems} 个节点完成验收</p>
          </section>

          <section className="signal-grid" aria-label="项目状态摘要">
            <button type="button" onClick={() => setStatusFilter('frontier')}>
              <GitFork size={16} />
              <strong>{frontier.length}</strong>
              <span>当前可开工</span>
            </button>
            <button type="button" onClick={() => setStatusFilter('blocked')}>
              <CircleAlert size={16} />
              <strong>{blockedItems.length}</strong>
              <span>阻塞项</span>
            </button>
            <button type="button" onClick={() => setStatusFilter('pending_evidence')}>
              <ShieldCheck size={16} />
              <strong>{reviewEvidence.length}</strong>
              <span>待审证据</span>
            </button>
          </section>

          <section className="rail-section">
            <div className="rail-heading">
              <span><ListFilter size={15} /> 图谱筛选</span>
              {(ownerFilter !== 'all' || statusFilter !== 'all') && (
                <button type="button" onClick={() => { setOwnerFilter('all'); setStatusFilter('all') }}>清除</button>
              )}
            </div>
            <label className="filter-field">
              <span>负责人</span>
              <select value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)}>
                <option value="all">全部成员</option>
                {snapshot.members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
              </select>
            </label>
            <label className="filter-field">
              <span>状态</span>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as GraphFilter)}>
                {statusOptions.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
              </select>
            </label>
          </section>

          <section className="rail-section team-section">
            <div className="rail-heading"><span><Users size={15} /> 团队贡献</span></div>
            <div className="member-list">
              {snapshot.members.map((member) => {
                const stats = memberStats(member, snapshot)
                const selected = ownerFilter === member.id
                return (
                  <button
                    type="button"
                    key={member.id}
                    className={selected ? 'is-selected' : ''}
                    onClick={() => setOwnerFilter(selected ? 'all' : member.id)}
                  >
                    <span className="member-avatar">{member.initials}</span>
                    <span className="member-copy">
                      <strong>{member.name}</strong>
                      <small>{member.role}</small>
                      <em>{stats.completed} 完成 · {stats.active} 进行 · {stats.frontier} 可开工</em>
                    </span>
                    <span className="member-counts">
                      <b>{stats.acceptedEvidence}</b>
                      <small>证据</small>
                    </span>
                  </button>
                )
              })}
            </div>
          </section>
        </aside>

        <section className="main-stage">
          <header className="stage-header">
            <div>
              <span className="stage-kicker">项目全貌</span>
              <h2>Claim D 实证路径</h2>
            </div>
            <div className="graph-legend" aria-label="图例">
              <span><i className="dot done" />已验证</span>
              <span><i className="dot active" />可开工</span>
              <span><i className="dot review" />待审计</span>
              <span><i className="dot blocked" />受阻</span>
              <span><i className="line soft" />软依赖</span>
            </div>
          </header>
          <GraphBoard
            snapshot={snapshot}
            selectedId={selectedId}
            ownerFilter={ownerFilter}
            statusFilter={statusFilter}
            onSelect={setSelectedId}
          />
        </section>

        <aside className="activity-rail">
          <div className="rail-heading"><span><Activity size={15} /> 最近贡献</span></div>
          <div className="activity-list">
            {snapshot.events.slice(0, 14).map((event) => {
              const actor = snapshot.members.find((member) => member.id === event.actorId)
              return (
                <button
                  type="button"
                  key={event.id}
                  onClick={() => event.workItemId && setSelectedId(event.workItemId)}
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

        {selectedItem && (
          <AuditDrawer
            key={selectedItem.id}
            item={selectedItem}
            snapshot={snapshot}
            onClose={() => setSelectedId('')}
            onSelect={setSelectedId}
            onStatusChange={(status) => updateStatus(selectedItem.id, status)}
            onAddEvidence={addEvidence}
            onAcceptEvidence={acceptEvidence}
            readOnly={readOnly}
          />
        )}
      </main>

      {showNewItem && (
        <NewItemDialog snapshot={snapshot} onClose={() => setShowNewItem(false)} onCreate={addWorkItem} />
      )}
    </div>
  )
}

export default App
