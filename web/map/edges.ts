import type { Edge, EdgeKind } from '../../shared/schema.ts'
import type { Point } from '../lib/utils.ts'
import { findVisibleId } from './layout.ts'
import type { Circle, Lineages } from './layout.ts'

export type VisibleEdge = {
    key: string
    from: string
    to: string
    kind: EdgeKind
    count: number
    labels: string[]
}

export type EdgeEnds = Pick<VisibleEdge, 'from' | 'to' | 'kind'>

export type EdgeCurve = {
    start: Point
    control: Point
    end: Point
}

export type ConnectionKind = 'imports' | 'importedBy' | 'calls' | 'calledBy'

export type Connection = {
    // The other end, a file or a component
    id: string
    label?: string
}

export type Connections = Record<ConnectionKind, Connection[]>

// HTTP edges bend further, so an import and a call between the same pair draw two arcs
const bends: Record<EdgeKind, number> = { import: 0.2, http: 0.45 }
const maxEdgeWidth = 4
const maxTooltipLabels = 10
const outgoing: Record<EdgeKind, ConnectionKind> = { import: 'imports', http: 'calls' }
const incoming: Record<EdgeKind, ConnectionKind> = { import: 'importedBy', http: 'calledBy' }

/* Aggregation */

export const aggregateEdges = (
    edges: readonly Edge[],
    lineages: Lineages,
    openIds: ReadonlySet<string>,
): VisibleEdge[] => {
    const merged = new Map<string, VisibleEdge>()
    for (const { from, to, kind, label } of edges) {
        const fromLineage = lineages.get(from)
        const toLineage = lineages.get(to)
        if (!fromLineage || !toLineage) continue
        const visibleFrom = findVisibleId(fromLineage, openIds)
        const visibleTo = findVisibleId(toLineage, openIds)
        // Ends that meet in one drawn bubble, or where one bubble holds the other, leave nothing to draw
        if (contains(lineages, visibleFrom, visibleTo) || contains(lineages, visibleTo, visibleFrom)) continue
        const key = [kind, visibleFrom, visibleTo].join('\n')
        const edge: VisibleEdge = merged.get(key) ?? { key, from: visibleFrom, to: visibleTo, kind, count: 0, labels: [] }
        edge.count += 1
        if (label !== undefined && !edge.labels.includes(label)) edge.labels.push(label)
        merged.set(key, edge)
    }
    return [...merged.values()]
}

// Hovering a bubble picks out the edges that end on it or inside it
export const isEdgeOf = ({ from, to }: EdgeEnds, id: string, lineages: Lineages): boolean => {
    return contains(lineages, id, from) || contains(lineages, id, to)
}

const contains = (lineages: Lineages, outerId: string, innerId: string): boolean => {
    return lineages.get(innerId)?.includes(outerId) ?? false
}

/* Connections */

// Every edge listed at both of its ends, for the details of a file or a component
export const indexConnections = (edges: readonly Edge[]): Map<string, Connections> => {
    const index = new Map<string, Connections>()
    const add = (id: string, kind: ConnectionKind, connection: Connection): void => {
        const connections = index.get(id) ?? { imports: [], importedBy: [], calls: [], calledBy: [] }
        connections[kind].push(connection)
        index.set(id, connections)
    }
    for (const { from, to, kind, label } of edges) {
        add(from, outgoing[kind], { id: to, label })
        add(to, incoming[kind], { id: from, label })
    }
    return index
}

/* Drawing */

// The bend sides with the direction, so a pair of bubbles that call each other draws two arcs
export const edgeCurve = (source: Circle, target: Circle, kind: EdgeKind): EdgeCurve => {
    const dx = target.x - source.x
    const dy = target.y - source.y
    const distance = Math.hypot(dx, dy) || 1
    const gap = Math.max(0, distance - source.r - target.r)
    const along = (source.r + gap / 2) / distance
    const offset = (gap * bends[kind]) / distance
    const control: Point = [source.x + dx * along - dy * offset, source.y + dy * along + dx * offset]
    return { start: towards(source, control), control, end: towards(target, control) }
}

export const edgePath = (source: Circle, target: Circle, kind: EdgeKind): string => {
    const { start, control, end } = edgeCurve(source, target, kind)
    return `M${start[0]},${start[1]}Q${control[0]},${control[1]} ${end[0]},${end[1]}`
}

const towards = ({ x, y, r }: Circle, [pointX, pointY]: Point): Point => {
    const distance = Math.hypot(pointX - x, pointY - y) || 1
    return [x + ((pointX - x) / distance) * r, y + ((pointY - y) / distance) * r]
}

export const edgeWidth = (count: number): number => Math.min(maxEdgeWidth, 1 + Math.log2(count) / 2)

export const describeHttpEdge = ({ labels }: VisibleEdge): string => {
    const shown = labels.slice(0, maxTooltipLabels)
    const hiddenCount = labels.length - shown.length
    return ['HTTP calls', ...shown, ...(hiddenCount > 0 ? [`and ${hiddenCount} more`] : [])].join('\n')
}
