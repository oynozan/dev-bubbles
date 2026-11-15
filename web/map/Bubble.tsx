import { memo, useCallback } from 'react'
import type { CSSProperties, MouseEvent, ReactElement } from 'react'
import { CircleText } from './CircleText.tsx'
import { bubbleFill, bubbleName, describeSize, fitCenteredLabel, fitLabel, hasVisibleLabel } from './layout.ts'
import type { LayoutNode } from './layout.ts'
import type { HiddenMarks, NodeMark } from './marks.ts'
import { mapStripesId, MarkCircle } from './patterns.tsx'

export type BubbleActions = {
    register: (id: string, element: SVGGElement) => () => void
    registerBadge: (element: SVGGElement) => () => void
    select: (id: string) => void
    unpin: (id: string) => void
}

type BubbleProps = {
    node: LayoutNode
    openIds: ReadonlySet<string>
    marks: ReadonlyMap<string, NodeMark>
    hiddenMarks: ReadonlyMap<string, HiddenMarks>
    selectedId: string | undefined
    // The zoom factor as of the last zoom end, which sizes the centered labels
    scale: number
    actions: BubbleActions
}

type LabelProps = {
    node: LayoutNode
}

type CenteredLabelProps = LabelProps & {
    scale: number
}

type HiddenMarksRingProps = {
    r: number
    hidden: HiddenMarks
    actions: BubbleActions
}

const labelLineHeight = 1.2
const badgeHeight = 16
const badgeDigitWidth = 6.5
const maxBadgeCount = 99

const BubbleNode = ({ node, openIds, marks, hiddenMarks, selectedId, scale, actions }: BubbleProps): ReactElement => {
    const { id, r } = node
    const isOpen = openIds.has(id)
    const mark = marks.get(id)
    const hidden = hiddenMarks.get(id)
    const register = useCallback(
        (element: SVGGElement | null) => (element ? actions.register(id, element) : undefined),
        [actions, id],
    )

    const selectOnClick = (event: MouseEvent) => {
        event.stopPropagation()
        // The second click of a double click belongs to unpinning
        if (event.detail <= 1) actions.select(id)
    }
    const unpinOnDoubleClick = (event: MouseEvent) => {
        event.stopPropagation()
        actions.unpin(id)
    }

    return (
        <g ref={register} className="bubble" data-id={id} onClick={selectOnClick} onDoubleClick={unpinOnDoubleClick}>
            <title>{tooltipOf(node)}</title>
            <circle r={r} fill={bubbleFill(node)} />
            {mark && <MarkCircle r={r} state={mark.state} isDimmed={mark.isDimmed} stripesId={mapStripesId} />}
            {isOpen && node.children?.map((child) => (
                <Bubble
                    key={child.id}
                    node={child}
                    openIds={openIds}
                    marks={marks}
                    hiddenMarks={hiddenMarks}
                    selectedId={selectedId}
                    scale={scale}
                    actions={actions}
                />
            ))}
            {id === selectedId && <circle r={r} className="selection" />}
            {hasVisibleLabel(node) && (isOpen ? <CurvedLabel node={node} /> : <CenteredLabel node={node} scale={scale} />)}
            {hidden && <HiddenMarksRing r={r} hidden={hidden} actions={actions} />}
        </g>
    )
}

export const Bubble = memo(BubbleNode)

const tooltipOf = (node: LayoutNode): string => `${bubbleName(node)}\n${describeSize(node)}`

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

const HiddenMarksRing = ({ r, hidden, actions }: HiddenMarksRingProps) => {
    const { state, isDimmed, count } = hidden
    const status = isDimmed ? `${state} dimmed` : state
    const text = count > maxBadgeCount ? `${maxBadgeCount}+` : String(count)
    const width = badgeHeight + (text.length - 1) * badgeDigitWidth
    const registerBadge = useCallback(
        (element: SVGGElement | null) => (element ? actions.registerBadge(element) : undefined),
        [actions],
    )

    return (
        <>
            <circle r={r} className={`mark-ring ${status}`} />
            <g transform={`translate(${r * Math.SQRT1_2},${-r * Math.SQRT1_2})`}>
                <g ref={registerBadge} className={`mark-badge ${status}`}>
                    <rect x={-width / 2} y={-badgeHeight / 2} width={width} height={badgeHeight} rx={badgeHeight / 2} />
                    <text textAnchor="middle" dominantBaseline="central">{text}</text>
                </g>
            </g>
        </>
    )
}
