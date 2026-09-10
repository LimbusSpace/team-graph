import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  type Edge,
  type NodeMouseHandler,
  type ReactFlowInstance,
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
  onPaneClear: () => void
  /** When it changes, the board pans so the node is centered (used by top search). */
  focusRequest: { id: string; nonce: number } | null
}

const nodeTypes = { projectNode: ProjectNode }

const phaseX: Record<string, number> = {
  'P0 定义': 0,
  'P1 闭环': 340,
  'P2 实证': 680,
  'P3 主张': 1020,
}

const NODE_WIDTH = 248

const EDGE_COLOR_DEFAULT = '#9daea5'
const EDGE_COLOR_RELATED = '#287565'
const EDGE_COLOR_DIM = 'rgba(174, 187, 180, 0.45)'

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
  onPaneClear,
  focusRequest,
}: GraphBoardProps) {
  const memberById = useMemo(
    () => new Map(snapshot.members.map((member) => [member.id, member])),
    [snapshot.members],
  )

  // Direct prerequisites + dependents of the selected node (any dependency kind).
  const relatedIds = useMemo(() => {
    if (!selectedId) return null
    const related = new Set<string>([selectedId])
    snapshot.dependencies.forEach((dependency) => {
      if (dependency.source === selectedId) related.add(dependency.target)
      if (dependency.target === selectedId) related.add(dependency.source)
    })
    return related
  }, [selectedId, snapshot.dependencies])

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
      const acceptedEvidenceCount = snapshot.evidence.filter(
        (entry) => entry.workItemId === item.id && entry.accepted,
      ).length
      const pendingEvidenceCount = snapshot.evidence.filter(
        (entry) => entry.workItemId === item.id && !entry.accepted,
      ).length

      return {
        id: item.id,
        type: 'projectNode',
        position: { x: phaseX[phase], y: lane * 126 },
        selected: item.id === selectedId,
        draggable: false,
        data: {
          item,
          owners: item.ownerIds
            .map((id) => memberById.get(id))
            .filter((member) => member !== undefined),
          isFrontier: isOpenFrontier(item, snapshot),
          isDimmed: !matchesOwner || !matchesStatus,
          isFocusDimmed: relatedIds !== null && !relatedIds.has(item.id),
          isRelated: item.id !== selectedId && relatedIds?.has(item.id) === true,
          blockerCount: unmetPrerequisites(item, snapshot).length,
          acceptedEvidenceCount,
          pendingEvidenceCount,
        },
      }
    })
  }, [memberById, ownerFilter, relatedIds, selectedId, snapshot, statusFilter])

  const edges = useMemo<Edge[]>(
    () =>
      snapshot.dependencies.map((dependency) => {
        const source = snapshot.items.find((item) => item.id === dependency.source)
        const target = snapshot.items.find((item) => item.id === dependency.target)
        const active = source?.status === 'done' && target && isOpenFrontier(target, snapshot)
        const isRelated = selectedId !== ''
          && (dependency.source === selectedId || dependency.target === selectedId)
        const focusMode = selectedId !== ''
        const markerColor = focusMode
          ? (isRelated ? EDGE_COLOR_RELATED : EDGE_COLOR_DIM)
          : EDGE_COLOR_DEFAULT

        return {
          id: `${dependency.source}-${dependency.target}`,
          source: dependency.source,
          target: dependency.target,
          type: 'smoothstep',
          markerEnd: { type: MarkerType.ArrowClosed, width: 13, height: 13, color: markerColor },
          className: [
            dependency.kind === 'soft' ? 'soft-edge' : 'hard-edge',
            active && !focusMode ? ' active-edge' : '',
            focusMode ? (isRelated ? ' edge-related' : ' edge-dim') : '',
          ].join(''),
          style: { strokeWidth: isRelated ? 2 : dependency.kind === 'soft' ? 1 : 1.4 },
        }
      }),
    [selectedId, snapshot],
  )

  const instanceRef = useRef<ReactFlowInstance<ProjectFlowNode, Edge> | null>(null)
  const handleInit = useCallback((instance: ReactFlowInstance<ProjectFlowNode, Edge>) => {
    instanceRef.current = instance
  }, [])

  useEffect(() => {
    if (!focusRequest) return
    const instance = instanceRef.current
    const node = nodes.find((candidate) => candidate.id === focusRequest.id)
    if (!instance || !node) return
    const zoom = Math.max(instance.getZoom(), 0.75)
    void instance.setCenter(
      node.position.x + NODE_WIDTH / 2,
      node.position.y + 60,
      { zoom, duration: 500 },
    )
  }, [focusRequest, nodes])

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
        onPaneClick={onPaneClear}
        onInit={handleInit}
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
