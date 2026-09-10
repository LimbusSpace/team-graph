import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { statusBadgeCopy } from '../lib/graph'
import type { TeamMember, WorkItem } from '../types'

export type ProjectNodeData = {
  item: WorkItem
  owners: TeamMember[]
  isFrontier: boolean
  /** Dimmed because it does not match the owner/status filter. */
  isDimmed: boolean
  /** Softly dimmed because it is unrelated to the selected node. */
  isFocusDimmed: boolean
  isRelated: boolean
  blockerCount: number
  acceptedEvidenceCount: number
  pendingEvidenceCount: number
}

export type ProjectFlowNode = Node<ProjectNodeData, 'projectNode'>

const typeLabels: Record<WorkItem['type'], string> = {
  mission: '核心主张',
  gate: '决策门',
  task: '任务',
  experiment: '实验',
  claim: '论点',
  release: '交付',
}

export function ProjectNode({ data, selected }: NodeProps<ProjectFlowNode>) {
  const {
    item,
    owners,
    isFrontier,
    isDimmed,
    isFocusDimmed,
    isRelated,
    blockerCount,
    acceptedEvidenceCount,
    pendingEvidenceCount,
  } = data
  const badge = statusBadgeCopy(item, {
    isFrontier,
    blockerCount,
    acceptedEvidenceCount,
    pendingEvidenceCount,
  })

  const className = [
    'project-node',
    `tone-${badge.tone}`,
    selected ? 'is-selected' : '',
    isDimmed ? 'is-dimmed' : '',
    isFocusDimmed ? 'is-focus-dimmed' : '',
    isRelated ? 'is-related' : '',
  ].filter(Boolean).join(' ')

  return (
    <article
      className={className}
      aria-label={`${item.id} ${item.title}，${badge.label}`}
    >
      <Handle type="target" position={Position.Left} className="node-handle" />
      <div className="node-meta">
        <span className="node-id">{item.id}</span>
        <span>{typeLabels[item.type]}</span>
      </div>
      <h3>{item.title}</h3>
      <div className="node-footer">
        <div className="node-owners" aria-label={`负责人：${owners.map((owner) => owner.name).join('、')}`}>
          {owners.slice(0, 3).map((owner) => (
            <span key={owner.id}>{owner.initials}</span>
          ))}
          {owners.length > 3 && <span>+{owners.length - 3}</span>}
        </div>
        <span className={`node-badge badge-${badge.tone}`}>{badge.label}</span>
      </div>
      {badge.detail && <p className="node-detail">{badge.detail}</p>}
      <Handle type="source" position={Position.Right} className="node-handle" />
    </article>
  )
}
