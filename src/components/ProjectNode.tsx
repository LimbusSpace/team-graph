import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { Check, CircleAlert, FlaskConical, GitFork, LockKeyhole } from 'lucide-react'
import type { TeamMember, WorkItem } from '../types'

export type ProjectNodeData = {
  item: WorkItem
  owners: TeamMember[]
  isFrontier: boolean
  isDimmed: boolean
  blockerCount: number
  evidenceCount: number
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

const statusLabels: Record<WorkItem['status'], string> = {
  planned: '等待',
  ready: '可开工',
  in_progress: '进行中',
  review: '待审计',
  done: '已验证',
  blocked: '受阻',
}

export function ProjectNode({ data, selected }: NodeProps<ProjectFlowNode>) {
  const { item, owners, isFrontier, isDimmed, blockerCount, evidenceCount } = data

  return (
    <article
      className={`project-node status-${item.status}${selected ? ' is-selected' : ''}${isDimmed ? ' is-dimmed' : ''}`}
      aria-label={`${item.id} ${item.title}，${statusLabels[item.status]}`}
    >
      <Handle type="target" position={Position.Left} className="node-handle" />
      <div className="node-meta">
        <span>{item.id}</span>
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
        <span className="node-signal">
          {item.status === 'done' ? (
            <><Check size={13} /> {evidenceCount}</>
          ) : item.status === 'blocked' ? (
            <><CircleAlert size={13} /> 受阻</>
          ) : blockerCount > 0 ? (
            <><LockKeyhole size={13} /> {blockerCount}</>
          ) : isFrontier ? (
            <><GitFork size={13} /> 可开工</>
          ) : item.type === 'experiment' ? (
            <><FlaskConical size={13} /> 实验</>
          ) : (
            statusLabels[item.status]
          )}
        </span>
      </div>
      <Handle type="source" position={Position.Right} className="node-handle" />
    </article>
  )
}
