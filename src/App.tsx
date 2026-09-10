import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  Activity,
  ChevronDown,
  CircleAlert,
  GitFork,
  ListFilter,
  MonitorUp,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Users,
} from 'lucide-react'
import { ActivityDrawer } from './components/ActivityDrawer'
import { AuditDrawer } from './components/AuditDrawer'
import { GraphBoard } from './components/GraphBoard'
import { NewItemDialog } from './components/NewItemDialog'
import { useProject } from './hooks/useProject'
import { formatRelativeTime, formatWeight, memberStats, openFrontier, weightedProgress } from './lib/graph'
import type { GraphFilter } from './types'
import './App.css'

const quickFilters: { value: GraphFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'frontier', label: '可开工' },
  { value: 'in_progress', label: '进行中' },
  { value: 'review', label: '待审计' },
  { value: 'blocked', label: '受阻' },
]

const GITHUB_BADGE_TIP = 'GitHub 驱动 · 只读：页面每 30 秒读取仓库中的状态文件，本页不能直接编辑。用带 RG 编号的提交或 PR 推进节点；通过审计和标记完成需要在 project.json 中明确修改。'

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
  const [showActivity, setShowActivity] = useState(false)
  const [ownerFilter, setOwnerFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState<GraphFilter>('all')
  const [showNewItem, setShowNewItem] = useState(false)
  const [teamExpanded, setTeamExpanded] = useState(false)
  const [query, setQuery] = useState('')
  const [focusRequest, setFocusRequest] = useState<{ id: string; nonce: number } | null>(null)
  const [lastCheckedAt, setLastCheckedAt] = useState('')
  const [now, setNow] = useState(() => new Date())
  const [wallMode, setWallMode] = useState(() => new URLSearchParams(window.location.search).get('wall') === '1')

  const selectedItem = snapshot.items.find((item) => item.id === selectedId)
  const progress = useMemo(() => weightedProgress(snapshot), [snapshot])
  const frontier = useMemo(() => openFrontier(snapshot), [snapshot])
  const blockedItems = snapshot.items.filter((item) => item.status === 'blocked')
  const reviewEvidence = snapshot.evidence.filter((entry) => !entry.accepted)
  const filtersActive = ownerFilter !== 'all' || statusFilter !== 'all'

  useEffect(() => {
    const ticker = window.setInterval(() => setNow(new Date()), 15_000)
    return () => window.clearInterval(ticker)
  }, [])

  const handleRefresh = useCallback(async () => {
    await refresh()
    setLastCheckedAt(new Date().toISOString())
  }, [refresh])

  // Opening one drawer closes the other: 动态与任务详情从不同时展开。
  const selectNode = useCallback((id: string) => {
    setShowActivity(false)
    setSelectedId(id)
  }, [])
  const toggleActivity = useCallback(() => {
    setSelectedId('')
    setShowActivity((value) => !value)
  }, [])

  const submitSearch = (event: FormEvent) => {
    event.preventDefault()
    const text = query.trim().toLowerCase()
    if (!text) return
    const hit = snapshot.items.find((item) => item.id.toLowerCase() === text)
      ?? snapshot.items.find((item) => item.id.toLowerCase().includes(text) || item.title.toLowerCase().includes(text))
    if (!hit) return
    selectNode(hit.id)
    setFocusRequest({ id: hit.id, nonce: Date.now() })
    setQuery(hit.id)
  }

  const syncStateLabel = syncState === 'live'
    ? '数据检查正常'
    : syncState === 'connecting'
      ? '正在检查数据'
      : syncState === 'error'
        ? '数据检查异常'
        : '本机演示'
  const lastCheckedLabel = lastCheckedAt ? formatRelativeTime(lastCheckedAt, now) : '—'

  const toggleWallMode = async () => {
    const nextMode = !wallMode
    setWallMode(nextMode)
    setSelectedId('')
    setShowActivity(false)
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
          {readOnly && (
            <button type="button" className="github-badge" aria-label="数据来源说明">
              GitHub 驱动 · 只读
              <span className="badge-pop" role="tooltip">{GITHUB_BADGE_TIP}</span>
            </button>
          )}

          <form className="top-search" onSubmit={submitSearch} role="search">
            <Search size={14} aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索 RG-xxx 或标题"
              aria-label="搜索节点"
              list="rg-node-options"
            />
            <datalist id="rg-node-options">
              {snapshot.items.map((item) => (
                <option key={item.id} value={item.id}>{item.title}</option>
              ))}
            </datalist>
          </form>

          <div
            className="sync-block"
            title={syncState === 'error' ? `数据检查异常：${syncError}` : '每 30 秒自动检查一次状态文件'}
          >
            <span className={`sync-indicator sync-${syncState}`}>{syncStateLabel}</span>
            <span className="sync-detail">
              最近检查：{lastCheckedLabel} · 最近业务更新：{formatRelativeTime(snapshot.updatedAt, now)}
            </span>
          </div>

          <button
            type="button"
            className={`text-button activity-toggle${showActivity ? ' is-active' : ''}`}
            onClick={toggleActivity}
            aria-pressed={showActivity}
          >
            <Activity size={15} /> 动态
          </button>
          <button type="button" className="icon-button" onClick={() => void handleRefresh()} aria-label="立即检查数据">
            <RefreshCw size={17} />
          </button>
          <button type="button" className="icon-button" onClick={() => void toggleWallMode()} aria-label={wallMode ? '退出投影模式' : '进入投影模式'}>
            <MonitorUp size={17} />
          </button>
          {!readOnly && (
            <button type="button" className="primary-button new-node-button" onClick={() => setShowNewItem(true)}>
              <Plus size={16} /> 新建节点
            </button>
          )}
        </div>
      </header>

      {syncState === 'error' && (
        <div className="error-banner" role="alert">
          <CircleAlert size={15} /> 数据检查失败：{syncError}（将继续按 30 秒重试，当前显示最近一次成功的数据）
        </div>
      )}

      <main className="workspace">
        <aside className="left-rail">
          <section className="progress-panel">
            <div className="progress-label">
              <span>加权验收进度</span>
              <strong>{Math.round(progress.ratio * 100)}%</strong>
            </div>
            <div className="progress-track" role="progressbar" aria-label="加权验收进度" aria-valuenow={Math.round(progress.ratio * 100)} aria-valuemin={0} aria-valuemax={100}>
              <span style={{ width: `${progress.ratio * 100}%` }} />
            </div>
            <p title={`按节点权重加权计算：已完成权重 ${formatWeight(progress.completed)} ÷ 总权重 ${formatWeight(progress.total)}（核心主张不计入）。`}>
              {formatWeight(progress.completed)} / {formatWeight(progress.total)} 权重 · {progress.completedItems} / {progress.totalItems} 节点完成验收
            </p>
          </section>

          <section className="signal-grid" aria-label="行动入口">
            <button
              type="button"
              className={statusFilter === 'frontier' ? 'is-active' : ''}
              aria-pressed={statusFilter === 'frontier'}
              onClick={() => setStatusFilter(statusFilter === 'frontier' ? 'all' : 'frontier')}
            >
              <GitFork size={16} />
              <strong>{frontier.length}</strong>
              <span>我能开工的</span>
            </button>
            <button
              type="button"
              className={statusFilter === 'pending_evidence' ? 'is-active' : ''}
              aria-pressed={statusFilter === 'pending_evidence'}
              onClick={() => setStatusFilter(statusFilter === 'pending_evidence' ? 'all' : 'pending_evidence')}
            >
              <ShieldCheck size={16} />
              <strong>{reviewEvidence.length}</strong>
              <span>需要我审计的</span>
            </button>
            <button
              type="button"
              className={statusFilter === 'blocked' ? 'is-active' : ''}
              aria-pressed={statusFilter === 'blocked'}
              onClick={() => setStatusFilter(statusFilter === 'blocked' ? 'all' : 'blocked')}
            >
              <CircleAlert size={16} />
              <strong>{blockedItems.length}</strong>
              <span>异常受阻的</span>
            </button>
          </section>

          <section className="rail-section">
            <div className="rail-heading">
              <span><ListFilter size={15} /> 筛选</span>
              {filtersActive && (
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
          </section>

          <section className="rail-section team-section">
            <div className="rail-heading">
              <span><Users size={15} /> 团队</span>
              <button type="button" aria-expanded={teamExpanded} onClick={() => setTeamExpanded((value) => !value)}>
                {teamExpanded ? '收起细项' : '展开细项'}
                <ChevronDown size={13} className={teamExpanded ? 'chevron is-open' : 'chevron'} aria-hidden="true" />
              </button>
            </div>
            {teamExpanded ? (
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
            ) : (
              <div className="member-chips">
                <button
                  type="button"
                  className={ownerFilter === 'all' ? 'is-active' : ''}
                  onClick={() => setOwnerFilter('all')}
                >
                  全部
                </button>
                {snapshot.members.map((member) => (
                  <button
                    type="button"
                    key={member.id}
                    className={ownerFilter === member.id ? 'is-active' : ''}
                    onClick={() => setOwnerFilter(ownerFilter === member.id ? 'all' : member.id)}
                  >
                    <span className="member-avatar">{member.initials}</span>
                    {member.name}
                  </button>
                ))}
              </div>
            )}
          </section>
        </aside>

        <section className="main-stage">
          <header className="stage-header">
            <div>
              <span className="stage-kicker">项目全貌</span>
              <h2>Claim D 实证路径</h2>
            </div>
            <div className="graph-legend" aria-label="图例">
              <span><i className="dot done" />已验收</span>
              <span><i className="dot active" />可开工</span>
              <span><i className="dot review" />待审计</span>
              <span><i className="dot blocked" />受阻</span>
              <span><i className="line soft" />软依赖</span>
            </div>
          </header>
          <div className="filter-chips" role="group" aria-label="状态快捷筛选">
            {quickFilters.map((filter) => (
              <button
                type="button"
                key={filter.value}
                className={statusFilter === filter.value ? 'is-active' : ''}
                aria-pressed={statusFilter === filter.value}
                onClick={() => setStatusFilter(filter.value)}
              >
                {filter.label}
              </button>
            ))}
            {filtersActive && (
              <button type="button" className="chip-clear" onClick={() => { setOwnerFilter('all'); setStatusFilter('all') }}>
                清除筛选
              </button>
            )}
          </div>
          <GraphBoard
            snapshot={snapshot}
            selectedId={selectedId}
            ownerFilter={ownerFilter}
            statusFilter={statusFilter}
            onSelect={selectNode}
            onPaneClear={() => setSelectedId('')}
            focusRequest={focusRequest}
          />
        </section>

        {showActivity && (
          <ActivityDrawer
            snapshot={snapshot}
            onClose={() => setShowActivity(false)}
            onSelect={selectNode}
          />
        )}

        {selectedItem && (
          <AuditDrawer
            key={selectedItem.id}
            item={selectedItem}
            snapshot={snapshot}
            onClose={() => setSelectedId('')}
            onSelect={selectNode}
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
