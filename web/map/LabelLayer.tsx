import { memo, useCallback } from 'react'
import type { CSSProperties } from 'react'
import { CircleText } from './CircleText.tsx'
import { fitCenteredLabel, fitLabel, hasVisibleLabel } from './layout.ts'
import type { LayoutNode } from './layout.ts'
import { markStatus } from './marks.ts'
import type { HiddenMarks } from './marks.ts'

export type LabelActions = {
    registerLabel: (id: string, element: SVGGElement) => () => void
    registerBadge: (element: SVGGElement) => () => void
}

type LabelsProps = {
    nodes: readonly LayoutNode[]
    openIds: ReadonlySet<string>
    hiddenMarks: ReadonlyMap<string, HiddenMarks>
    // The zoom factor as of the last zoom end, which sizes the centered labels
    scale: number
    actions: LabelActions
}

type NodeLabelsProps = Omit<LabelsProps, 'nodes'> & {
    node: LayoutNode
}

type LabelProps = {
    node: LayoutNode
}

type CenteredLabelProps = LabelProps & {
    scale: number
}

type MarkBadgeProps = {
    r: number
    hidden: HiddenMarks
    actions: LabelActions
}

const labelLineHeight = 1.2
const badgeHeight = 16
const badgeDigitWidth = 6.5
const maxBadgeCount = 99

// Above the bubbles and edges, so a name that spills over its circle is never painted over by a neighbor
export const LabelLayer = (props: LabelsProps) => (
    <g className="labels">
        <Labels {...props} />
    </g>
)

const LabelsNode = ({ nodes, ...props }: LabelsProps) => (
    <>
        {nodes.map((node) => <NodeLabels key={node.id} node={node} {...props} />)}
    </>
)

const Labels = memo(LabelsNode)

// The map moves each group with its bubble, so the labels nest the way the bubbles do
const NodeLabels = ({ node, openIds, hiddenMarks, scale, actions }: NodeLabelsProps) => {
    const { id, r } = node
    const isOpen = openIds.has(id)
    const hidden = hiddenMarks.get(id)
    const register = useCallback(
        (element: SVGGElement | null) => (element ? actions.registerLabel(id, element) : undefined),
        [actions, id],
    )

    return (
        <g ref={register}>
            {isOpen && node.children && (
                <Labels nodes={node.children} openIds={openIds} hiddenMarks={hiddenMarks} scale={scale} actions={actions} />
            )}
            {hasVisibleLabel(node) && (isOpen ? <CurvedLabel node={node} /> : <CenteredLabel node={node} scale={scale} />)}
            {hidden && <MarkBadge r={r} hidden={hidden} actions={actions} />}
        </g>
    )
}

// The stylesheet raises the fitted size to a readable minimum on screen
const CurvedLabel = ({ node }: LabelProps) => {
    const { text, fontSize } = fitLabel(node.label, node.r * 2.2, node.r * 0.08)

    return (
        <CircleText
            className="label curved"
            r={node.r - fontSize * 0.3}
            text={text}
            style={{ '--fitted-size': `${fontSize}px` } as CSSProperties}
        />
    )
}

const CenteredLabel = ({ node, scale }: CenteredLabelProps) => {
    const fitted = fitCenteredLabel(node.label, node.r, scale)
    if (!fitted) return null
    const { lines, fontSize } = fitted
    const firstLineShift = (-labelLineHeight * (lines.length - 1)) / 2

    return (
        <text
            className="label"
            fontSize={fontSize}
            textAnchor="middle"
            dominantBaseline="central"
        >
            {lines.map((line, index) => (
                <tspan key={index} x={0} dy={`${index ? labelLineHeight : firstLineShift}em`}>{line}</tspan>
            ))}
        </text>
    )
}

// The bug count sits above the names while its ring stays with the bubble, so a spilled name never hides it
const MarkBadge = ({ r, hidden, actions }: MarkBadgeProps) => {
    const text = hidden.count > maxBadgeCount ? `${maxBadgeCount}+` : String(hidden.count)
    const width = badgeHeight + (text.length - 1) * badgeDigitWidth
    const registerBadge = useCallback(
        (element: SVGGElement | null) => (element ? actions.registerBadge(element) : undefined),
        [actions],
    )

    return (
        <g transform={`translate(${r * Math.SQRT1_2},${-r * Math.SQRT1_2})`}>
            <g ref={registerBadge} className={`mark-badge ${markStatus(hidden)}`}>
                <rect x={-width / 2} y={-badgeHeight / 2} width={width} height={badgeHeight} rx={badgeHeight / 2} />
                <text textAnchor="middle" dominantBaseline="central">{text}</text>
            </g>
        </g>
    )
}
