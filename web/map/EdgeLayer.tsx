import { useCallback } from 'react'
import { describeHttpEdge, edgeWidth } from './edges.ts'
import type { EdgeEnds, VisibleEdge } from './edges.ts'

export type EdgeActions = {
    registerEdge: (ends: EdgeEnds, element: SVGPathElement) => () => void
}

type EdgeLayerProps = {
    edges: VisibleEdge[]
    actions: EdgeActions
}

type EdgePathProps = {
    edge: VisibleEdge
    actions: EdgeActions
}

// The stylesheet picks one per edge state, since an arrow cannot inherit the opacity of its edge
const arrowIds = ['edge-arrow', 'edge-arrow-related', 'edge-arrow-dimmed']

// Past this many edges the arrow markers cost more raster time than the lines, so only hovered edges keep them
const denseEdgeCount = 500

export const EdgeLayer = ({ edges, actions }: EdgeLayerProps) => (
    <g className={edges.length > denseEdgeCount ? 'edges dense' : 'edges'}>
        <defs>
            {/* Sized in stroke widths, which stay constant on screen under the non-scaling stroke */}
            {arrowIds.map((id) => (
                <marker
                    key={id}
                    id={id}
                    viewBox="0 0 10 10"
                    refX={10}
                    refY={5}
                    markerWidth={5}
                    markerHeight={5}
                    markerUnits="strokeWidth"
                    orient="auto"
                >
                    <path className="edge-arrow" d="M0,0L10,5L0,10z" />
                </marker>
            ))}
        </defs>
        {edges.map((edge) => <EdgePath key={edge.key} edge={edge} actions={actions} />)}
    </g>
)

const EdgePath = ({ edge, actions }: EdgePathProps) => {
    const { from, to } = edge
    // Keyed by the ends, so a regrouping that only changes counts keeps the path registered
    const register = useCallback(
        (element: SVGPathElement | null) => (element ? actions.registerEdge({ from, to }, element) : undefined),
        [actions, from, to],
    )

    return (
        <path ref={register} className={`edge ${edge.kind}`} strokeWidth={edgeWidth(edge.count)}>
            {edge.kind === 'http' && <title>{describeHttpEdge(edge)}</title>}
        </path>
    )
}
