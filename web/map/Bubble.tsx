import { memo, useCallback } from 'react'
import type { MouseEvent, ReactElement } from 'react'
import { CircleText } from './CircleText.tsx'
import { bubbleFill, fitLabel } from './layout.ts'
import type { LayoutNode } from './layout.ts'

export type BubbleActions = {
    register: (id: string, element: SVGGElement) => () => void
    zoomTo: (id: string) => void
    unpin: (id: string) => void
}

type BubbleProps = {
    node: LayoutNode
    openIds: ReadonlySet<string>
    actions: BubbleActions
}

type LabelProps = {
    node: LayoutNode
}

const haloShare = 0.25

const BubbleNode = ({ node, openIds, actions }: BubbleProps): ReactElement => {
    const { id, kind, r } = node
    const isOpen = openIds.has(id)
    const register = useCallback(
        (element: SVGGElement | null) => (element ? actions.register(id, element) : undefined),
        [actions, id],
    )

    const zoomOnClick = (event: MouseEvent) => {
        event.stopPropagation()
        // The second click of a double click belongs to unpinning
        if (event.detail <= 1) actions.zoomTo(id)
    }
    const unpinOnDoubleClick = (event: MouseEvent) => {
        event.stopPropagation()
        actions.unpin(id)
    }

    return (
        <g ref={register} className="bubble" data-id={id} onClick={zoomOnClick} onDoubleClick={unpinOnDoubleClick}>
            <title>{tooltipOf(node)}</title>
            <circle r={r} fill={bubbleFill(node)} className={kind === 'file' ? undefined : 'group'} />
            {isOpen && node.children?.map((child) => (
                <Bubble key={child.id} node={child} openIds={openIds} actions={actions} />
            ))}
            {hasVisibleLabel(node) && (isOpen ? <CurvedLabel node={node} /> : <CenteredLabel node={node} />)}
        </g>
    )
}

export const Bubble = memo(BubbleNode)

// The coding agent names components, so file and folder names stay in the tooltip
const hasVisibleLabel = ({ kind, depth }: LayoutNode): boolean => kind === 'component' || depth === 0

const tooltipOf = ({ label, path, loc }: LayoutNode): string => {
    const lineCount = loc === undefined ? '' : `${loc} ${loc === 1 ? 'line' : 'lines'}`
    return [label, path, lineCount].filter(Boolean).join('\n')
}

const CurvedLabel = ({ node }: LabelProps) => {
    const { text, fontSize } = fitLabel(node.label, node.r * 2.2, node.r * 0.08)

    return (
        <CircleText
            className="label"
            r={node.r - fontSize * 0.3}
            text={text}
            fontSize={fontSize}
            strokeWidth={fontSize * haloShare}
        />
    )
}

const CenteredLabel = ({ node }: LabelProps) => {
    const { text, fontSize } = fitLabel(node.label, node.r * 1.8, node.r * 0.3)

    return (
        <text
            className="label"
            fontSize={fontSize}
            strokeWidth={fontSize * haloShare}
            textAnchor="middle"
            dominantBaseline="central"
        >
            {text}
        </text>
    )
}
