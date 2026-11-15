import { useCallback } from 'react'
import { describeHttpEdge, edgeWidth } from './edges.ts'
import type { VisibleEdge } from './edges.ts'

export type EdgeActions = {
    registerEdge: (edge: VisibleEdge, element: SVGPathElement) => () => void
}

type EdgeLayerProps = {
    edges: VisibleEdge[]
    actions: EdgeActions
}

type EdgePathProps = {
    edge: VisibleEdge
    actions: EdgeActions
}

const arrowId = 'edge-arrow'

export const EdgeLayer = ({ edges, actions }: EdgeLayerProps) => (
    <g className="edges">
        <defs>
            {/* Sized in stroke widths, which stay constant on screen under the non-scaling stroke */}
            <marker
                id={arrowId}
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
        </defs>
        {edges.map((edge) => <EdgePath key={edge.key} edge={edge} actions={actions} />)}
    </g>
)

const EdgePath = ({ edge, actions }: EdgePathProps) => {
    const register = useCallback(
        (element: SVGPathElement | null) => (element ? actions.registerEdge(edge, element) : undefined),
        [actions, edge],
    )

    return (
        <path ref={register} className={`edge ${edge.kind}`} strokeWidth={edgeWidth(edge.count)} markerEnd={`url(#${arrowId})`}>
            {edge.kind === 'http' && <title>{describeHttpEdge(edge)}</title>}
        </path>
    )
}
