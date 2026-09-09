import { useMemo } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  type Edge,
  type NodeMouseHandler,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { isOpenFrontier, phaseOrder, unmetPrerequisites } from '../lib/graph'
import type { GraphFilter, ProjectSnapshot, WorkStatus } from '../types'
import { ProjectNode, type ProjectFlowNode } from './ProjectNode'

interface GraphBoardProps {
  snapshot: ProjectSnapshot
  selectedId: string
  ownerFilter: string
  statusFilter: GraphFilter
  onSelect: (id: string) => void
}

const nodeTypes = { projectNode: ProjectNode }

const phaseX: Record<string, number> = {
  'P0 定义': 0,
  'P1 闭环': 340,
  'P2 实证': 680,
  'P3 主张': 1020,
}

function nodeColor(status: WorkStatus) {
  if (status === 'done') return '#2f7a58'
  if (status === 'blocked') return '#b64b47'
  if (status === 'review') return '#477b9d'
  if (status === 'in_progress') return '#d59b24'
  if (status === 'ready') return '#6d9b47'
  return '#9da7a1'
}

export function GraphBoard({
  snapshot,
  selectedId,
  ownerFilter,
  statusFilter,
  onSelect,
}: GraphBoardProps) {
  const memberById = useMemo(
    () => new Map(snapshot.members.map((member) => [member.id, member])),
    [snapshot.members],
  )

  const nodes = useMemo<ProjectFlowNode[]>(() => {
    const laneCounts = new Map<string, number>()

    return snapshot.items.map((item) => {
      const phase = phaseOrder.includes(item.phase) ? item.phase : 'P3 主张'
      const lane = laneCounts.get(phase) ?? 0
      laneCounts.set(phase, lane + 1)
      const matchesOwner = ownerFilter === 'all' || item.ownerIds.includes(ownerFilter)
      const matchesStatus = statusFilter === 'all'
        || item.status === statusFilter
        || (statusFilter === 'frontier' && isOpenFrontier(item, snapshot))
        || (statusFilter === 'pending_evidence' && snapshot.evidence.some(
          (entry) => entry.workItemId === item.id && !entry.accepted,
        ))
      const evidenceCount = snapshot.evidence.filter(
        (entry) => entry.workItemId === item.id && entry.accepted,
      ).length

      return {
        id: item.id,
        type: 'projectNode',
        position: { x: phaseX[phase], y: lane * 116 },
        selected: item.id === selectedId,
        draggable: false,
        data: {
          item,
          owners: item.ownerIds
            .map((id) => memberById.get(id))
            .filter((member) => member !== undefined),
          isFrontier: isOpenFrontier(item, snapshot),
          isDimmed: !matchesOwner || !matchesStatus,
          blockerCount: unmetPrerequisites(item, snapshot).length,
          evidenceCount,
        },
      }
    })
  }, [memberById, ownerFilter, selectedId, snapshot, statusFilter])

  const edges = useMemo<Edge[]>(
    () =>
      snapshot.dependencies.map((dependency) => {
        const source = snapshot.items.find((item) => item.id === dependency.source)
        const target = snapshot.items.find((item) => item.id === dependency.target)
        const active = source?.status === 'done' && target && isOpenFrontier(target, snapshot)

        return {
          id: `${dependency.source}-${dependency.target}`,
          source: dependency.source,
          target: dependency.target,
          type: 'smoothstep',
          markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
          className: `${dependency.kind === 'soft' ? 'soft-edge' : 'hard-edge'}${active ? ' active-edge' : ''}`,
          style: { strokeWidth: dependency.kind === 'soft' ? 1 : 1.5 },
        }
      }),
    [snapshot],
  )

  const onNodeClick: NodeMouseHandler<ProjectFlowNode> = (_event, node) => onSelect(node.id)

  return (
    <section className="graph-board" aria-label="项目依赖图">
      <div className="phase-rail" aria-hidden="true">
        {phaseOrder.map((phase) => <span key={phase}>{phase}</span>)}
      </div>
      <ReactFlow<ProjectFlowNode, Edge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        fitView
        fitViewOptions={{ padding: 0.12, minZoom: 0.35, maxZoom: 0.9 }}
        minZoom={0.25}
        maxZoom={1.5}
        nodesConnectable={false}
        nodesFocusable
        elementsSelectable
        colorMode="light"
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="rgba(31, 66, 58, 0.14)" />
        <Controls showInteractive={false} position="bottom-left" />
        <MiniMap
          position="bottom-right"
          pannable
          zoomable
          nodeColor={(node) => nodeColor((node.data as ProjectNodeDataShape).item.status)}
          maskColor="rgba(244, 246, 242, 0.72)"
          style={{ width: 142, height: 92 }}
        />
      </ReactFlow>
    </section>
  )
}

type ProjectNodeDataShape = {
  item: { status: WorkStatus }
}
